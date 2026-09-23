import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  usePlaylistTracks,
  clearTracksCache,
  __playlistTracksCacheStats,
  LIKED_SONGS_ID,
  MAX_CACHED_PLAYLISTS,
  MAX_TRACKS_PER_ENTRY,
} from '../usePlaylistTracks'

const PAGE = 50

function trackPage(id: string, offset: number, total: number) {
  const items = []
  for (let i = offset; i < Math.min(offset + PAGE, total); i++) {
    items.push({
      is_local: false,
      track: {
        id: `${id}-${i}`,
        name: `Track ${i}`,
        uri: `spotify:track:${id}-${i}`,
        artists: [{ name: 'Someone' }],
      },
    })
  }
  return HttpResponse.json({
    items,
    total,
    limit: PAGE,
    offset,
    next: offset + PAGE < total ? `http://next/${id}?offset=${offset + PAGE}` : null,
  })
}

describe('usePlaylistTracks', () => {
  beforeEach(() => {
    clearTracksCache()
    vi.useRealTimers()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('fetches the first page and exposes the track count', async () => {
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        return trackPage('pl-1', offset, 60)
      }),
    )

    const { result } = renderHook(() => usePlaylistTracks('pl-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tracks).toHaveLength(50)
    expect(result.current.total).toBe(60)
    expect(result.current.tracks[0].id).toBe('pl-1-0')
    expect(result.current.tracks[49].id).toBe('pl-1-49')
  })

  it('bug22: Liked Songs pages from me/tracks instead of playlists/<id>/tracks', async () => {
    let playlistHits = 0
    let savedHits = 0
    server.use(
      http.get('*/web-api/playlists/*/tracks', () => {
        playlistHits++
        return trackPage('x', 0, 0)
      }),
      http.get('*/web-api/me/tracks', ({ request }) => {
        savedHits++
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        return trackPage('liked', offset, 10)
      }),
    )

    const { result } = renderHook(() => usePlaylistTracks(LIKED_SONGS_ID))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tracks).toHaveLength(10)
    expect(result.current.tracks[0].id).toBe('liked-0')
    expect(savedHits).toBe(1)
    expect(playlistHits).toBe(0)
  })

  it('appends the next page via loadMore and stops at the total (bug5)', async () => {
    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        return trackPage('pl-1', offset, 60)
      }),
    )

    const { result } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(requests).toBe(1)

    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.tracks).toHaveLength(60))
    expect(requests).toBe(2)
    expect(result.current.loadingMore).toBe(false)

    // nothing left to load — further calls are no-ops
    act(() => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.tracks).toHaveLength(60))
    expect(requests).toBe(2)
  })

  it('bug7+#56: re-opening a warm (<TTL) playlist renders the cache instantly and revalidates page 0 silently', async () => {
    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        // complete list (2 < PAGE) so no lazy tail fetch is triggered
        return trackPage('pl-1', offset, 2)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(requests).toBe(1)
    firstUnmount()

    // re-open the same playlist within the TTL: the cached list renders
    // instantly (no loading flash) and page 0 is revalidated silently in the
    // background — one extra live fetch, no cold reload (#56)
    const { result: secondResult, unmount: secondUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    expect(secondResult.current.loading).toBe(false)
    expect(secondResult.current.tracks).toHaveLength(2)
    await waitFor(() => expect(requests).toBe(2))
    secondUnmount()
  })

  it('expires the cache after the TTL and refetches (bug7)', async () => {
    // fake Date.now instead of the event-loop timers: MSW does not survive
    // vi.useFakeTimers()
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000_000_000
    nowSpy.mockImplementation(() => now)

    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        return trackPage('pl-1', offset, 2)
      }),
    )

    const { result, unmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(requests).toBe(1)
    unmount()

    now += 5 * 60 * 1000 + 1

    const { result: againResult, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    // bug37: the stale entry renders instantly (loading is already false);
    // the refetch itself lands silently in the background
    expect(againResult.current.loading).toBe(false)
    await waitFor(() => expect(requests).toBe(2))
    againUnmount()
    nowSpy.mockRestore()
  })

  it('bug37: a stale cache renders instantly without loading and revalidates page 0 silently', async () => {
    // fake Date.now instead of the event-loop timers: MSW does not survive
    // vi.useFakeTimers()
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000_000_000
    nowSpy.mockImplementation(() => now)

    let requests = 0
    let freshHead = false
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        if (freshHead && offset === 0) {
          // the playlist head was edited: track 0 got a new name
          return HttpResponse.json({
            items: [
              {
                is_local: false,
                track: {
                  id: 'pl-1-0',
                  name: 'Track 0 (new)',
                  uri: 'spotify:track:pl-1-0',
                  artists: [{ name: 'Someone' }],
                },
              },
              {
                is_local: false,
                track: {
                  id: 'pl-1-1',
                  name: 'Track 1',
                  uri: 'spotify:track:pl-1-1',
                  artists: [{ name: 'Someone' }],
                },
              },
            ],
            total: 2,
            limit: PAGE,
            offset: 0,
            next: null,
          })
        }
        return trackPage('pl-1', offset, 2)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(requests).toBe(1)
    firstUnmount()

    // let the TTL expire; the server now answers with the edited head
    now += 5 * 60 * 1000 + 1
    freshHead = true

    const { result: againResult, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    // cache-first: the stale list renders IMMEDIATELY — no loading state
    expect(againResult.current.loading).toBe(false)
    expect(againResult.current.tracks).toHaveLength(2)
    expect(againResult.current.tracks[0].name).toBe('Track 0')

    // the silent revalidation lands and replaces the head, still without
    // any loading state
    await waitFor(() => expect(againResult.current.tracks[0].name).toBe('Track 0 (new)'))
    expect(againResult.current.tracks).toHaveLength(2)
    expect(requests).toBe(2)
    expect(againResult.current.loading).toBe(false)
    againUnmount()
    nowSpy.mockRestore()
  })

  it('bug37: silent revalidation keeps the already-loaded tail beyond page 0', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000_000_000
    nowSpy.mockImplementation(() => now)

    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        return trackPage('pl-1', offset, 60)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(firstResult.current.tracks).toHaveLength(50)
    firstUnmount()

    // let the TTL expire (the cache holds only page 0)
    now += 5 * 60 * 1000 + 1

    const { result: againResult, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    // cache-first: the stale page renders instantly, no loading state
    expect(againResult.current.loading).toBe(false)
    expect(againResult.current.tracks).toHaveLength(50)

    // the silent revalidation fetches page 0 only (request 2), merges it,
    // then the lazy tail resumes (request 3) — the list stays complete
    await waitFor(() => expect(againResult.current.tracks).toHaveLength(60))
    expect(requests).toBe(3)
    expect(againResult.current.loading).toBe(false)
    expect(againResult.current.tracks[59].id).toBe('pl-1-59')
    againUnmount()
    nowSpy.mockRestore()
  })

  it('clearTracksCache drops cached track lists (bug7)', async () => {
    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        return trackPage('pl-1', offset, 2)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(requests).toBe(1)
    firstUnmount()

    clearTracksCache()

    const { result: secondResult, unmount: secondUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(secondResult.current.loading).toBe(false))
    expect(requests).toBe(2)
    secondUnmount()
  })

  it('keeps a partial cache and resumes lazy loading (bug5+bug7)', async () => {
    let requests = 0
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        return trackPage('pl-1', offset, 60)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(firstResult.current.tracks).toHaveLength(50)
    firstUnmount()

    // re-open within the TTL: the cached page arrives instantly, then the
    // per-open page-0 revalidation (#56) lands and the missing tail resumes
    const { result: secondResult, unmount: secondUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(secondResult.current.tracks).toHaveLength(50))
    await waitFor(() => expect(secondResult.current.tracks).toHaveLength(60))
    // 1st open + page-0 revalidation + lazy tail resume
    expect(requests).toBe(3)
    secondUnmount()
  })

  // issue #15 → issue #56 (T14): the library (liked AND normal playlists) is
  // edited from other devices while this session holds a warm cache — every
  // open of EVERY playlist must revalidate page 0 live. The 5-minute TTL
  // still bounds how long fetched tails are kept in the cache (bug7), but it
  // no longer suppresses the per-open revalidation.
  it('issue #15/#56: a warm (<TTL) cache revalidates page 0 on open for liked AND normal playlists', async () => {
    let savedRequests = 0
    let playlistRequests = 0
    server.use(
      http.get('*/web-api/me/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        savedRequests++
        return trackPage('liked', offset, 3) // complete (< PAGE): no lazy tail
      }),
      http.get('*/web-api/playlists/pl-1/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        playlistRequests++
        return trackPage('pl-1', offset, 2) // complete: no lazy tail
      }),
    )

    // warm both caches
    const { result: likedFirst, unmount: likedFirstUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    await waitFor(() => expect(likedFirst.current.loading).toBe(false))
    likedFirstUnmount()
    const { result: plFirst, unmount: plFirstUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(plFirst.current.loading).toBe(false))
    plFirstUnmount()
    expect(savedRequests).toBe(1)
    expect(playlistRequests).toBe(1)

    // re-open within the TTL: BOTH lists fetch their page 0 live (cached
    // content renders first, no loading flash) — liked via me/tracks, the
    // normal playlist via playlists/<id>/tracks (#56)
    const { result: likedAgain, unmount: likedAgainUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    expect(likedAgain.current.loading).toBe(false)
    await waitFor(() => expect(savedRequests).toBe(2))
    expect(likedAgain.current.tracks).toHaveLength(3)
    likedAgainUnmount()

    const { result: plAgain, unmount: plAgainUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(plAgain.current.loading).toBe(false)
    await waitFor(() => expect(playlistRequests).toBe(2))
    expect(plAgain.current.tracks).toHaveLength(2)
    plAgainUnmount()
  })

  it('issue #56: a NON-liked playlist open triggers a fresh page-0 fetch within the TTL (bug37 merge applies)', async () => {
    let requests = 0
    let edited = false
    server.use(
      http.get('*/web-api/playlists/pl-9/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        requests++
        if (edited && offset === 0) {
          // the playlist head was edited out-of-band: track 0 got a new name
          return HttpResponse.json({
            items: [
              {
                is_local: false,
                track: {
                  id: 'pl-9-0',
                  name: 'Track 0 (new)',
                  uri: 'spotify:track:pl-9-0',
                  artists: [{ name: 'Someone' }],
                },
              },
              {
                is_local: false,
                track: {
                  id: 'pl-9-1',
                  name: 'Track 1',
                  uri: 'spotify:track:pl-9-1',
                  artists: [{ name: 'Someone' }],
                },
              },
            ],
            total: 2,
            limit: PAGE,
            offset: 0,
            next: null,
          })
        }
        return trackPage('pl-9', offset, 2)
      }),
    )

    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks('pl-9'),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    expect(requests).toBe(1)
    firstUnmount()

    // the playlist changes; re-open WITHIN the TTL — no expiry involved, so
    // only the #56 per-open revalidation can pick up the new head
    edited = true
    const { result: againResult, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks('pl-9'),
    )
    // cache-first: the old list renders instantly, no loading flash
    expect(againResult.current.loading).toBe(false)
    expect(againResult.current.tracks[0].name).toBe('Track 0')

    // the live page-0 fetch lands and the bug37 merge updates the head
    await waitFor(() => expect(againResult.current.tracks[0].name).toBe('Track 0 (new)'))
    expect(againResult.current.tracks).toHaveLength(2)
    expect(requests).toBe(2)
    againUnmount()
  })

  it('issue #15: a fresh liked page 0 is authoritative — new likes on top, unliked tracks drop, deep tail survives', async () => {
    // the "server" library changes between the two opens: N1 gets liked (new
    // head), liked-2 gets unliked; everything else stays put (55 total)
    const fullAfter = [
      'N1',
      'liked-0',
      'liked-1',
      ...Array.from({ length: 46 }, (_, i) => `liked-${i + 3}`), // liked-3..liked-48
      ...Array.from({ length: 6 }, (_, i) => `liked-${i + 49}`), // liked-49..liked-54
    ]
    const pageAfter = (offset: number) => ({
      items: fullAfter.slice(offset, offset + PAGE).map((id) => ({
        is_local: false,
        track: {
          id,
          name: `Track ${id}`,
          uri: `spotify:track:${id}`,
          artists: [{ name: 'Someone' }],
        },
      })),
      total: fullAfter.length,
      limit: PAGE,
      offset,
      next: null,
    })
    let mutated = false
    let savedRequests = 0
    server.use(
      http.get('*/web-api/me/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        savedRequests++
        return mutated ? HttpResponse.json(pageAfter(offset)) : trackPage('liked', offset, 55)
      }),
    )

    // first open: load the full list (page 0 + one more page)
    const { result: firstResult, unmount: firstUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    await waitFor(() => expect(firstResult.current.loading).toBe(false))
    act(() => {
      firstResult.current.loadMore()
    })
    await waitFor(() => expect(firstResult.current.tracks).toHaveLength(55))
    firstUnmount()

    // the library changes; re-open within the TTL (the issue #15 bypass)
    mutated = true
    const { result: againResult, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    // cache-first: the old list renders instantly, no loading flash...
    expect(againResult.current.loading).toBe(false)
    expect(againResult.current.tracks).toHaveLength(55)

    // ...then the live page 0 swap lands: N1 on top, liked-2 gone (it was in
    // the previous page-0 window and is absent from the fresh data), deep
    // tail liked-50..54 preserved in order; total met → no tail refetch
    await waitFor(() => expect(againResult.current.tracks[0].id).toBe('N1'))
    const ids = againResult.current.tracks.map((t) => t.id)
    expect(ids).not.toContain('liked-2')
    expect(ids.slice(-5)).toEqual(['liked-50', 'liked-51', 'liked-52', 'liked-53', 'liked-54'])
    expect(againResult.current.tracks).toHaveLength(55)
    expect(againResult.current.total).toBe(55)
    // exactly one revalidation fetch — no multi-page storm (rate-limit bound)
    expect(savedRequests).toBe(3)
    againUnmount()
  })
})

describe('usePlaylistTracks — bug45 option C cache bounds', () => {
  beforeEach(() => {
    clearTracksCache()
    vi.useRealTimers()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('the approved bounds are in effect (32 entries, 300 tracks per entry, 5 min TTL)', () => {
    expect(MAX_CACHED_PLAYLISTS).toBe(32)
    expect(MAX_TRACKS_PER_ENTRY).toBe(300)
    expect(__playlistTracksCacheStats()).toMatchObject({
      maxEntries: 32,
      maxTracksPerEntry: 300,
      ttlMs: 5 * 60 * 1000,
    })
  })

  // shared plumbing: every playlist id under the wildcard serves its own
  // single-track list (complete, so no lazy tail fetch fires)
  const idFrom = (url: string): string => /playlists\/([^/]+)\/tracks/.exec(url)?.[1] ?? '?'

  function singleTrackHandler(requests: Record<string, number>) {
    server.use(
      http.get('*/web-api/playlists/*/tracks', ({ request }) => {
        const id = idFrom(request.url)
        requests[id] = (requests[id] ?? 0) + 1
        return trackPage(id, 0, 1)
      }),
    )
  }

  async function openSingle(id: string, requests: Record<string, number>) {
    singleTrackHandler(requests)
    const { result, unmount } = renderHook(() => usePlaylistTracks(id))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tracks).toHaveLength(1)
    unmount()
  }

  it('evicts the oldest entry once the 32-playlist cap is exceeded (FIFO, insertion order)', async () => {
    const requests: Record<string, number> = {}
    for (let i = 1; i <= 33; i++) {
      await openSingle(`pl-${i}`, requests)
    }

    // the map is capped: 32 entries, the first playlist is the eviction victim
    const stats = __playlistTracksCacheStats()
    expect(stats.entries).toBe(MAX_CACHED_PLAYLISTS)
    expect(stats.tracks).toBe(MAX_CACHED_PLAYLISTS)

    // pl-2 and pl-33 are still cached: instant render, no loading flash
    // (checked before re-opening pl-1, whose cold-miss write would evict pl-2
    // in turn); the per-open page-0 revalidation (#56) lands silently right
    // after
    const { result: second, unmount: secondUnmount } = renderHook(() => usePlaylistTracks('pl-2'))
    expect(second.current.loading).toBe(false)
    await waitFor(() => expect(requests['pl-2']).toBe(2))
    secondUnmount()

    const { result: newest, unmount: newestUnmount } = renderHook(() => usePlaylistTracks('pl-33'))
    expect(newest.current.loading).toBe(false)
    await waitFor(() => expect(requests['pl-33']).toBe(2))
    newestUnmount()

    // pl-1 is gone: re-opening it is a cold miss
    const { result: first, unmount: firstUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(first.current.loading).toBe(true)
    await waitFor(() => expect(requests['pl-1']).toBe(2))
    firstUnmount()
  })

  it('never evicts the newest entry: the just-opened playlist bumps to newest on write', async () => {
    const requests: Record<string, number> = {}
    server.use(
      http.get('*/web-api/playlists/*/tracks', ({ request }) => {
        const id = idFrom(request.url)
        requests[id] = (requests[id] ?? 0) + 1
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        // pl-1 is partial (50 of 60), the rest single-track
        return trackPage(id, offset, id === 'pl-1' ? 60 : 1)
      }),
    )

    const { result: p1, unmount: p1Unmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(p1.current.loading).toBe(false))
    p1Unmount()
    for (let i = 2; i <= 32; i++) {
      const { result, unmount } = renderHook(() => usePlaylistTracks(`pl-${i}`))
      await waitFor(() => expect(result.current.loading).toBe(false))
      unmount()
    }
    expect(__playlistTracksCacheStats().entries).toBe(MAX_CACHED_PLAYLISTS)

    // re-open pl-1 (fresh but partial): the lazy tail resume writes the entry
    // and bumps it to newest (order becomes pl-2..pl-32, pl-1)
    const { result: p1again, unmount: p1AgainUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(p1again.current.loading).toBe(false) // cache-first: instant
    await waitFor(() => expect(p1again.current.tracks).toHaveLength(60))
    p1AgainUnmount()

    // the 33rd playlist overflows: the eviction victim is pl-2 (the new
    // oldest), never pl-1 (the playlist that was just open)
    const { result: p33, unmount: p33Unmount } = renderHook(() => usePlaylistTracks('pl-33'))
    await waitFor(() => expect(p33.current.loading).toBe(false))
    p33Unmount()
    expect(__playlistTracksCacheStats().entries).toBe(MAX_CACHED_PLAYLISTS)

    // pl-1 and pl-33 survived (instant render; the per-open page-0
    // revalidation, #56, bumps each counter once per open)
    const { result: p1check, unmount: p1CheckUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(p1check.current.loading).toBe(false)
    await waitFor(() => expect(requests['pl-1']).toBe(4))
    p1CheckUnmount()
    const { result: p33check, unmount: p33CheckUnmount } = renderHook(() =>
      usePlaylistTracks('pl-33'),
    )
    expect(p33check.current.loading).toBe(false)
    await waitFor(() => expect(requests['pl-33']).toBe(2))
    p33CheckUnmount()

    // pl-2 was evicted: re-opening it is a cold miss
    const { result: p2check, unmount: p2CheckUnmount } = renderHook(() => usePlaylistTracks('pl-2'))
    expect(p2check.current.loading).toBe(true)
    await waitFor(() => expect(requests['pl-2']).toBe(2))
    p2CheckUnmount()
  })

  it('drops stale entries on the read path so the TTL bounds the map (not just revalidates in place)', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000_000_000
    nowSpy.mockImplementation(() => now)

    const requests: Record<string, number> = {}
    singleTrackHandler(requests)

    const { result: r1, unmount: r1Unmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(r1.current.loading).toBe(false))
    r1Unmount()
    const { result: r2, unmount: r2Unmount } = renderHook(() => usePlaylistTracks('pl-2'))
    await waitFor(() => expect(r2.current.loading).toBe(false))
    r2Unmount()
    expect(__playlistTracksCacheStats().entries).toBe(2)

    // both go stale; opening a third playlist drops them on the read path
    now += 5 * 60 * 1000 + 1
    const { result: r3, unmount: r3Unmount } = renderHook(() => usePlaylistTracks('pl-3'))
    await waitFor(() => expect(r3.current.loading).toBe(false))
    r3Unmount()
    expect(__playlistTracksCacheStats().entries).toBe(1)

    // pl-1 is gone: re-opening it is a cold miss
    const { result: r1again, unmount: r1AgainUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(r1again.current.loading).toBe(true)
    await waitFor(() => expect(requests['pl-1']).toBe(2))
    r1AgainUnmount()
    nowSpy.mockRestore()
  })

  it('TTL interplay with bug37: a revalidated stale entry survives, a stale sibling is dropped', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000_000_000
    nowSpy.mockImplementation(() => now)

    let edited = false
    const requests: Record<string, number> = {}
    server.use(
      http.get('*/web-api/playlists/*/tracks', ({ request }) => {
        const id = idFrom(request.url)
        requests[id] = (requests[id] ?? 0) + 1
        if (id === 'pl-1' && edited) {
          // the head changed while the entry was stale
          return HttpResponse.json({
            items: [
              {
                is_local: false,
                track: {
                  id: 'pl-1-0',
                  name: 'Track 0 (edited)',
                  uri: 'spotify:track:pl-1-0',
                  artists: [{ name: 'Someone' }],
                },
              },
            ],
            total: 1,
            limit: PAGE,
            offset: 0,
            next: null,
          })
        }
        return trackPage(id, 0, 1)
      }),
    )

    const { result: r1, unmount: r1Unmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(r1.current.loading).toBe(false))
    r1Unmount()
    const { result: r2, unmount: r2Unmount } = renderHook(() => usePlaylistTracks('pl-2'))
    await waitFor(() => expect(r2.current.loading).toBe(false))
    r2Unmount()

    // both go stale; re-open pl-1
    now += 5 * 60 * 1000 + 1
    edited = true
    const { result: r1again, unmount: r1AgainUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    // bug37: the stale entry renders instantly, no loading flash
    expect(r1again.current.loading).toBe(false)
    expect(r1again.current.tracks).toHaveLength(1)

    // the silent revalidation lands: pl-1 survives with a refreshed
    // fetchedAt, the stale sibling pl-2 has been dropped
    await waitFor(() => expect(r1again.current.tracks[0].name).toBe('Track 0 (edited)'))
    expect(__playlistTracksCacheStats().entries).toBe(1)
    expect(__playlistTracksCacheStats().tracks).toBe(1)
    r1AgainUnmount()

    // pl-2 is gone: re-opening it is a cold miss
    const { result: r2again, unmount: r2AgainUnmount } = renderHook(() => usePlaylistTracks('pl-2'))
    expect(r2again.current.loading).toBe(true)
    await waitFor(() => expect(requests['pl-2']).toBe(2))
    r2AgainUnmount()

    // pl-1 is fresh now: a re-open renders instantly and fires one more
    // silent page-0 revalidation (#56), no cold reload
    const { result: r1fresh, unmount: r1FreshUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(r1fresh.current.loading).toBe(false)
    expect(r1fresh.current.tracks[0].name).toBe('Track 0 (edited)')
    await waitFor(() => expect(requests['pl-1']).toBe(3))
    r1FreshUnmount()
    nowSpy.mockRestore()
  })

  it('caps each entry at 300 tracks: deeper pages are served but not cached, total stays exact', async () => {
    const TOTAL = 400
    const requests: Record<string, number> = {}
    server.use(
      http.get('*/web-api/playlists/*/tracks', ({ request }) => {
        const id = idFrom(request.url)
        requests[id] = (requests[id] ?? 0) + 1
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        return trackPage(id, offset, TOTAL)
      }),
    )

    // page through the full list (50 tracks per page)
    const { result, unmount } = renderHook(() => usePlaylistTracks('pl-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tracks).toHaveLength(50)
    expect(result.current.total).toBe(TOTAL)
    while (result.current.tracks.length < TOTAL) {
      const before = result.current.tracks.length
      act(() => {
        result.current.loadMore()
      })
      await waitFor(() => expect(result.current.tracks.length).toBeGreaterThan(before))
    }

    // the full list is rendered in memory with the exact total...
    expect(result.current.tracks).toHaveLength(TOTAL)
    expect(result.current.total).toBe(TOTAL)
    // ...but the cache entry keeps only the first 300 tracks
    const stats = __playlistTracksCacheStats()
    expect(stats.entries).toBe(1)
    expect(stats.tracks).toBe(MAX_TRACKS_PER_ENTRY)
    expect(stats.approxBytes).toBe(MAX_TRACKS_PER_ENTRY * 500)
    unmount()

    // re-open within the TTL: the capped entry is served instantly (300
    // tracks, exact total) and the deep tail is re-fetched on demand — the
    // same cost class the 5-min TTL already imposes
    const { result: again, unmount: againUnmount } = renderHook(() => usePlaylistTracks('pl-1'))
    expect(again.current.loading).toBe(false)
    expect(again.current.tracks).toHaveLength(300)
    expect(again.current.total).toBe(TOTAL)
    await waitFor(() => expect(again.current.tracks.length).toBe(350)) // lazy tail resume
    expect(__playlistTracksCacheStats().tracks).toBe(MAX_TRACKS_PER_ENTRY) // still capped

    // loadMore still works beyond the cached range
    act(() => {
      again.current.loadMore()
    })
    await waitFor(() => expect(again.current.tracks).toHaveLength(TOTAL))
    expect(again.current.total).toBe(TOTAL)
    expect(__playlistTracksCacheStats().tracks).toBe(MAX_TRACKS_PER_ENTRY)
    againUnmount()
  })
})
