// Epic 10 — hybrid compute server.
//
// The Mira-Thing can optionally be paired with a Raspberry Pi helper server
// on the LAN that offloads artwork preprocessing (remote blur), color
// extraction, and disk caching. The UI pings the capabilities endpoint below
// (and re-polls while a consumer of src/hooks/useMiraServer.ts is mounted)
// and degrades seamlessly to standalone mode when the server is unreachable.
//
// Base URL (ticket10-5A): there is no hard-coded default address anymore.
// piServerBase(ip) is the SINGLE source of truth for the Pi address
// (http://<ip>:8080) and is used by the capabilities poll (this module),
// the /img/ artwork + color routes (./miraImg.ts), and everything else that
// talks to a Pi. Which ip is "the" ip is decided by the ACTIVE Pi profile
// in the settings store (src/settings.ts) — activePiServerBase() resolves
// it, or null while no profile is configured (then the app runs standalone
// and no Pi route is used).
//
// CORS note: the UI page is served from localhost:80 by the Thing's static
// web server, so this request is cross-origin. The Pi service must answer
// with Access-Control-Allow-Origin (same as the daemon API).

import { activePiProfile, getSettings } from '@/settings'

export const MIRA_SERVER_PORT = 8080

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

// The base url of the given Pi (single source of truth, ticket10-5A) —
// every Pi route derives from this.
export function piServerBase(ip: string): string {
  return `http://${ip.trim()}:${MIRA_SERVER_PORT}`
}

// The capabilities route of the given Pi (the ticket's naming; identical to
// piServerBase — the capabilities poll and the /img/ routes share the base).
export function capabilitiesBaseUrl(ip: string): string {
  return piServerBase(ip)
}

// ticket10-5A: the base url of the ACTIVE Pi profile, or null while no
// profile is configured (fresh install / all profiles removed — the app
// runs standalone and no Pi route may be used).
export function activePiServerBase(): string | null {
  const profile = activePiProfile(getSettings())
  return profile ? piServerBase(profile.ip) : null
}

// Fetches the capabilities of the Pi at the given address and maps them to
// the UI state. Throws on network failure, timeout, non-OK status, or
// invalid JSON — the store layer (useMiraServer) catches and degrades to
// standalone.
export async function fetchMiraServerCapabilities(ip: string): Promise<MiraServerState> {
  const res = await miraFetch(capabilitiesBaseUrl(ip), '/api/v1/capabilities')
  if (!res.ok) throw new Error(`mira server capabilities ${res.status}`)
  return toMiraServerState(await safeJson(res))
}
