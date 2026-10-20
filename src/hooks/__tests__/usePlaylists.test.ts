import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { usePlaylists, clearCache, __playlistsCacheStats } from '../usePlaylists'
import { server } from '../../__tests__/msw-server'
import type { SpotifyPlaylist } from '@/api/types'
import { __resetSettings, updateSettings } from '@/settings'

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
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
        const extra = callCount === 2 ? ({ id: 'pl3', name: 'New' } as SpotifyPlaylist) : null
        const items = callCount === 2 ? [...mockPlaylists, extra] : mockPlaylists
        return HttpResponse.json({
          items,
          total: items.length,
          limit: 50,
          offset: 0,
        })
      }),
    )

    const { result } = renderHook(() => usePlaylists())
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

describe('usePlaylists - Music Assistant source (issue #138)', () => {
  const maPlaylists = [
    { item_id: '61', name: 'Rock', uri: 'library://playlist/61', image_url: 'http://10.0.0.4:8095/static/image/a.jpg' },
    { item_id: '62', name: 'Jazz', uri: 'library://playlist/62' },
  ]

  it('fetches the flattened MA library playlists and never touches the Spotify endpoint', async () => {
    updateSettings({ playbackSource: 'ma' })
    let spotifyCalls = 0
    server.use(
      http.get('*/web-api/me/playlists', () => {
        spotifyCalls++
        return HttpResponse.json({ items: mockPlaylists, total: 2, limit: 50, offset: 0 })
      }),
      http.get('*/ma/playlists', () => HttpResponse.json({ playlists: maPlaylists })),
    )

    const { result } = renderHook(() => usePlaylists())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(spotifyCalls).toBe(0)
    expect(result.current.items.map((p) => p.id)).toEqual(['61', '62'])
    expect(result.current.items[0]).toMatchObject({
      id: '61',
      name: 'Rock',
      uri: 'library://playlist/61',
      images: [{ url: 'http://10.0.0.4:8095/static/image/a.jpg' }],
    })
  })

  it('a live source switch clears the old list while the MA fetch is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    server.use(
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({ items: mockPlaylists, total: 2, limit: 50, offset: 0 }),
      ),
      http.get('*/ma/playlists', async () => {
        await gate
        return HttpResponse.json({ playlists: maPlaylists.slice(0, 1) })
      }),
    )

    // start on spotify and settle
    const { result } = renderHook(() => usePlaylists())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((p) => p.id)).toEqual(['pl1', 'pl2'])

    // flip the playback source while mounted (the MA fetch is gated -> in flight)
    await act(async () => {
      updateSettings({ playbackSource: 'ma' })
    })
    // the spotify list must not linger on screen while the MA fetch is in flight
    expect(result.current.items).toEqual([])

    release()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((p) => p.id)).toEqual(['61'])

    // both sources stay cached under their own keys: the spotify entry is
    // still there (stats read the 'playlists' key), the MA entry under its own
    expect(__playlistsCacheStats().items).toBe(2)
  })
})
