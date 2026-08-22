import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  fetchPlaylistTracks,
  fetchUserPlaylists,
  fetchRecentlyPlayed,
  pickSpotifyImage,
} from '../client'
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

describe('fetchPlaylistTracks (bug4)', () => {
  it('returns one page of tracks with total count', async () => {
    server.use(
      http.get('*/web-api/playlists/pl1/tracks', () =>
        HttpResponse.json({
          items: [
            {
              is_local: false,
              track: {
                id: 't1',
                name: 'Song 1',
                uri: 'spotify:track:t1',
                artists: [{ name: 'Artist' }],
                album: {
                  name: 'Album',
                  images: [{ url: 'https://i.scdn.co/img/300', width: 300, height: 300 }],
                },
              },
            },
          ],
          total: 12,
          limit: 50,
          offset: 0,
          next: null,
        }),
      ),
    )

    const result = await fetchPlaylistTracks('pl1')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].track.name).toBe('Song 1')
    expect(result.items[0].track.album?.images?.[0]?.url).toBe('https://i.scdn.co/img/300')
    expect(result.total).toBe(12)
  })

  it('sends pagination params with the page size limit (bug4: no hardcoded small limit)', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/web-api/playlists/pl1/tracks', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ items: [], total: 0, limit: 50, offset: 50, next: null })
      }),
    )

    await fetchPlaylistTracks('pl1', 50)
    expect(capturedUrl).toContain('limit=50')
    expect(capturedUrl).toContain('offset=50')
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/web-api/playlists/pl1/tracks', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    )

    await expect(fetchPlaylistTracks('pl1')).rejects.toThrow('404')
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

describe('pickSpotifyImage (bug8.2)', () => {
  const images = [
    { url: 'https://i.scdn.co/img/640' },
    { url: 'https://i.scdn.co/img/300' },
    { url: 'https://i.scdn.co/img/64' },
  ]

  it('prefers the medium 300px variant over the full-res 640px image', () => {
    expect(pickSpotifyImage(images)).toBe('https://i.scdn.co/img/300')
  })

  it('falls back to the largest image when no smaller variant exists', () => {
    expect(pickSpotifyImage([{ url: 'a' }])).toBe('a')
    expect(pickSpotifyImage(images.slice(0, 2))).toBe('https://i.scdn.co/img/300')
  })

  it('can request the smallest 64px variant', () => {
    expect(pickSpotifyImage(images, 2)).toBe('https://i.scdn.co/img/64')
  })

  it('returns undefined for missing or empty image arrays', () => {
    expect(pickSpotifyImage(undefined)).toBeUndefined()
    expect(pickSpotifyImage(null)).toBeUndefined()
    expect(pickSpotifyImage([])).toBeUndefined()
  })
})
