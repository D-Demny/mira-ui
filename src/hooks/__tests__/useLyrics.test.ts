import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { __resetLyricsCache, useLyrics } from '../useLyrics'
import type { LyricsResult } from '../../api/types'
import { server } from '../../__tests__/msw-server'

const FETCH_DEBOUNCE_MS = 150
const TRACK_META = {
  trackId: 'abc',
  trackName: 'Song',
  artist: 'Artist',
}

const sampleLyrics: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [
    { startTimeMs: '0', words: 'Line one' },
    { startTimeMs: '1500', words: 'Line two' },
  ],
}

beforeEach(() => {
  __resetLyricsCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLyrics fetch outcomes', () => {
  it('populates state with the daemon response on a 200', async () => {
    server.use(http.get('*/lyrics/abc', () => HttpResponse.json(sampleLyrics)))

    const { result } = renderHook(() => useLyrics(TRACK_META))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.lyrics).toEqual(sampleLyrics)
    expect(result.current.error).toBeNull()
  })

  it('treats a 404 as no lyrics (null, no error)', async () => {
    // 404 = nothing found, normal outcome for instrumentals/obscure tracks
    server.use(http.get('*/lyrics/abc', () => new HttpResponse(null, { status: 404 })))

    const { result } = renderHook(() => useLyrics(TRACK_META))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.lyrics).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error message on a 5xx response', async () => {
    server.use(http.get('*/lyrics/abc', () => new HttpResponse(null, { status: 500 })))

    const { result } = renderHook(() => useLyrics(TRACK_META))

    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.lyrics).toBeNull()
    expect(result.current.error).toMatch(/500/)
  })

  it('skips the fetch entirely when trackId / trackName / artist is empty', async () => {
    // local files and episodes set trackId='' upstream
    let requested = 0
    server.use(
      http.get('*/lyrics/*', () => {
        requested++
        return HttpResponse.json(sampleLyrics)
      }),
    )

    const { result } = renderHook(() => useLyrics({ trackId: '', trackName: 'x', artist: 'y' }))

    await new Promise((r) => setTimeout(r, 250))
    expect(requested).toBe(0)
    expect(result.current).toEqual({ lyrics: null, loading: false, error: null })
  })
})

describe('useLyrics track switch cancellation', () => {
  it("does not leak the previous track's lyrics when the user skips mid-fetch", async () => {
    // regression for "previous track's lyrics flash briefly on track skip"
    const aLyrics: LyricsResult = {
      syncType: 'LINE_SYNCED',
      lines: [{ startTimeMs: '0', words: 'A song' }],
    }
    const bLyrics: LyricsResult = {
      syncType: 'LINE_SYNCED',
      lines: [{ startTimeMs: '0', words: 'B song' }],
    }
    server.use(
      http.get('*/lyrics/a-id', async () => {
        await new Promise((r) => setTimeout(r, 200))
        return HttpResponse.json(aLyrics)
      }),
      http.get('*/lyrics/b-id', () => HttpResponse.json(bLyrics)),
    )

    const { result, rerender } = renderHook(
      ({ trackId }: { trackId: string }) => useLyrics({ trackId, trackName: 'X', artist: 'Y' }),
      { initialProps: { trackId: 'a-id' } },
    )

    rerender({ trackId: 'b-id' })

    await waitFor(() => expect(result.current.lyrics).toEqual(bLyrics))

    // wait past A's slow handler, if abort didn't fire A would overwrite state
    await new Promise((r) => setTimeout(r, 300))
    expect(result.current.lyrics).toEqual(bLyrics)
  })
})

describe('useLyrics module-scope LRU cache', () => {
  it('skips the network fetch when the same track is requested twice', async () => {
    let requested = 0
    server.use(
      http.get('*/lyrics/abc', () => {
        requested++
        return HttpResponse.json(sampleLyrics)
      }),
    )

    const first = renderHook(() => useLyrics(TRACK_META))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(requested).toBe(1)
    first.unmount()

    const second = renderHook(() => useLyrics(TRACK_META))
    expect(second.result.current.lyrics).toEqual(sampleLyrics)
    expect(second.result.current.loading).toBe(false)
    expect(requested).toBe(1)
  })

  // helper, advances past debounce so the fetch + setState lands
  async function cycleTrack(
    rerender: (props: { trackId: string; trackName: string; artist: string }) => void,
    trackId: string,
  ) {
    rerender({ trackId, trackName: 'X', artist: 'Y' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS + 10)
    })
  }

  it('evicts the oldest entry once the 50-entry limit is exceeded', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    const requestedIds: string[] = []
    server.use(
      http.get('*/lyrics/*', ({ request }) => {
        const url = new URL(request.url)
        const id = url.pathname.replace('/lyrics/', '')
        requestedIds.push(id)
        return HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [{ startTimeMs: '0', words: id }],
        })
      }),
    )

    const { rerender } = renderHook(
      ({ trackId, trackName, artist }: { trackId: string; trackName: string; artist: string }) =>
        useLyrics({ trackId, trackName, artist }),
      { initialProps: { trackId: 't0', trackName: 'X', artist: 'Y' } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS + 10)
    })

    for (let i = 1; i <= 50; i++) {
      await cycleTrack(rerender, `t${i}`)
    }
    expect(requestedIds.length).toBe(51)

    requestedIds.length = 0
    await cycleTrack(rerender, 't0')
    expect(requestedIds).toEqual(['t0'])

    requestedIds.length = 0
    await cycleTrack(rerender, 't50')
    expect(requestedIds).toEqual([])
  })

  it('moves an accessed entry to the most-recent position (recency-on-access)', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    const requestedIds: string[] = []
    server.use(
      http.get('*/lyrics/*', ({ request }) => {
        const url = new URL(request.url)
        const id = url.pathname.replace('/lyrics/', '')
        requestedIds.push(id)
        return HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [{ startTimeMs: '0', words: id }],
        })
      }),
    )

    const { rerender } = renderHook(
      ({ trackId, trackName, artist }: { trackId: string; trackName: string; artist: string }) =>
        useLyrics({ trackId, trackName, artist }),
      { initialProps: { trackId: 't0', trackName: 'X', artist: 'Y' } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS + 10)
    })

    for (let i = 1; i < 50; i++) {
      await cycleTrack(rerender, `t${i}`)
    }
    expect(requestedIds.length).toBe(50)

    // touch t0 to bump recency, then add t50, should evict t1 not t0
    requestedIds.length = 0
    await cycleTrack(rerender, 't0')
    expect(requestedIds).toEqual([])

    await cycleTrack(rerender, 't50')
    expect(requestedIds).toEqual(['t50'])

    requestedIds.length = 0
    await cycleTrack(rerender, 't0')
    expect(requestedIds).toEqual([])

    requestedIds.length = 0
    await cycleTrack(rerender, 't1')
    expect(requestedIds).toEqual(['t1'])
  })
})
