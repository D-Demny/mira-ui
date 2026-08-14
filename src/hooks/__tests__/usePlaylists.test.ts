import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { usePlaylists, clearCache } from '../usePlaylists'
import { server } from '../../__tests__/msw-server'
import type { SpotifyPlaylist } from '@/api/types'

beforeEach(() => {
  clearCache()
})

const mockPlaylists: SpotifyPlaylist[] = [
  {
    id: 'pl1',
    name: 'My Playlist',
    uri: 'spotify:playlist:pl1',
    owner: { display_name: 'User' },
    images: [{ url: 'https://i.scdn.co/img/1' }],
    tracks: { total: 10 },
    collaborative: false,
  },
  {
    id: 'pl2',
    name: 'Favorites',
    uri: 'spotify:playlist:pl2',
    owner: { display_name: 'User' },
    images: [{ url: 'https://i.scdn.co/img/2' }],
    tracks: { total: 25 },
    collaborative: false,
  },
]

describe('usePlaylists', () => {
  it('fetches playlists on mount and sets loading → data', async () => {
    server.use(
      http.get('*/web-api/me/playlists', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('limit')).toBe('50')
        return HttpResponse.json({
          items: mockPlaylists,
          total: mockPlaylists.length,
          limit: 50,
          offset: 0,
        })
      }),
    )

    const { result } = renderHook(() => usePlaylists())

    // initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.items).toEqual(mockPlaylists)
    expect(result.current.error).toBeNull()
  })

  it('returns cached data on second render', async () => {
    let fetchCalled = false
    server.use(
      http.get('*/web-api/me/playlists', () => {
        fetchCalled = true
        return HttpResponse.json({
          items: mockPlaylists,
          total: mockPlaylists.length,
          limit: 50,
          offset: 0,
        })
      }),
    )

    // first render — fetches
    const { result: r1 } = renderHook(() => usePlaylists())
    await waitFor(() => expect(r1.current.loading).toBe(false))
    expect(fetchCalled).toBe(true)

    // second render — should use cache, no fetch
    fetchCalled = false
    const { result: r2 } = renderHook(() => usePlaylists())
    expect(r2.current.loading).toBe(false)
    expect(r2.current.items).toEqual(mockPlaylists)
    // give MSW a tick to see if fetch was called
    await act(async () => {})
    expect(fetchCalled).toBe(false)
  })

  it('shows error on API failure', async () => {
    server.use(
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({ error: 'something went wrong' }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => usePlaylists())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('500')
  })

  it('refetches after cache invalidation', async () => {
    let callCount = 0
    server.use(
      http.get('*/web-api/me/playlists', () => {
        callCount++
        const extra = callCount === 2 ? { id: 'pl3', name: 'New' } as SpotifyPlaylist : null
        const items = callCount === 2
          ? [...mockPlaylists, extra]
          : mockPlaylists
        return HttpResponse.json({
          items,
          total: items.length,
          limit: 50,
          offset: 0,
        })
      }),
    )

    const { result, rerender } = renderHook(() => usePlaylists())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.length).toBe(2)
    expect(callCount).toBe(1)

    // refetch
    await act(async () => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.items.length).toBe(3))
    expect(callCount).toBe(2)
  })
})
