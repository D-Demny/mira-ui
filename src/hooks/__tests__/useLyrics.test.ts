import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { __resetLyricsCache, primeLyricsCache, useLyrics } from '../useLyrics'
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
      http.get('*/lyrics/abc', ({ request }) => {
        if (!new URL(request.url).searchParams.get('richsync')) requested++
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
        if (!url.searchParams.get('richsync')) requestedIds.push(id)
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
        if (!url.searchParams.get('richsync')) requestedIds.push(id)
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

describe('useLyrics word-by-word upgrade', () => {
  const lineOnly: LyricsResult = {
    syncType: 'LINE_SYNCED',
    lines: [{ startTimeMs: '0', words: 'Hello world' }],
  }
  const wordLevel: LyricsResult = {
    syncType: 'LINE_SYNCED',
    lines: [
      {
        startTimeMs: '0',
        words: 'Hello world',
        syllables: [
          { startTimeMs: '0', word: 'Hello' },
          { startTimeMs: '500', word: ' world' },
        ],
      },
    ],
  }

  it('shows line-synced lyrics first, then upgrades to word-by-word', async () => {
    server.use(
      http.get('*/lyrics/abc', async ({ request }) => {
        const richsync = new URL(request.url).searchParams.get('richsync')
        if (richsync) {
          await new Promise((r) => setTimeout(r, 150))
          return HttpResponse.json(wordLevel)
        }
        return HttpResponse.json(lineOnly)
      }),
    )

    const { result } = renderHook(() => useLyrics(TRACK_META))

    // line synced appears fast (no word timing yet), loading done
    await waitFor(() => expect(result.current.lyrics).toEqual(lineOnly))
    expect(result.current.loading).toBe(false)

    // upgrade to word by word
    await waitFor(() => expect(result.current.lyrics).toEqual(wordLevel))
  })

  it('keeps the line-synced lyrics when the track has no word-by-word', async () => {
    server.use(http.get('*/lyrics/abc', () => HttpResponse.json(lineOnly)))

    const { result } = renderHook(() => useLyrics(TRACK_META))
    await waitFor(() => expect(result.current.lyrics).toEqual(lineOnly))
    await new Promise((r) => setTimeout(r, 250))
    expect(result.current.lyrics).toEqual(lineOnly)
  })
})

// issue #26: the layout owner (App) derives the split-view decision from this state.
// A track change must keep the previous track's confirmed lyrics in state while the
// new fetch is in flight (loading=true), so the layout stays sticky and only flips
// on a confirmed resolve. These tests pin that state shape per switch direction.
describe('useLyrics issue #26: state across track changes (sticky layout)', () => {
  const aLyrics: LyricsResult = {
    syncType: 'LINE_SYNCED',
    lines: [{ startTimeMs: '0', words: 'A song line' }],
  }
  const bLyrics: LyricsResult = {
    syncType: 'LINE_SYNCED',
    lines: [{ startTimeMs: '0', words: 'B song line' }],
  }

  function renderTrackSwitch() {
    return renderHook(
      ({ trackId }: { trackId: string }) => useLyrics({ trackId, trackName: 'X', artist: 'Y' }),
      { initialProps: { trackId: 'a-id' } },
    )
  }

  it('with-lyrics -> with-lyrics: keeps the previous lyrics in state during the fetch window', async () => {
    let releaseB: (() => void) | null = null
    const bPending = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    server.use(
      http.get('*/lyrics/a-id', () => HttpResponse.json(aLyrics)),
      http.get('*/lyrics/b-id', async ({ request }) => {
        if (new URL(request.url).searchParams.get('richsync')) return HttpResponse.json(bLyrics)
        await bPending
        return HttpResponse.json(bLyrics)
      }),
    )

    const { result, rerender } = renderTrackSwitch()
    await waitFor(() => expect(result.current.lyrics).toEqual(aLyrics))

    act(() => {
      rerender({ trackId: 'b-id' })
    })

    // fetch in flight for B: state still carries A (the last confirmed decision),
    // flagged loading — this is what keeps the split view active, no standard flash
    expect(result.current).toEqual({ lyrics: aLyrics, loading: true, error: null })

    releaseB!()
    await waitFor(() => expect(result.current.lyrics).toEqual(bLyrics))
    expect(result.current.loading).toBe(false)
  })

  it('with-lyrics -> no-lyrics: stale lyrics only clear on the confirmed empty result', async () => {
    server.use(
      http.get('*/lyrics/a-id', () => HttpResponse.json(aLyrics)),
      http.get('*/lyrics/b-id', ({ request }) => {
        if (new URL(request.url).searchParams.get('richsync'))
          return new HttpResponse(null, { status: 404 })
        return new HttpResponse(null, { status: 404 })
      }),
    )

    const { result, rerender } = renderTrackSwitch()
    await waitFor(() => expect(result.current.lyrics).toEqual(aLyrics))

    act(() => {
      rerender({ trackId: 'b-id' })
    })

    // while B is being fetched the previous decision (lyrics) is still in state
    expect(result.current).toEqual({ lyrics: aLyrics, loading: true, error: null })

    // confirmed empty: cleared, no error (404 = no lyrics, not a failure)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.lyrics).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('no-lyrics -> with-lyrics: stays null while fetching, fills in on arrival', async () => {
    let releaseB: (() => void) | null = null
    const bPending = new Promise<void>((resolve) => {
      releaseB = resolve
    })
    server.use(
      http.get('*/lyrics/a-id', () => new HttpResponse(null, { status: 404 })),
      http.get('*/lyrics/b-id', async ({ request }) => {
        if (new URL(request.url).searchParams.get('richsync')) return HttpResponse.json(bLyrics)
        await bPending
        return HttpResponse.json(bLyrics)
      }),
    )

    const { result, rerender } = renderTrackSwitch()
    // A confirmed: no lyrics
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.lyrics).toBeNull()

    act(() => {
      rerender({ trackId: 'b-id' })
    })

    // nothing was confirmed before, so the in-flight state is a fresh load
    expect(result.current).toEqual({ lyrics: null, loading: true, error: null })

    releaseB!()
    await waitFor(() => expect(result.current.lyrics).toEqual(bLyrics))
    expect(result.current.loading).toBe(false)
  })

  it('richsync upgrade mid-play after a track switch still lands in state', async () => {
    const cLineOnly: LyricsResult = {
      syncType: 'LINE_SYNCED',
      lines: [{ startTimeMs: '0', words: 'C line' }],
    }
    const cWordLevel: LyricsResult = {
      syncType: 'LINE_SYNCED',
      lines: [
        {
          startTimeMs: '0',
          words: 'C line',
          syllables: [
            { startTimeMs: '0', word: 'C' },
            { startTimeMs: '300', word: ' line' },
          ],
        },
      ],
    }
    server.use(
      http.get('*/lyrics/a-id', () => HttpResponse.json(aLyrics)),
      http.get('*/lyrics/c-id', async ({ request }) => {
        if (new URL(request.url).searchParams.get('richsync')) {
          await new Promise((r) => setTimeout(r, 100))
          return HttpResponse.json(cWordLevel)
        }
        return HttpResponse.json(cLineOnly)
      }),
    )

    const { result, rerender } = renderTrackSwitch()
    await waitFor(() => expect(result.current.lyrics).toEqual(aLyrics))

    act(() => {
      rerender({ trackId: 'c-id' })
    })
    // main fetch resolves to line-synced (layout confirmed active)
    await waitFor(() => expect(result.current.lyrics).toEqual(cLineOnly))
    expect(result.current.loading).toBe(false)

    // mid-play word-by-word upgrade updates the confirmed state without clearing it
    await waitFor(() => expect(result.current.lyrics).toEqual(cWordLevel))
    expect(result.current.loading).toBe(false)
  })

  it('switches to a cached track instantly with no fetch window', async () => {
    // b-id is only hit by the background word-by-word upgrade (no syllables -> mark tried)
    server.use(
      http.get('*/lyrics/a-id', () => HttpResponse.json(aLyrics)),
      http.get('*/lyrics/b-id', ({ request }) => {
        if (!new URL(request.url).searchParams.get('richsync'))
          throw new Error('unexpected main fetch for cached track')
        return HttpResponse.json(bLyrics)
      }),
    )

    const { result, rerender } = renderTrackSwitch()
    await waitFor(() => expect(result.current.lyrics).toEqual(aLyrics))

    // e.g. usePrefetch already warmed B — the switch must not open a loading window
    primeLyricsCache('b-id', bLyrics)
    act(() => {
      rerender({ trackId: 'b-id' })
    })

    expect(result.current).toEqual({ lyrics: bLyrics, loading: false, error: null })
  })
})
