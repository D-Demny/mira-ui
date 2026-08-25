import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { usePlaylistTracks, clearTracksCache, LIKED_SONGS_ID } from '../usePlaylistTracks'

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

  it('serves a previously viewed playlist from the cache within 5 minutes (bug7)', async () => {
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

    // re-open the same playlist: instant, no network
    const { result: secondResult, unmount: secondUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(secondResult.current.tracks).toHaveLength(2))
    expect(requests).toBe(1)
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

    // re-open within the TTL: the cached page arrives instantly, the missing
    // tail is fetched in the background
    const { result: secondResult, unmount: secondUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(secondResult.current.tracks).toHaveLength(50))
    await waitFor(() => expect(secondResult.current.tracks).toHaveLength(60))
    expect(requests).toBe(2)
    secondUnmount()
  })
})
