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

  describe('bug37: silent background revalidation (cache-first)', () => {
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

    it('keeps the stale items rendered without a loading state and swaps them on arrival', async () => {
      let calls = 0
      let release: () => void = () => {}
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      server.use(
        http.get('*/web-api/me/player/recently-played', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ items: mockRecent })
          await pending
          return HttpResponse.json({ items: [secondItem, ...mockRecent] })
        }),
      )

      const { result } = renderHook(() => useRecent())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.items).toEqual(mockRecent)

      await act(async () => {
        result.current.refresh()
      })
      // silent: second call in flight, but no loading-state flip and the
      // stale items are still rendered
      expect(calls).toBe(2)
      expect(result.current.loading).toBe(false)
      expect(result.current.items).toEqual(mockRecent)
      expect(result.current.error).toBeNull()

      release()
      await waitFor(() => expect(result.current.items).toHaveLength(2))
      expect(result.current.items[0]).toEqual(secondItem)
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('keeps the stale items on screen when the revalidation fails', async () => {
      let calls = 0
      server.use(
        http.get('*/web-api/me/player/recently-played', () => {
          calls += 1
          return calls === 1
            ? HttpResponse.json({ items: mockRecent })
            : new HttpResponse(null, { status: 500 })
        }),
      )

      const { result } = renderHook(() => useRecent())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.items).toEqual(mockRecent)

      let refreshDone: Promise<void> | undefined
      await act(async () => {
        refreshDone = result.current.refresh()
      })
      await waitFor(() => expect(calls).toBe(2))
      await act(async () => {
        await refreshDone
      })

      // the failed revalidation keeps the stale items, no error surfaced
      // while they are rendered
      expect(result.current.loading).toBe(false)
      expect(result.current.items).toEqual(mockRecent)
      expect(result.current.error).toBeNull()
    })

    it('degrades to the loading fetch when nothing is rendered yet', async () => {
      let calls = 0
      let release: () => void = () => {}
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      server.use(
        http.get('*/web-api/me/player/recently-played', async () => {
          calls += 1
          if (calls === 1) return new HttpResponse(null, { status: 500 })
          await pending
          return new HttpResponse(null, { status: 500 })
        }),
      )

      const { result } = renderHook(() => useRecent())
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.items).toEqual([])
      expect(result.current.error).not.toBeNull()

      await act(async () => {
        result.current.refresh()
      })
      // nothing cached → the regular loading state applies (Lade → error)
      expect(calls).toBe(2)
      expect(result.current.loading).toBe(true)

      release()
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.items).toEqual([])
      expect(result.current.error).not.toBeNull()
    })
  })
})
