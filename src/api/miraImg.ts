// Epic 10 — hybrid compute server, task 2 (UI background & image route
// adapters).
//
// When the Pi helper server reports the remote_blur / remote_colors features
// (see ./miraServer.ts + src/hooks/useMiraServer.ts), the UI fetches
// pre-processed artwork and pre-extracted colors from it instead of doing
// the work locally. Both routes live under /img/ and are keyed by the
// ORIGINAL artwork (Spotify CDN) url, percent-encoded into the path — the
// CDN url is the only artwork identity the image call sites have (no
// hashing, no extra metadata):
//
//   GET /img/<encodeURIComponent(cdnUrl)>/160.jpg
//     the Pi's pre-processed 160x160 artwork (JPEG) — the pre-blurred cover
//     the menu cards display. The Pi lazily fetches cdnUrl, downsizes it to
//     160x160 and caches the result on disk (disk_cache).
//
//   GET /img/<encodeURIComponent(cdnUrl)>/colors
//     JSON { "dominant": [r, g, b] } — the Pi-extracted dominant color
//     (integers 0-255), replacing the UI's local canvas extraction.
//
// The Pi service (provisioned later by scripts/setup-pi.sh, epic10 task 3)
// implements exactly these routes and must answer cross-origin (the UI page
// is served from localhost:80) with Access-Control-Allow-Origin.
//
// Any failure (offline, timeout, non-OK, non-JSON, malformed) must degrade
// to today's standalone behavior: the direct CDN artwork (AlbumArt swaps to
// it after a failed Pi load) and the local canvas extraction (useColorExtract
// falls back to it; static category gradients remain the no-artwork case).

import { MIRA_SERVER_TIMEOUT_MS, MIRA_SERVER_URL } from './miraServer'

// How long the client waits for the Pi's pre-processed artwork before the
// AlbumArt img swaps to the direct (Spotify CDN) url. A plain setTimeout in
// the component — Chrome 69 has no AbortSignal.timeout, and an <img> load
// has no fetch timeout to lean on.
export const REMOTE_ART_TIMEOUT_MS = 4000

// The colors endpoint payload (kept minimal; both sides are hand-rolled)
export interface RemoteColors {
  dominant: [number, number, number]
}

// The Pi's pre-processed 160x160 artwork route for the given CDN url
export function remoteArtUrl(cdnUrl: string): string {
  return `${MIRA_SERVER_URL}/img/${encodeURIComponent(cdnUrl)}/160.jpg`
}

// The Pi's color-extraction route for the given CDN url
export function remoteColorsUrl(cdnUrl: string): string {
  return `${MIRA_SERVER_URL}/img/${encodeURIComponent(cdnUrl)}/colors`
}

// Artwork loader adapter (epic10 task 2): the Pi url when remoteBlur is
// enabled, otherwise the direct (Spotify CDN) url — the standalone
// behavior, byte-for-byte unchanged.
export function resolveArtworkUrl(cdnUrl: string, remoteBlur: boolean): string {
  return remoteBlur ? remoteArtUrl(cdnUrl) : cdnUrl
}

// Color engine adapter (epic10 task 2): the Pi colors route when
// remoteColors is enabled, otherwise undefined — the caller keeps its local
// extraction (the standalone behavior, unchanged).
export function resolveColorsUrl(
  cdnUrl: string,
  remoteColors: boolean,
): string | undefined {
  return remoteColors ? remoteColorsUrl(cdnUrl) : undefined
}

// res.json() throws a TypeError on non-JSON error bodies — guard the parse
// (same pattern as client.ts / homeassistant.ts / miraServer.ts)
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

function isRemoteColors(raw: unknown): raw is RemoteColors {
  if (typeof raw !== 'object' || raw === null) return false
  const dominant = (raw as { dominant?: unknown }).dominant
  if (!Array.isArray(dominant) || dominant.length !== 3) return false
  for (const value of dominant) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      return false
    }
  }
  return true
}

// Fetches the Pi-extracted dominant color for the given CDN url. Throws on
// network failure, timeout, non-OK status, non-JSON body, or a malformed
// payload — the caller (useColorExtract) then falls back to the local
// extraction, so a failing Pi never changes the result the user sees.
export async function fetchRemoteColors(
  cdnUrl: string,
): Promise<[number, number, number]> {
  // Chrome 69 target: AbortSignal.timeout() does not exist — plain
  // AbortController + setTimeout (same pattern as miraServer.ts)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MIRA_SERVER_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(remoteColorsUrl(cdnUrl), {
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    // our own timeout fired — surface a plain Error, since an aborted
    // fetch rejects with a DOMException
    if (controller.signal.aborted) {
      throw new Error('mira server colors timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`mira server colors ${res.status}`)
  const body = await safeJson(res)
  if (!isRemoteColors(body)) throw new Error('mira server colors: invalid payload')
  return body.dominant
}
