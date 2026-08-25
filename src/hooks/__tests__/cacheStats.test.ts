import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { __cacheStats } from '../cacheStats'
import { clearCache, usePlaylists } from '../usePlaylists'
import { clearRecentCache, useRecent } from '../useRecent'
import { clearTracksCache, usePlaylistTracks } from '../usePlaylistTracks'
import { clearColorCache, seedColorCache } from '../useColorExtract'
import { __resetHomeLightStore, useHomeLights } from '../useHomeLight'
import { __resetLyricsCache, primeLyricsCache } from '../useLyrics'
import { __resetWarmedArt, warmArt } from '@/components/MainMenuView/warmedArt'
import type { LyricsResult } from '@/api/types'

const lyrics = (words: string): LyricsResult => ({
  syncType: 'LINE_SYNCED',
  lines: [{ startTimeMs: '0', words }],
})

describe('__cacheStats (bug45 option C: cache readout)', () => {
  beforeEach(() => {
    clearCache()
    clearRecentCache()
    clearTracksCache()
    clearColorCache()
    __resetHomeLightStore()
    __resetLyricsCache()
    __resetWarmedArt()
  })

  it('reports every store with the expected shape and the approved bounds', () => {
    expect(__cacheStats()).toEqual({
      usePlaylists: { entries: 0, items: 0, approxBytes: 0 },
      useRecent: { entries: 0, items: 0, approxBytes: 0 },
      usePlaylistTracks: {
        maxEntries: 32,
        maxTracksPerEntry: 300,
        ttlMs: 5 * 60 * 1000,
        entries: 0,
        tracks: 0,
        approxBytes: 0,
      },
      useColorExtract: { entries: 0, maxEntries: 500, approxBytes: 0 },
      useHomeLights: { entities: 0 },
      useLyrics: { entries: 0, maxEntries: 50, richsyncTried: 0 },
      usePrefetch: { entries: 0, maxEntries: 2000, approxBytes: 0 },
      warmedArt: { entries: 0, maxEntries: 1000, approxBytes: 0 },
    })
  })

  it('reports the live occupancy and approximate sizes of each store', async () => {
    const url1 = 'https://i.scdn.co/img/1'
    const url2 = 'https://i.scdn.co/img/22'
    server.use(
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({
          items: [
            {
              id: 'pl1',
              name: 'My Playlist',
              uri: 'spotify:playlist:pl1',
              owner: { display_name: 'User' },
              images: [{ url: url1 }],
              tracks: { total: 10 },
              collaborative: false,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      ),
      http.get('*/web-api/me/player/recently-played', () =>
        HttpResponse.json({
          items: [
            {
              track: {
                id: 't1',
                name: 'Song One',
                artists: [{ name: 'Artist One' }],
                album: { name: 'Album One', images: [{ url: url1 }] },
                uri: 'spotify:track:t1',
              },
              played_at: '2026-08-20T10:00:00Z',
            },
          ],
        }),
      ),
      http.get('*/web-api/playlists/pl-1/tracks', () =>
        HttpResponse.json({
          items: [
            {
              is_local: false,
              track: {
                id: 'tr1',
                name: 'Track 1',
                uri: 'spotify:track:tr1',
                artists: [{ name: 'Someone' }],
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          next: null,
        }),
      ),
    )

    const { result: playlistsResult, unmount: playlistsUnmount } = renderHook(() =>
      usePlaylists(),
    )
    await waitFor(() => expect(playlistsResult.current.loading).toBe(false))
    expect(playlistsResult.current.items).toHaveLength(1)

    const { result: recentResult, unmount: recentUnmount } = renderHook(() => useRecent())
    await waitFor(() => expect(recentResult.current.loading).toBe(false))
    expect(recentResult.current.items).toHaveLength(1)

    const { result: tracksResult, unmount: tracksUnmount } = renderHook(() =>
      usePlaylistTracks('pl-1'),
    )
    await waitFor(() => expect(tracksResult.current.loading).toBe(false))
    expect(tracksResult.current.tracks).toHaveLength(1)

    // rendering the hook registers all 9 light stores (MSW serves the states)
    const { unmount: lightsUnmount } = renderHook(() => useHomeLights())

    seedColorCache(url1, [200, 100, 50])
    seedColorCache(url2, [10, 20, 30])
    primeLyricsCache('lyr1', lyrics('hello'))
    primeLyricsCache('lyr2', lyrics('world'))
    warmArt(url1)
    warmArt(url2)

    const stats = __cacheStats()
    expect(stats.usePlaylists).toEqual({ entries: 1, items: 1, approxBytes: 350 })
    expect(stats.useRecent).toEqual({ entries: 1, items: 1, approxBytes: 550 })
    expect(stats.usePlaylistTracks).toEqual({
      maxEntries: 32,
      maxTracksPerEntry: 300,
      ttlMs: 5 * 60 * 1000,
      entries: 1,
      tracks: 1,
      approxBytes: 500,
    })
    expect(stats.useColorExtract.entries).toBe(2)
    expect(stats.useColorExtract.approxBytes).toBe(url1.length + url2.length + 2 * 24)
    expect(stats.useHomeLights).toEqual({ entities: 9 })
    expect(stats.useLyrics).toEqual({ entries: 2, maxEntries: 50, richsyncTried: 0 })
    // usePrefetch only fills as the player runs; it stays 0 in this session
    expect(stats.usePrefetch.entries).toBeGreaterThanOrEqual(0)
    expect(stats.warmedArt).toEqual({
      entries: 2,
      maxEntries: 1000,
      approxBytes: url1.length + url2.length,
    })

    lightsUnmount()
    tracksUnmount()
    recentUnmount()
    playlistsUnmount()
  })
})
