import { API_BASE, WS_URL } from '@/config'
import type { LyricsResult, ObserverStatus, ObserverStatusActive, RemoteStateWire } from './types'

function trackIdFromUri(uri: string): string {
  const parts = uri.split(':')
  return parts.length === 3 ? parts[2] : ''
}

export function remoteStateToStatus(rs: RemoteStateWire): ObserverStatusActive {
  const trackId = trackIdFromUri(rs.TrackUri)
  // project PositionAsOfTimestamp forward to now if playing, so first paint is correct
  const now = Date.now()
  const elapsed =
    rs.IsPlaying && !rs.IsPaused && rs.Timestamp > 0 ? Math.max(0, now - rs.Timestamp) : 0
  const position = Math.min(rs.Duration, rs.PositionAsOfTimestamp + elapsed)

  return {
    active: true,
    device_id: rs.DeviceId,
    device_name: rs.DeviceName,
    device_type: rs.DeviceType,
    track_id: trackId,
    track_uri: rs.TrackUri,
    track_name: rs.TrackName,
    track_artist: rs.TrackArtist,
    track_album: rs.TrackAlbum,
    track_image: rs.TrackImageUrl,
    context_uri: rs.ContextUri,
    context_name: rs.ContextName ?? '',
    duration: rs.Duration,
    position,
    is_playing: rs.IsPlaying,
    is_paused: rs.IsPaused,
    volume: rs.Volume,
    volume_max: 65535,
    volume_disabled: rs.VolumeDisabled,
    volume_steps: rs.VolumeSteps,
    shuffle: rs.ShuffleContext,
    repeat_context: rs.RepeatContext,
    repeat_track: rs.RepeatTrack,
    disallow_prev: rs.DisallowSkipPrev,
    disallow_next: rs.DisallowSkipNext,
    disallow_seek: rs.DisallowSeek,
    prev_tracks: rs.PrevTracks,
    next_tracks: rs.NextTracks,
    lyrics_url: trackId ? `/lyrics/${trackId}` : '',
    raw_metadata: rs.RawMetadata ?? null,
    received_at: now,
  }
}

export async function fetchObserverStatus(signal?: AbortSignal): Promise<ObserverStatus> {
  const res = await fetch(`${API_BASE}/observer/status`, { signal, cache: 'no-store' })
  if (res.status === 204) return { active: false, message: 'no session' }
  if (!res.ok) throw new Error(`observer/status ${res.status}`)
  const body = await res.json()
  if (body && body.active === true) {
    return { ...(body as Omit<ObserverStatusActive, 'received_at'>), received_at: Date.now() }
  }
  return body as ObserverStatus
}

export async function fetchLyrics(
  trackId: string,
  meta: { track: string; artist: string; album?: string; durationMs?: number },
  signal?: AbortSignal,
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({
    track: meta.track,
    artist: meta.artist,
  })
  if (meta.album) params.set('album', meta.album)
  if (meta.durationMs && meta.durationMs > 0) params.set('duration', String(meta.durationMs))

  const res = await fetch(`${API_BASE}/lyrics/${encodeURIComponent(trackId)}?${params}`, { signal })
  // 404 means nothing was found (instrumental or too niche)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`lyrics ${res.status}`)
  return (await res.json()) as LyricsResult
}

export function eventsUrl(): string {
  return WS_URL
}
