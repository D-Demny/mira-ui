import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useRecent, clearRecentCache } from '../useRecent'
import { server } from '../../__tests__/msw-server'
import type { SpotifyRecentlyPlayedItem } from '@/api/types'

beforeEach(() => {
  clearRecentCache()
})

const mockRecent: SpotifyRecentlyPlayedItem[] = [
  {
    track: {
      id: 't1',
      name: 'Song One',
      artists: [{ name: 'Artist One' }],
      album: { name: 'Album One', images: [{ url: 'https://i.scdn.co/img/1' }] },
      uri: 'spotify:track:t1',
    },
    played_at: '2026-08-20T10:00:00Z',
  },
]

describe('useRecent', () => {
  it('fetches recently played tracks on mount and sets loading → data', async () => {
    server.use(
      http.get('*/web-api/me/player/recently-played', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('limit')).toBe('20')
        return HttpResponse.json({ items: mockRecent })
      }),
    )

    const { result } = renderHook(() => useRecent())

    // initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.items).toEqual(mockRecent)
    expect(result.current.error).toBeNull()
  })

  it('returns cached data on second render', async () => {
    let fetchCalled = false
    server.use(
      http.get('*/web-api/me/player/recently-played', () => {
        fetchCalled = true
        return HttpResponse.json({ items: mockRecent })
      }),
    )

    // first render — fetches
    const { result: r1 } = renderHook(() => useRecent())
    await waitFor(() => expect(r1.current.loading).toBe(false))
    expect(fetchCalled).toBe(true)

    // second render — should use cache, no fetch
    fetchCalled = false
    const { result: r2 } = renderHook(() => useRecent())
    expect(r2.current.loading).toBe(false)
    expect(r2.current.items).toEqual(mockRecent)
    // give MSW a tick to see if fetch was called
    await act(async () => {})
    expect(fetchCalled).toBe(false)
  })

  it('shows error on API failure', async () => {
    server.use(
      http.get('*/web-api/me/player/recently-played', () =>
        HttpResponse.json({ error: 'something went wrong' }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useRecent())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toContain('500')
  })

  it('refetches after cache invalidation', async () => {
    let callCount = 0
    const secondItem: SpotifyRecentlyPlayedItem = {
      track: {
        id: 't2',
        name: 'Song Two',
        artists: [{ name: 'Artist Two' }],
        album: { name: 'Album Two', images: [] },
        uri: 'spotify:track:t2',
      },
      played_at: '2026-08-20T11:00:00Z',
    }
    server.use(
      http.get('*/web-api/me/player/recently-played', () => {
        callCount++
        const items = callCount === 2 ? [secondItem, ...mockRecent] : mockRecent
        return HttpResponse.json({ items })
      }),
    )

    const { result } = renderHook(() => useRecent())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.length).toBe(1)
    expect(callCount).toBe(1)

    // refetch
    await act(async () => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.items.length).toBe(2))
    expect(callCount).toBe(2)
  })
})
