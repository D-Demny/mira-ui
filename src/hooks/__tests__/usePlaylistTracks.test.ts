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
    await waitFor(() => expect(againResult.current.loading).toBe(false))
    expect(requests).toBe(2)
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
