// Epic 10 — hybrid compute server.
//
// The Mira-Thing can optionally be paired with a Raspberry Pi helper server
// on the LAN (default 192.168.7.1:8080) that offloads artwork preprocessing
// (remote blur), color extraction, and disk caching. The UI pings the
// capabilities endpoint below on startup (and re-polls while the main menu is
// mounted) and degrades seamlessly to standalone mode when the server is
// unreachable — see src/hooks/useMiraServer.ts for the global state + hook.
//
// CORS note: the UI page is served from localhost:80 by the Thing's static
// web server, so this request is cross-origin. The Pi service must answer
// with Access-Control-Allow-Origin (same as the daemon API).

export const MIRA_SERVER_URL = 'http://192.168.7.1:8080'

export const MIRA_SERVER_TIMEOUT_MS = 2500

// Minimal capabilities schema the Pi server exposes at
// GET /api/v1/capabilities. Kept intentionally small (both sides are
// hand-rolled):
//   tier:         'cache'   — lightweight proxy (Pi Zero W): disk cache only
//             'compute'   — full engine (Pi Zero 2 W / Pi 4): cache + image
//                           preprocessing + color extraction
//   disk_cache:    server-side artwork disk cache is usable
//   remote_colors: server-side color extraction is available
//   remote_blur:   server-side 160x160 pre-blurred artwork is available
export interface MiraServerCapabilities {
  tier: 'cache' | 'compute'
  disk_cache: boolean
  remote_colors: boolean
  remote_blur: boolean
}

export interface MiraServerFeatures {
  diskCache: boolean
  remoteColors: boolean
  remoteBlur: boolean
}

// Global UI-side state derived from the capabilities (epic10 ticket §1).
export interface MiraServerState {
  mode: 'standalone' | 'lightweight' | 'compute'
  features: MiraServerFeatures
}

// Chrome 69 target: AbortSignal.timeout() does not exist, so the request
// timeout is implemented with a plain AbortController + setTimeout
// (same pattern as src/api/homeassistant.ts).
async function miraFetch(baseUrl: string, path: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MIRA_SERVER_TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    // our own timeout fired — surface a plain Error, since an aborted
    // fetch rejects with a DOMException
    if (controller.signal.aborted) {
      throw new Error('mira server timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// res.json() throws a TypeError on non-JSON error bodies — guard the parse
// (same pattern as client.ts / homeassistant.ts)
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

// Offline / timeout / parse error / unknown tier all degrade to this state:
// the Thing renders everything by itself (Mode 1, standalone direct).
export function standaloneMiraServerState(): MiraServerState {
  return {
    mode: 'standalone',
    features: { diskCache: false, remoteColors: false, remoteBlur: false },
  }
}

// Pure mapping from the raw capabilities JSON to the UI state. Any field
// that is not the expected type (or an unknown tier) degrades to
// standalone — a half-configured or misbehaving Pi must never enable a
// remote feature the server does not actually serve.
export function toMiraServerState(raw: unknown): MiraServerState {
  if (typeof raw !== 'object' || raw === null) return standaloneMiraServerState()
  const body = raw as Partial<MiraServerCapabilities>
  if (body.tier !== 'cache' && body.tier !== 'compute') {
    return standaloneMiraServerState()
  }
  return {
    mode: body.tier === 'compute' ? 'compute' : 'lightweight',
    features: {
      diskCache: body.disk_cache === true,
      remoteColors: body.remote_colors === true,
      remoteBlur: body.remote_blur === true,
    },
  }
}

// `ip` (epic10 task 4): an optional override for the manual re-check from
// the settings UI — the Pi may not live at the default address. The
// 30s background poll (useMiraServer) always pings MIRA_SERVER_URL, and the
// /img/ artwork + color routes (miraImg.ts) keep the default base url; a
// permanently different address would need those to become dynamic.
// A blank ip falls back to the default address.
export function capabilitiesBaseUrl(ip?: string): string {
  return ip && ip.trim() !== '' ? `http://${ip.trim()}:8080` : MIRA_SERVER_URL
}

// Fetches the capabilities and maps them to the UI state. Throws on
// network failure, timeout, non-OK status, or invalid JSON — the store
// layer (useMiraServer) catches and degrades to standalone.
export async function fetchMiraServerCapabilities(ip?: string): Promise<MiraServerState> {
  const res = await miraFetch(capabilitiesBaseUrl(ip), '/api/v1/capabilities')
  if (!res.ok) throw new Error(`mira server capabilities ${res.status}`)
  return toMiraServerState(await safeJson(res))
}
