import { API_BASE, WS_URL } from '@/config'
import type {
  ConnectDevice,
  DebugStatus,
  LyricsResult,
  MaDevice,
  MaPlaylistItem,
  MaTrackCard,
  ObserverStatus,
  ObserverStatusActive,
  RemoteStateWire,
  SpotifyPlaylist,
  SpotifyPlaylistResponse,
  SpotifyPlaylistTrack,
  SpotifyPlaylistTrackItem,
  SpotifyPlaylistTracksResponse,
  SpotifyRecentlyPlayedItem,
  SpotifyRecentlyPlayedResponse,
} from './types'

// issue #47: the daemon reports Music Assistant tracks as
// '<source>://<domain>/<id>' (e.g. 'spotify--yofvZfhZ://track/4ml1Eq4wmcdfN0Q6pNEly7').
// The lyrics API wants the spotify track id, which is the remainder after the
// first '/' when the domain segment is exactly 'track' (non-track MA domains —
// episodes, local files, streams — have no lyrics id and stay ''). Legacy
// Spotify Connect URIs are 3-part 'scheme:type:id' and take the legacy path.
function trackIdFromUri(uri: string): string {
  const parts = uri.split(':')
  if (parts.length === 3) return parts[2]
  const sep = uri.indexOf('://')
  if (sep !== -1) {
    const rest = uri.slice(sep + '://'.length)
    const slash = rest.indexOf('/')
    if (slash > 0 && rest.slice(0, slash) === 'track') return rest.slice(slash + 1)
  }
  return ''
}

const MAX_POSITION_PROJECTION_MS = 10 * 60 * 1000

export function remoteStateToStatus(rs: RemoteStateWire): ObserverStatusActive {
  const trackId = trackIdFromUri(rs.TrackUri)
  const now = Date.now()
  // Prefer the daemons position
  let position: number
  if (typeof rs.Position === 'number') {
    position = Math.min(rs.Duration, rs.Position)
  } else {
    const rawElapsed = rs.Timestamp > 0 ? now - rs.Timestamp : 0
    const elapsed =
      rs.IsPlaying && !rs.IsPaused && rawElapsed >= 0 && rawElapsed <= MAX_POSITION_PROJECTION_MS
        ? rawElapsed
        : 0
    position = Math.min(rs.Duration, rs.PositionAsOfTimestamp + elapsed)
  }

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
    // tolerant map: absent field (old daemons) degrades to false, never crashes
    smart_shuffle: rs.SmartShuffle === true,
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

export async function fetchDebugStatus(signal?: AbortSignal): Promise<DebugStatus> {
  const res = await fetch(`${API_BASE}/debug/status`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`debug/status ${res.status}`)
  return (await res.json()) as DebugStatus
}

// uploads the support bundle via the daemon
export async function sendDebugReport(signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE}/debug/report`, { method: 'POST', signal })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `debug/report ${res.status}`)
  if (!body?.id) throw new Error('no report id')
  return body.id as string
}

export async function fetchConnectDevices(signal?: AbortSignal): Promise<ConnectDevice[]> {
  const res = await fetch(`${API_BASE}/connect/devices`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`connect/devices ${res.status}`)
  const body = await res.json()
  return Array.isArray(body?.devices) ? (body.devices as ConnectDevice[]) : []
}

// issue #127: on-demand re-fetch of the account-wide Connect device list
// (daemon calls GET /me/player/devices and merges it into the picker list).
// Fired when a screen showing devices mounts so idle speakers that aged out
// of the live cluster view show up; failures keep the previous list and the
// daemon's periodic poll still refreshes it.
export async function refreshConnectDevices(signal?: AbortSignal): Promise<ConnectDevice[]> {
  const res = await fetch(`${API_BASE}/connect/refresh`, {
    method: 'POST',
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`connect/refresh ${res.status}`)
  const body = await res.json()
  return Array.isArray(body?.devices) ? (body.devices as ConnectDevice[]) : []
}

// resume playback on the last active device (used from the idle screen). Throws
// on non-OK (404 = no remembered/available device) so the caller can banner it.
export async function resumeLastDevice(): Promise<void> {
  const res = await fetch(`${API_BASE}/player/resume_last`, { method: 'POST' })
  if (!res.ok) throw new Error(`player/resume_last ${res.status}`)
}

// transfer the current playback session to another device
export async function transferToDevice(deviceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/connect/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  })
  if (!res.ok) throw new Error(`connect/transfer ${res.status}`)
}

// issue #134: the Music Assistant backend (playbackSource 'ma'). The daemon
// serves its MA player list here — 200 with an EMPTY array when MA is
// unconfigured or unreachable, so a failed fetch (network/daemon) throws like
// its siblings and the caller keeps the previous list.
// SECURITY: the UI never sends the MA token itself — the daemon reads it from
// the settings blob (settings.ts MaSettingsValue) — so these calls carry no
// credential, and neither may an error message derived from them.
export async function fetchMaDevices(signal?: AbortSignal): Promise<MaDevice[]> {
  const res = await fetch(`${API_BASE}/ma/devices`, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`ma/devices ${res.status}`)
  const body = await res.json()
  return Array.isArray(body?.devices) ? (body.devices as MaDevice[]) : []
}

// issue #134: start playback on the given MA player (the daemon routes this
// to Music Assistant). Throws on non-OK (400 = unknown player or MA
// unconfigured) so the caller can surface it in the same error style as a
// failed Connect transfer (see useDeviceSwitch).
export async function selectMaPlayer(playerId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/ma/player/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: playerId }),
  })
  if (!res.ok) throw new Error(`ma/player/select ${res.status}`)
}

// issue #138: the Music Assistant content menus (playbackSource 'ma'). The
// daemon serves the flattened library playlists, one playlist's tracks and
// the play-log here - each answers 200 with an EMPTY list when MA is
// unconfigured or unreachable (never an error), so a network/daemon failure
// throws like its siblings and the hook keeps the previous list. SECURITY:
// same convention as fetchMaDevices - no MA token ever crosses this boundary.
export async function fetchMaPlaylists(
  signal?: AbortSignal,
): Promise<{ items: SpotifyPlaylist[]; total: number }> {
  try {
    const res = await fetch(`${API_BASE}/ma/playlists`, { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`ma/playlists ${res.status}`)
    const body = (await safeJson(res)) as { playlists?: MaPlaylistItem[] }
    const items: SpotifyPlaylist[] = (body.playlists ?? []).map((p) => ({
      id: p.item_id,
      name: p.name,
      owner: { display_name: '' },
      images: p.image_url ? [{ url: p.image_url }] : [],
      // the daemon does not serve per-playlist track counts
      tracks: { total: 0 },
      collaborative: false,
      uri: p.uri,
    }))
    return { items, total: items.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`ma/playlists: ${message}`, { cause: err })
  }
}

// issue #138: one playlist's track cards in playlist order (the daemon serves
// the FULL list - no paging, so offset/limit are ignored and total equals the
// item count). The MaTrackCard wire shape is adapted to the Spotify track
// item so usePlaylistTracks pages it through the same code path.
export async function fetchMaPlaylistTracks(
  playlistId: string,
  signal?: AbortSignal,
): Promise<SpotifyPlaylistTracksResponse> {
  try {
    const res = await fetch(`${API_BASE}/ma/playlist-items?id=${encodeURIComponent(playlistId)}`, {
      signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`ma/playlist-items ${res.status}`)
    const body = (await safeJson(res)) as { tracks?: MaTrackCard[] }
    const items: SpotifyPlaylistTrackItem[] = (body.tracks ?? []).map((t) => ({
      is_local: false,
      track: maTrackToSpotifyTrack(t),
    }))
    return { items, total: items.length, limit: items.length, offset: 0, next: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`ma/playlist-items: ${message}`, { cause: err })
  }
}

// issue #138: the play-log track cards (MA limitation: title and artwork only,
// no artists/context - the daemon already filters non-track and uri-less rows).
export async function fetchMaRecentlyPlayed(
  limit = 20,
  signal?: AbortSignal,
): Promise<SpotifyRecentlyPlayedItem[]> {
  try {
    const res = await fetch(`${API_BASE}/ma/recent?limit=${limit}`, { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`ma/recent ${res.status}`)
    const body = (await safeJson(res)) as { tracks?: MaTrackCard[] }
    // SpotifyRecentlyPlayedItem.track requires a concrete album object (the
    // Web API always ships one) - fill empty fallbacks, never undefined
    return (body.tracks ?? []).map((t) => ({
      track: {
        id: t.id,
        name: t.name,
        uri: t.uri,
        artists: (t.artists ?? []).map((name) => ({ name })),
        album: { name: t.album ?? '', images: t.image_url ? [{ url: t.image_url }] : [] },
      },
      // no played_at in the MA play-log mapping - the consumers only read it
      // for sorting hints, and the list already arrives in recency order
      played_at: '',
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`ma/recent: ${message}`, { cause: err })
  }
}

// issue #138: shared MaTrackCard -> Spotify track field adaptation (artists
// are flat strings on the MA wire; absent image_url yields no artwork entry,
// which pickArtUrl degrades to a placeholder exactly like missing images)
function maTrackToSpotifyTrack(t: MaTrackCard): SpotifyPlaylistTrack {
  return {
    id: t.id,
    name: t.name,
    uri: t.uri,
    artists: (t.artists ?? []).map((name) => ({ name })),
    album:
      t.album || t.image_url
        ? { name: t.album ?? '', images: t.image_url ? [{ url: t.image_url }] : [] }
        : undefined,
    duration_ms: t.duration_ms,
    position: t.position,
  }
}

// issue #25: some lyrics sources answer instrumental tracks with a bare
// "Instrumental" placeholder line instead of no result. That is not usable lyric
// content, so it is classified as no-lyrics (null) exactly like a 404 — every
// layout decision then renders the standard full-width view. The check is the
// single shared derivation for this classification: case-insensitive, and each
// non-empty line must reduce to the bare word once all non-alphanumeric
// decoration is stripped. It is applied at the one point where fetched lyrics
// enter the app (fetchLyrics below) and stays available for reuse (e.g. #26).
// issue #31: the daemon's lrclib source answers 200 OK with a decorated
// "♪ Instrumental ♪" line, which this normalization now absorbs as well.
export function isInstrumentalPlaceholder(lines: { words: string }[]): boolean {
  const stripped = lines
    .map((l) => l.words.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter((w) => w !== '')
  return stripped.length > 0 && stripped.every((w) => w === 'instrumental')
}

// null passes through; a result consisting solely of the instrumental placeholder
// becomes null; everything else (incl. zero-line results) is returned unchanged
export function normalizeLyrics(result: LyricsResult | null): LyricsResult | null {
  if (result !== null && isInstrumentalPlaceholder(result.lines)) return null
  return result
}

export async function fetchLyrics(
  trackId: string,
  meta: {
    track: string
    artist: string
    album?: string
    durationMs?: number
    episode?: boolean
    richsync?: boolean
  },
  signal?: AbortSignal,
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({
    track: meta.track,
    artist: meta.artist,
  })
  if (meta.album) params.set('album', meta.album)
  if (meta.durationMs && meta.durationMs > 0) params.set('duration', String(meta.durationMs))
  // route to the podcast-transcript source on the daemon
  if (meta.episode) params.set('episode', '1')
  // word by word timing
  if (meta.richsync) params.set('richsync', '1')

  const res = await fetch(`${API_BASE}/lyrics/${encodeURIComponent(trackId)}?${params}`, { signal })
  // 404 means nothing was found (instrumental or too niche); a 200 whose content
  // is just the "Instrumental" placeholder is equivalent (issue #25)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`lyrics ${res.status}`)
  return normalizeLyrics((await res.json()) as LyricsResult)
}

// whether the given track is in the liked songs
export async function fetchSavedState(uri: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${API_BASE}/player/saved?uri=${encodeURIComponent(uri)}`, {
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`player/saved ${res.status}`)
  const body = await res.json()
  return body?.saved === true
}

// add or remove the track from liked songs
export async function setSavedState(uri: string, saved: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/player/saved`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri, saved }),
  })
  if (!res.ok) throw new Error(`player/saved ${res.status}`)
}

export function eventsUrl(): string {
  return WS_URL
}

// ── Playlist API ──────────────────────────────────────────────────────────

// Spotify image arrays come largest-first (index 0 = 640px, 1 = 300px, 2 = 64px).
// The device decodes covers at native size, so full-res 640x640 images are a
// main-thread cost for small cards — prefer the smaller variants (bug8.2).
export function pickSpotifyImage(
  images: Array<{ url?: string | null } | null> | null | undefined,
  index = 1,
): string | undefined {
  if (!images || images.length === 0) return undefined
  // bug27: skip empty/invalid urls — an empty string is not a usable image
  // src (it would leave a black box instead of the AlbumArt placeholder)
  const urlAt = (i: number): string | undefined => {
    const url = images[i]?.url
    return typeof url === 'string' && url !== '' ? url : undefined
  }
  return urlAt(index) ?? urlAt(0)
}

// an item that may carry artwork (track or playlist shaped like the Web API)
export interface ArtworkSource {
  album?: { images?: Array<{ url?: string | null } | null> | null } | null
  images?: Array<{ url?: string | null } | null> | null
}

// bug27: central artwork extraction for cards — walks every image fallback
// layer (album images first, then the item's own images), preferring the
// 300px variant over the full-res 640px image like pickSpotifyImage (bug8.2)
// and skipping empty urls, so a card without any usable cover ends up with
// `undefined` and AlbumArt shows the music-note placeholder instead of a
// black box with an empty/invalid src.
export function pickArtUrl(item: ArtworkSource | null | undefined): string | undefined {
  if (!item) return undefined
  return pickSpotifyImage(item.album?.images) ?? pickSpotifyImage(item.images)
}

async function safeJson(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '')
    throw new Error(`Expected JSON but got ${ct || 'unknown'}: ${text.slice(0, 200)}`)
  }
  try {
    return res.json()
  } catch {
    throw new Error('Failed to parse JSON response')
  }
}

export async function fetchUserPlaylists(
  page = 0,
  limit = 50,
  signal?: AbortSignal,
): Promise<{ items: SpotifyPlaylist[]; total: number }> {
  try {
    const res = await fetch(
      `${API_BASE}/web-api/me/playlists?limit=${limit}&offset=${page * limit}`,
      // issue #15: the library changes out-of-band — never serve a stored copy
      { signal, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`web-api/me/playlists ${res.status}`)
    const body: SpotifyPlaylistResponse = (await safeJson(res)) as SpotifyPlaylistResponse
    return { items: body.items ?? [], total: body.total ?? 0 }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`web-api/me/playlists: ${message}`, { cause: err })
  }
}

// one page of a playlist's tracks (bug4: no hardcoded small limit — the
// caller pages with the Web API maximum page size until total is reached)
export async function fetchPlaylistTracks(
  playlistId: string,
  offset = 0,
  limit = 50,
  signal?: AbortSignal,
): Promise<SpotifyPlaylistTracksResponse> {
  try {
    const res = await fetch(
      `${API_BASE}/web-api/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}&offset=${offset}`,
      // issue #15/#56: the library changes out-of-band — never serve a stored copy
      { signal, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`web-api/playlists/${playlistId}/tracks ${res.status}`)
    const body: SpotifyPlaylistTracksResponse = (await safeJson(
      res,
    )) as SpotifyPlaylistTracksResponse
    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: body.total ?? 0,
      limit: body.limit ?? limit,
      offset: body.offset ?? offset,
      next: body.next ?? null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`web-api/playlists/${playlistId}/tracks: ${message}`, { cause: err })
  }
}

// one page of the saved tracks (Liked Songs; the daemon serves the Web API
// me/tracks shape from the library tracks query, bug22)
export async function fetchSavedTracks(
  offset = 0,
  limit = 50,
  signal?: AbortSignal,
): Promise<SpotifyPlaylistTracksResponse> {
  try {
    const res = await fetch(`${API_BASE}/web-api/me/tracks?limit=${limit}&offset=${offset}`, {
      // issue #15: the library changes out-of-band — never serve a stored copy
      signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`web-api/me/tracks ${res.status}`)
    const body: SpotifyPlaylistTracksResponse = (await safeJson(
      res,
    )) as SpotifyPlaylistTracksResponse
    return {
      items: Array.isArray(body.items) ? body.items : [],
      total: body.total ?? 0,
      limit: body.limit ?? limit,
      offset: body.offset ?? offset,
      next: body.next ?? null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`web-api/me/tracks: ${message}`, { cause: err })
  }
}

export async function fetchRecentlyPlayed(
  limit = 20,
  signal?: AbortSignal,
): Promise<SpotifyRecentlyPlayedItem[]> {
  try {
    const res = await fetch(`${API_BASE}/web-api/me/player/recently-played?limit=${limit}`, {
      signal,
    })
    if (!res.ok) throw new Error(`web-api/me/player/recently-played ${res.status}`)
    const body: SpotifyRecentlyPlayedResponse = (await safeJson(
      res,
    )) as SpotifyRecentlyPlayedResponse
    return body.items ?? []
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`web-api/me/player/recently-played: ${message}`, { cause: err })
  }
}
