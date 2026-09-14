import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { __resetPrefetchState, usePrefetch } from '../usePrefetch'
import { __lyricsCacheStats, __resetLyricsCache, useLyrics } from '../useLyrics'
import type { LyricsResult, ObserverStatus, QueueTrack } from '../../api/types'
import { server } from '../../__tests__/msw-server'

const UPCOMING_DEBOUNCE_MS = 250
const DEEP_PREFETCH_MS = 5000

// the exact shape usePrefetch primes for "no lyrics found" — must stay in sync
const EMPTY_LYRICS: LyricsResult = { syncType: 'UNSYNCED', lines: [] }
const LINE_SYNCED: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [{ startTimeMs: '0', words: 'Hello' }],
}

// unique track ids per test — the prefetch module state is process-global, so
// beforeEach resets it and no id is ever reused across tests
function qt(id: string, uri = `spotify:track:${id}`): QueueTrack {
  return { uri, track_id: id, name: `Name ${id}`, artist: `Artist ${id}` } as unknown as QueueTrack
}

function statusWith(nextTracks: QueueTrack[]): ObserverStatus {
  return {
    active: true,
    track_uri: 'spotify:track:cur',
    track_id: 'cur-id',
    name: 'Current',
    artist: 'Current Artist',
    next_tracks: nextTracks,
    prev_tracks: [],
  } as unknown as ObserverStatus
}

// fire the immediate debounce, then give any in-flight msw request time to settle
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UPCOMING_DEBOUNCE_MS + 20)
    await vi.advanceTimersByTimeAsync(100)
  })
}

beforeEach(() => {
  __resetLyricsCache()
  __resetPrefetchState()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePrefetch upcoming-track preparation (issue #36)', () => {
  it('primes next_tracks[0] immediately on change, without waiting for the 5s deep prefetch', async () => {
    const requested: string[] = []
    server.use(
      http.get('*/lyrics/up-id', () => {
        requested.push('up-id')
        return HttpResponse.json(LINE_SYNCED)
      }),
    )

    renderHook(({ s }: { s: ObserverStatus }) => usePrefetch(s), {
      initialProps: { s: statusWith([qt('up-id')]) },
    })

    // only ~270ms have elapsed — the 5s deep prefetch cannot have fired yet,
    // so this request proves the immediate path
    await settle()
    expect(requested).toEqual(['up-id'])
    expect(__lyricsCacheStats().entries).toBe(1)
  })

  it('primes negative outcomes so a switch into a lyric-less track is instant with no loading flip', async () => {
    server.use(http.get('*/lyrics/neg-id', () => new HttpResponse(null, { status: 404 })))

    renderHook(() => usePrefetch(statusWith([qt('neg-id')])))
    await settle()

    // a 404 (no lyrics / instrumental) is still cached — as an empty entry
    expect(__lyricsCacheStats().entries).toBe(1)

    // switching into the track now resolves straight from cache: empty lines,
    // loading never true (a non-primed id would start with lyrics:null + a
    // debounced fetch and loading:true in between)
    const { result } = renderHook(() =>
      useLyrics({ trackId: 'neg-id', trackName: 'N', artist: 'A' }),
    )
    expect(result.current.loading).toBe(false)
    expect(result.current.lyrics).toEqual(EMPTY_LYRICS)
    expect(result.current.error).toBeNull()
  })

  it('does not double-fetch when the deep prefetch also covers next_tracks[0]', async () => {
    const requested: string[] = []
    server.use(
      http.get('*/lyrics/*', ({ request }) => {
        const id = new URL(request.url).pathname.replace('/lyrics/', '')
        requested.push(id)
        return HttpResponse.json(LINE_SYNCED)
      }),
    )

    renderHook(() => usePrefetch(statusWith([qt('dp-0'), qt('dp-1')])))

    await settle() // immediate path primes next_tracks[0]
    expect(requested).toEqual(['dp-0'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEEP_PREFETCH_MS)
      await vi.advanceTimersByTimeAsync(100)
    }) // deep prefetch fires: dp-0 already seen, dp-1 fresh
    expect(requested).toEqual(['dp-0', 'dp-1'])
  })

  it('fires a single fetch for bursty status updates of the same upcoming track', async () => {
    const requested: string[] = []
    server.use(
      http.get('*/lyrics/burst-id', () => {
        requested.push('burst-id')
        return HttpResponse.json(LINE_SYNCED)
      }),
    )

    const first = qt('burst-id')
    const { rerender } = renderHook(({ s }: { s: ObserverStatus }) => usePrefetch(s), {
      initialProps: { s: statusWith([first]) },
    })

    // first burst fires the debounce, fetch is in flight (handled set holds the id)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPCOMING_DEBOUNCE_MS + 20)
    })

    // second burst: same track_id, sparse metadata completed (album arrives) —
    // the effect re-runs and its timer must not trigger a second fetch
    const withAlbum = { ...first, album: 'An Album' } as unknown as QueueTrack
    rerender({ s: statusWith([withAlbum]) })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPCOMING_DEBOUNCE_MS + 20)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(requested).toEqual(['burst-id'])

    // and the deep prefetch later still does not re-fetch it
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEEP_PREFETCH_MS + 100)
    })
    expect(requested).toEqual(['burst-id'])
  })
})
