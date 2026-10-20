import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  fetchMaPlaylists,
  fetchMaPlaylistTracks,
  fetchMaRecentlyPlayed,
  pickArtUrl,
} from '../client'
import { server } from '../../__tests__/msw-server'

afterEach(() => {
  server.resetHandlers()
})

// issue #138: the MA content menus - pinning the wire -> Spotify-shape
// adaptation so the panes keep a single render path.
describe('fetchMaPlaylists', () => {
  it('maps the flattened library playlists to the Spotify playlist shape', async () => {
    server.use(
      http.get('*/ma/playlists', () =>
        HttpResponse.json({
          playlists: [
            {
              item_id: '61',
              name: 'Rock',
              uri: 'library://playlist/61',
              image_url: 'http://10.0.0.4:8095/static/image/abc.jpg',
            },
            { item_id: '62', name: 'No Art', uri: 'library://playlist/62' },
          ],
        }),
      ),
    )

    const result = await fetchMaPlaylists()
    expect(result.total).toBe(2)
    expect(result.items[0]).toMatchObject({
      id: '61',
      name: 'Rock',
      uri: 'library://playlist/61',
      images: [{ url: 'http://10.0.0.4:8095/static/image/abc.jpg' }],
    })
    expect(pickArtUrl(result.items[0])).toBe('http://10.0.0.4:8095/static/image/abc.jpg')
    // absent image_url degrades to no artwork (placeholder on the card)
    expect(result.items[1].images).toEqual([])
    expect(pickArtUrl(result.items[1])).toBeUndefined()
  })

  it('answers empty for the unconfigured-daemon default body', async () => {
    server.use(http.get('*/ma/playlists', () => HttpResponse.json({ playlists: [] })))

    const result = await fetchMaPlaylists()
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
  })

  it('tolerates a body without the playlists key', async () => {
    server.use(http.get('*/ma/playlists', () => HttpResponse.json({})))
    const result = await fetchMaPlaylists()
    expect(result.items).toEqual([])
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/ma/playlists', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )
    await expect(fetchMaPlaylists()).rejects.toThrow('ma/playlists')
  })
})

describe('fetchMaPlaylistTracks', () => {
  it('maps the full track list to Spotify track items (no paging)', async () => {
    server.use(
      http.get('*/ma/playlist-items', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('id') !== '61') return HttpResponse.json({ tracks: [] }, { status: 500 })
        return HttpResponse.json({
          tracks: [
            {
              id: 't1',
              name: 'Song One',
              uri: 'spotify:track:abcdef',
              album: 'The Album',
              artists: ['Artist A', 'Artist B'],
              duration_ms: 213000,
              position: 0,
              image_url: 'http://10.0.0.4:8095/static/image/def.jpg',
            },
            { id: 't2', name: 'Song Two', uri: 'spotify:track:ghijkl', artists: [], position: 1 },
          ],
        })
      }),
    )

    const result = await fetchMaPlaylistTracks('61')
    // the MA endpoint serves the FULL list - total equals the item count, so
    // usePlaylistTracks' loadMore stops after one page
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
    const first = result.items[0]
    expect(first.is_local).toBe(false)
    expect(first.track.id).toBe('t1')
    expect(first.track.artists).toEqual([{ name: 'Artist A' }, { name: 'Artist B' }])
    expect(first.track.album?.name).toBe('The Album')
    expect(pickArtUrl(first.track)).toBe('http://10.0.0.4:8095/static/image/def.jpg')
    // no album + no image -> no artwork entry (placeholder)
    expect(result.items[1].track.album).toBeUndefined()
    expect(pickArtUrl(result.items[1].track)).toBeUndefined()
  })

  it('sends the library playlist id as a query parameter', async () => {
    let capturedId = ''
    server.use(
      http.get('*/ma/playlist-items', ({ request }) => {
        capturedId = new URL(request.url).searchParams.get('id') ?? ''
        return HttpResponse.json({ tracks: [] })
      }),
    )

    await fetchMaPlaylistTracks('42')
    expect(capturedId).toBe('42')
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/ma/playlist-items', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )
    await expect(fetchMaPlaylistTracks('61')).rejects.toThrow('ma/playlist-items')
  })
})

describe('fetchMaRecentlyPlayed', () => {
  it('maps the play-log rows to recently-played items (title + art only)', async () => {
    server.use(
      http.get('*/ma/recent', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('limit') !== '20') return HttpResponse.json({ tracks: [] }, { status: 500 })
        return HttpResponse.json({
          tracks: [
            {
              id: 't9',
              name: 'Recently Played',
              uri: 'spotify:track:zzz',
              album: 'Some Album',
              image_url: 'http://10.0.0.4:8095/static/image/9.jpg',
              position: 0,
            },
          ],
        })
      }),
    )

    const items = await fetchMaRecentlyPlayed()
    expect(items).toHaveLength(1)
    expect(items[0].track.name).toBe('Recently Played')
    expect(items[0].track.artists).toEqual([])
    expect(pickArtUrl(items[0].track)).toBe('http://10.0.0.4:8095/static/image/9.jpg')
    // MA has no played_at - the field degrades to an empty string
    expect(items[0].played_at).toBe('')
  })

  it('answers empty for the unconfigured-daemon default body', async () => {
    server.use(http.get('*/ma/recent', () => HttpResponse.json({ tracks: [] })))
    const items = await fetchMaRecentlyPlayed()
    expect(items).toEqual([])
  })

  it('throws on non-OK response', async () => {
    server.use(
      http.get('*/ma/recent', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )
    await expect(fetchMaRecentlyPlayed()).rejects.toThrow('ma/recent')
  })
})
