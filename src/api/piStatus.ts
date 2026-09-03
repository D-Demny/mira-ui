// Epic 10 ticket10-4 (part B) — the daemon's Pi auto-reconnect status.
//
// The PiSession manager (daemon/pi_session.go, ticket10-4 part A) starts
// with the daemon, restores the key-only SSH session to the configured Pi
// after a reboot, and retries on a fixed 10 s rhythm when the connection
// drops. Its live state is exposed as:
//
//   GET /api/pi/status
//       200 { conn: 'connected'|'connecting'|'disconnected',
//             last_attempt_at? (RFC3339 UTC), model?, tier?,
//             profile_id?, profiles?: [{ id, key_installed }] }
//       503 (no body)   — handler not wired (old daemon build)
//
// `conn` is ALWAYS present; the other fields are omitted when unknown
// (missing / empty → `undefined` here, same safeJson pattern as piServer.ts).
// ticket10-5: `conn`/`profile_id` describe the session bound to the ACTIVE
// profile; `profiles` carries the DEVICE-SIDE key presence for every stored
// profile (omitted when none are stored / on old daemons — the settings view
// falls back to the per-profile `keyInstalled` flag from the settings store,
// see keyInstalledFor in PiServerModal).
// The Raspberry Pi settings view polls this on the same 2 s rhythm as the
// provisioning job status (one shared interval in PiServerModal) and hides
// its status line entirely when the daemon is too old (503).

import { API_BASE } from '@/config'

// the daemon is local and answers in milliseconds; a generous timeout still
// bounds the poll (Chrome 69 has no AbortSignal.timeout — manual
// AbortController + setTimeout, same pattern as piServer.ts)
export const PI_STATUS_TIMEOUT_MS = 10000

export type PiConn = 'connected' | 'connecting' | 'disconnected'

// ticket10-5: one entry of the per-profile list — the profile id (matches
// the settings store's PiProfile.id) and whether the device-side key pair
// for it exists (the "SSH-Key installiert" vs "Passwort-Login erforderlich"
// source with daemon precedence, see PiServerModal)
export interface PiProfileKeyStatus {
  id: string
  keyInstalled: boolean
}

export interface PiStatus {
  // always present in the daemon response; an unknown value degrades to
  // 'disconnected' (the line then shows the safe state, never nothing)
  conn: PiConn
  // RFC3339 UTC timestamp of the last reconnect attempt (missing = none yet)
  lastAttemptAt?: string
  // last known-good provisioning result (missing = unknown)
  model?: string
  tier?: string
  // ticket10-5: the profile the session is bound to (missing = none yet)
  profileId?: string
  // ticket10-5: per-profile device-side key existence for all stored
  // profiles (missing = old daemon without the multi-profile shape)
  profiles?: PiProfileKeyStatus[]
}

// res.json() throws a TypeError on non-JSON error bodies (the 503 ships
// without one) — guard the parse (same pattern as piServer.ts)
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

async function piStatusFetch(path: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PI_STATUS_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('pi status timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Extracts the daemon's error message from an error response. The 503 has
// no body at all — it keeps the plain status text.
async function errorFrom(res: Response): Promise<string> {
  const base = `pi/status ${res.status}`
  try {
    const body = await safeJson(res)
    if (typeof body === 'object' && body !== null) {
      const err = (body as { error?: unknown }).error
      if (typeof err === 'string' && err !== '') return err
    }
  } catch {
    // non-JSON body — keep the status text
  }
  return base
}

// Reads the live Pi session status. Throws on non-OK (503 = old daemon
// without the handler) and on network/timeout failures.
export async function fetchPiStatus(): Promise<PiStatus> {
  const res = await piStatusFetch('/api/pi/status')
  if (!res.ok) throw new Error(await errorFrom(res))
  const body = (await safeJson(res)) as Partial<Record<string, unknown>>
  const conn: PiConn =
    body.conn === 'connected' || body.conn === 'connecting' || body.conn === 'disconnected'
      ? body.conn
      : 'disconnected'
  // ticket10-5: per-profile key existence — malformed entries (non-object,
  // missing/empty id) are dropped, the rest maps key_installed strictly
  const profiles = Array.isArray(body.profiles)
    ? body.profiles
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({
          id: typeof e.id === 'string' ? e.id : '',
          keyInstalled: e.key_installed === true,
        }))
        .filter((e) => e.id !== '')
    : undefined
  return {
    conn,
    lastAttemptAt:
      typeof body.last_attempt_at === 'string' && body.last_attempt_at !== ''
        ? body.last_attempt_at
        : undefined,
    model: typeof body.model === 'string' && body.model !== '' ? body.model : undefined,
    tier: typeof body.tier === 'string' && body.tier !== '' ? body.tier : undefined,
    profileId:
      typeof body.profile_id === 'string' && body.profile_id !== '' ? body.profile_id : undefined,
    profiles,
  }
}
