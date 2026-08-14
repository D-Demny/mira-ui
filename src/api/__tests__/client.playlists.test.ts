import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { fetchUserPlaylists, fetchRecentlyPlayed } from '../client'
import { server } from '../../__tests__/msw-server'

describe('fetchUserPlaylists', () => {
  it('returns playlist items and total count', async () => {
    server.use(
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({
          items: [
            {
              id: 'pl1',
              name: 'My Playlist',
              uri: 'spotify:playlist:pl1',
              owner: { display_name: 'User' },
              images: [{ url: 'https://i.scdn.co/img/1' }],
              tracks: { total: 10 },
              collaborative: false,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      ),
    )

    const result = await fetchUserPlaylists()
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('My Playlist')
    expect(result.total).toBe(1)
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    )

    await expect(fetchUserPlaylists()).rejects.toThrow('401')
  })

  it('sends pagination params', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/web-api/me/playlists', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
      }),
    )

    await fetchUserPlaylists(2, 25)
    expect(capturedUrl).toContain('limit=25')
    expect(capturedUrl).toContain('offset=50')
  })
})

describe('fetchRecentlyPlayed', () => {
  it('returns recently played items', async () => {
    server.use(
      http.get('*/web-api/me/player/recently-played', () =>
        HttpResponse.json({
          items: [
            {
              track: {
                id: 't1',
                name: 'Song 1',
                artists: [{ name: 'Artist' }],
                album: { name: 'Album', images: [] },
                uri: 'spotify:track:t1',
              },
              played_at: '2026-08-14T10:00:00Z',
            },
          ],
          next: null,
          cursors: { after: '', before: '' },
          limit: 20,
          href: '',
        }),
      ),
    )

    const result = await fetchRecentlyPlayed()
    expect(result).toHaveLength(1)
    expect(result[0].track.name).toBe('Song 1')
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/web-api/me/player/recently-played', () =>
        HttpResponse.error(),
      ),
    )

    await expect(fetchRecentlyPlayed()).rejects.toThrow()
  })
})
