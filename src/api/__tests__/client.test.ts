import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  fetchLyrics,
  fetchObserverStatus,
  isInstrumentalPlaceholder,
  normalizeLyrics,
  remoteStateToStatus,
} from '../client'
import type {
  LyricsResult,
  ObserverStatusActive,
  ObserverStatusInactive,
  RemoteStateWire,
} from '../types'
import { server } from '../../__tests__/msw-server'

const baseWire: RemoteStateWire = {
  DeviceId: 'phone-1',
  DeviceName: 'Pixel 7',
  DeviceType: 'Smartphone',
  TrackUri: 'spotify:track:abc123',
  TrackName: 'Test Song',
  TrackArtist: 'Test Artist',
  TrackAlbum: 'Test Album',
  TrackImageUrl: 'https://i.scdn.co/image/abc',
  ContextUri: 'spotify:playlist:xyz',
  ContextName: 'My Playlist',
  Duration: 180_000,
  PositionAsOfTimestamp: 30_000,
  Timestamp: 0,
  IsPlaying: false,
  IsPaused: false,
  PlaybackSpeed: 1,
  ShuffleContext: false,
  RepeatContext: false,
  RepeatTrack: false,
}

describe('remoteStateToStatus', () => {
  const FROZEN_NOW = 1_716_390_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('projects position forward in time while playing', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: true,
      IsPaused: false,
      PositionAsOfTimestamp: 30_000,
      Timestamp: FROZEN_NOW - 2_000,
    }

    const status = remoteStateToStatus(wire)

    expect(status.position).toBe(32_000)
    expect(status.received_at).toBe(FROZEN_NOW)
  })

  it('does not project position while paused', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: false,
      IsPaused: true,
      PositionAsOfTimestamp: 30_000,
      Timestamp: FROZEN_NOW - 2_000,
    }

    expect(remoteStateToStatus(wire).position).toBe(30_000)
  })

  it('clamps projected position to track duration', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: true,
      IsPaused: false,
      Duration: 60_000,
      PositionAsOfTimestamp: 59_000,
      Timestamp: FROZEN_NOW - 10_000,
    }

    expect(remoteStateToStatus(wire).position).toBe(60_000)
  })

  it('does not project when timestamp is zero (daemon hasnt stamped yet)', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: true,
      IsPaused: false,
      PositionAsOfTimestamp: 5_000,
      Timestamp: 0,
    }

    expect(remoteStateToStatus(wire).position).toBe(5_000)
  })

  it('clamps negative elapsed to zero (defensive against future Timestamp)', () => {
    // server clock can briefly lead client during NTP step
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: true,
      IsPaused: false,
      PositionAsOfTimestamp: 30_000,
      Timestamp: FROZEN_NOW + 5_000,
    }

    expect(remoteStateToStatus(wire).position).toBe(30_000)
  })

  it('does not project when the remote timestamp is implausibly stale', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      IsPlaying: true,
      IsPaused: false,
      PositionAsOfTimestamp: 30_000,
      Timestamp: FROZEN_NOW - 10 * 60 * 1000 - 1,
    }

    expect(remoteStateToStatus(wire).position).toBe(30_000)
  })

  it('extracts trackId from a 3-part Spotify URI and builds lyrics_url', () => {
    const status = remoteStateToStatus({
      ...baseWire,
      TrackUri: 'spotify:track:abc123',
    })

    expect(status.track_id).toBe('abc123')
    expect(status.lyrics_url).toBe('/lyrics/abc123')
  })

  it('returns empty trackId and blank lyrics_url for non-3-part URIs', () => {
    // local files, episodes, malformed strings useLyrics treats '' as skip
    const status = remoteStateToStatus({
      ...baseWire,
      TrackUri: 'local-file',
    })

    expect(status.track_id).toBe('')
    expect(status.lyrics_url).toBe('')
  })

  it('maps pascalcase wire fields onto snake_case output verbatim', () => {
    const wire: RemoteStateWire = {
      ...baseWire,
      ShuffleContext: true,
      RepeatContext: false,
      RepeatTrack: true,
      DisallowSkipPrev: true,
      DisallowSkipNext: false,
      DisallowSeek: true,
      PrevTracks: [
        {
          uri: 'spotify:track:prev1',
          track_id: 'prev1',
          name: 'Prev Song',
          artist: 'A',
          album: 'B',
          image_url: '',
        },
      ],
      NextTracks: [
        {
          uri: 'spotify:track:next1',
          track_id: 'next1',
          name: 'Next Song',
          artist: 'C',
          album: 'D',
          image_url: '',
        },
      ],
      RawMetadata: { context_description: 'My Playlist' },
    }

    const status = remoteStateToStatus(wire)

    expect(status.active).toBe(true)
    expect(status.device_id).toBe(wire.DeviceId)
    expect(status.device_name).toBe(wire.DeviceName)
    expect(status.device_type).toBe(wire.DeviceType)
    expect(status.track_uri).toBe(wire.TrackUri)
    expect(status.track_name).toBe(wire.TrackName)
    expect(status.track_artist).toBe(wire.TrackArtist)
    expect(status.track_album).toBe(wire.TrackAlbum)
    expect(status.track_image).toBe(wire.TrackImageUrl)
    expect(status.context_uri).toBe(wire.ContextUri)
    expect(status.duration).toBe(wire.Duration)
    expect(status.is_playing).toBe(wire.IsPlaying)
    expect(status.is_paused).toBe(wire.IsPaused)
    expect(status.shuffle).toBe(true)
    expect(status.repeat_context).toBe(false)
    expect(status.repeat_track).toBe(true)
    expect(status.disallow_prev).toBe(true)
    expect(status.disallow_next).toBe(false)
    expect(status.disallow_seek).toBe(true)
    expect(status.prev_tracks).toEqual(wire.PrevTracks)
    expect(status.next_tracks).toEqual(wire.NextTracks)
    expect(status.raw_metadata).toEqual({ context_description: 'My Playlist' })
  })

  it('coalesces missing RawMetadata to null', () => {
    const status = remoteStateToStatus({ ...baseWire, RawMetadata: undefined })
    expect(status.raw_metadata).toBeNull()
  })
})

describe('fetchObserverStatus', () => {
  it('translates 204 No Content into the inactive sentinel', () => {
    server.use(http.get('*/observer/status', () => new HttpResponse(null, { status: 204 })))

    return fetchObserverStatus().then((s) => {
      expect(s.active).toBe(false)
      expect((s as ObserverStatusInactive).message).toBe('no session')
    })
  })

  it('passes a 200 inactive body (starting-up fast-path) through unchanged', () => {
    server.use(
      http.get('*/observer/status', () =>
        HttpResponse.json({ active: false, message: 'starting up' }),
      ),
    )

    return fetchObserverStatus().then((s) => {
      expect(s.active).toBe(false)
      expect((s as ObserverStatusInactive).message).toBe('starting up')
    })
  })

  it('annotates an active 200 body with received_at', () => {
    const activeBody = {
      active: true,
      device_id: 'pixel',
      device_name: 'Pixel',
      device_type: 'Smartphone',
      track_id: 'abc',
      track_uri: 'spotify:track:abc',
      track_name: 'Song',
      track_artist: 'Artist',
      track_album: 'Album',
      track_image: 'https://x',
      context_uri: '',
      duration: 180_000,
      position: 42_000,
      is_playing: true,
      is_paused: false,
      shuffle: false,
      repeat_context: false,
      repeat_track: false,
      lyrics_url: '/lyrics/abc',
    }
    server.use(http.get('*/observer/status', () => HttpResponse.json(activeBody)))

    const before = Date.now()
    return fetchObserverStatus().then((s) => {
      const after = Date.now()
      expect(s.active).toBe(true)
      const ra = (s as ObserverStatusActive).received_at
      expect(ra).toBeGreaterThanOrEqual(before)
      expect(ra).toBeLessThanOrEqual(after)
      expect((s as ObserverStatusActive).position).toBe(42_000)
    })
  })

  it('throws on non-OK non-204 status codes with the status code in the message', () => {
    server.use(http.get('*/observer/status', () => new HttpResponse(null, { status: 500 })))
    return expect(fetchObserverStatus()).rejects.toThrow(/500/)
  })

  it('propagates abort via the passed AbortSignal', () => {
    server.use(
      http.get('*/observer/status', async () => {
        await new Promise(() => undefined)
        return HttpResponse.json({})
      }),
    )

    const ac = new AbortController()
    const promise = fetchObserverStatus(ac.signal)
    ac.abort()
    return expect(promise).rejects.toThrow()
  })
})

// issue #25: a bare "Instrumental" placeholder (what some lyrics sources return
// for instrumental tracks) must be classified as no-lyrics, exactly like a 404.
describe('instrumental placeholder normalization', () => {
  const realLyrics: LyricsResult = {
    syncType: 'LINE_SYNCED',
    lines: [{ startTimeMs: '0', words: 'La la la' }],
  }

  describe('isInstrumentalPlaceholder', () => {
    it('matches the bare placeholder regardless of case and surrounding whitespace', () => {
      expect(isInstrumentalPlaceholder([{ words: 'Instrumental' }])).toBe(true)
      expect(isInstrumentalPlaceholder([{ words: '  instrumental  ' }])).toBe(true)
      expect(isInstrumentalPlaceholder([{ words: 'INSTRUMENTAL' }])).toBe(true)
    })

    it('collapses internal whitespace (tabs/newlines between the word letters is not a match)', () => {
      // surrounding / repeated whitespace around the single word collapses to a match
      expect(isInstrumentalPlaceholder([{ words: '\n\tInstrumental\n' }])).toBe(true)
      // real lyric content, even one containing the word, is never a match
      expect(isInstrumentalPlaceholder([{ words: 'instrumental piece of art' }])).toBe(false)
    })

    it('does not match multiple lines or empty line text', () => {
      expect(isInstrumentalPlaceholder([{ words: 'Instrumental' }, { words: 'more' }])).toBe(false)
      expect(isInstrumentalPlaceholder([])).toBe(false)
      expect(isInstrumentalPlaceholder([{ words: '' }])).toBe(false)
    })

    it('matches decorated placeholder lines (issue #31: lrclib answers with a decorated line)', () => {
      // the exact line the daemon's lrclib source returns for some instrumentals
      expect(isInstrumentalPlaceholder([{ words: '♪ Instrumental ♪' }])).toBe(true)
      // decoration plus repetition across lines collapses to the bare word
      expect(
        isInstrumentalPlaceholder([{ words: '(Instrumental)' }, { words: 'Instrumental' }]),
      ).toBe(true)
      // real lyric content that merely contains the word stays a non-match
      expect(isInstrumentalPlaceholder([{ words: 'this is an instrumental piece' }])).toBe(false)
    })
  })

  describe('normalizeLyrics', () => {
    it('returns null for an instrumental-only result', () => {
      const instrumental: LyricsResult = {
        syncType: 'UNSYNCED',
        lines: [{ startTimeMs: '0', words: 'Instrumental' }],
      }
      expect(normalizeLyrics(instrumental)).toBeNull()
    })

    it('returns null for case/whitespace variants of the placeholder', () => {
      const padded: LyricsResult = {
        syncType: 'UNSYNCED',
        lines: [{ startTimeMs: '0', words: '  instrumental  ' }],
      }
      expect(normalizeLyrics(padded)).toBeNull()
    })

    it('returns null for the decorated lrclib placeholder line (issue #31)', () => {
      const decorated: LyricsResult = {
        syncType: 'UNSYNCED',
        lines: [{ startTimeMs: '0', words: '♪ Instrumental ♪' }],
      }
      expect(normalizeLyrics(decorated)).toBeNull()
    })

    it('passes real lyrics through unchanged (same reference)', () => {
      expect(normalizeLyrics(realLyrics)).toBe(realLyrics)
    })

    it('passes null and zero-line results through unchanged', () => {
      expect(normalizeLyrics(null)).toBeNull()
      const empty: LyricsResult = { syncType: 'UNSYNCED', lines: [] }
      expect(normalizeLyrics(empty)).toBe(empty)
    })
  })

  describe('fetchLyrics', () => {
    const meta = { track: 'T', artist: 'A' }

    it('maps an instrumental placeholder response to null like a 404', async () => {
      server.use(
        http.get('*/lyrics/t1', () =>
          HttpResponse.json({
            syncType: 'UNSYNCED',
            lines: [{ startTimeMs: '0', words: 'Instrumental' }],
          }),
        ),
      )
      await expect(fetchLyrics('t1', meta)).resolves.toBeNull()
    })

    it('maps a padded lowercase placeholder variant to null', async () => {
      server.use(
        http.get('*/lyrics/t2', () =>
          HttpResponse.json({
            syncType: 'UNSYNCED',
            lines: [{ startTimeMs: '0', words: '  instrumental  ' }],
          }),
        ),
      )
      await expect(fetchLyrics('t2', meta)).resolves.toBeNull()
    })

    it('still returns real lyrics untouched', async () => {
      server.use(http.get('*/lyrics/t3', () => HttpResponse.json(realLyrics)))
      await expect(fetchLyrics('t3', meta)).resolves.toEqual(realLyrics)
    })

    it('still returns null on a 404 and keeps the zero-line passthrough', async () => {
      server.use(http.get('*/lyrics/t4', () => new HttpResponse(null, { status: 404 })))
      await expect(fetchLyrics('t4', meta)).resolves.toBeNull()

      server.use(
        http.get('*/lyrics/t5', () => HttpResponse.json({ syncType: 'UNSYNCED', lines: [] })),
      )
      await expect(fetchLyrics('t5', meta)).resolves.toEqual({
        syncType: 'UNSYNCED',
        lines: [],
      })
    })
  })
})
