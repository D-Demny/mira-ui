// ticket 9.4 — the daemon's Home Assistant login + connection-test endpoints.
//
//   POST /api/ha/login   body { url, username, password }
//       200 { ok: true, token }   — the fresh 10-year long-lived token the
//                                   daemon minted via the HA WS flow
//       400 { ok: false, error: 'bad_request' }
//       401 { ok: false, error: 'invalid_credentials' | 'mfa' }
//       502 { ok: false, error: 'unreachable' }
//       404 / non-JSON body      — a daemon OLDER than ticket 9.4 (the Go
//                                   mux answers the unknown POST paths with
//                                   its plain-text 404)
//
//   POST /api/ha/test    body { url, token? }
//       200 { reachable, authenticated, defaults: { url } }
//           — ALWAYS 200 when the url is valid (reachable=false when the
//             HA server is down, authenticated=false on 401/403); the
//           defaults.url is the daemon's build-time config.yml value
//           (task 7: the modal pre-fills the URL field with it)
//       400 { ok: false, error: 'bad_request' } — missing/invalid url
//       404 / non-JSON body      — old daemon (as above)
//
// The UI bounds both requests with the standard 10 s timeout like its
// sibling clients (piProfile.ts). Chrome 69 has no AbortSignal.timeout —
// manual AbortController + setTimeout.
//
// SECURITY (ticket 9.4, HARD constraint): the username, password and the
// token travel in the request bodies (login) and in the login RESPONSE.
// They are NEVER logged — no console.* call in this file may ever include
// them, and the daemon never logs them either. Every error surfaced here
// carries the daemon's error CLASS (plus the HTTP status) and nothing of
// the credential values.

import { API_BASE } from '@/config'

export const HA_SETTINGS_TIMEOUT_MS = 10000

// the daemon's login error classes (ticket 9.4 design §4) — the UI maps
// these to the concrete error lines (Bug53 .errorDetail pattern)
export type HaLoginErrorCode =
  | 'bad_request'
  | 'invalid_credentials'
  | 'mfa'
  | 'unreachable'

// local (non-daemon) failure classes of this client
export type HaSettingsErrorCode =
  | HaLoginErrorCode
  | 'not_available' // non-JSON body — the daemon predates the endpoints
  | 'timeout'
  | 'network'

// the typed error the UI branches on (e.g. 'mfa' → "Token manuell
// eingeben", 'unreachable' → "Nicht erreichbar"). The message is a short
// English descriptor like its sibling clients ('pi profile timeout') — the
// German display text lives in the UI layer, not here.
export class HaSettingsApiError extends Error {
  readonly code: HaSettingsErrorCode
  // the HTTP status the daemon answered with (null for timeout/network)
  readonly status: number | null

  constructor(
    code: HaSettingsErrorCode,
    status: number | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'HaSettingsApiError'
    this.code = code
    this.status = status
  }
}

// res.json() throws a TypeError on non-JSON error bodies (the old daemon's
// 404 ships a plain-text page) — guard the parse (same pattern as
// piProfile.ts). NOTE: the body fragment is part of the error message —
// this file only calls safeJson on bodies that can never carry credentials
// (the login response's token is handled in haLogin's 200 path, never
// through errorFrom).
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

async function haSettingsFetch(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HA_SETTINGS_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (controller.signal.aborted) {
      // (Chrome 69: the { cause } option is ignored by older engines — the
      // property is simply absent, same pattern as piProfile.ts)
      throw new HaSettingsApiError('timeout', null, 'ha settings timeout', { cause: err })
    }
    // daemon down / offline (a network error, not a response)
    throw new HaSettingsApiError('network', null, 'ha settings network error', { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

// Maps a non-OK response to the typed error. A JSON body carries the
// daemon's error class; a NON-JSON body is the old-daemon signature (the
// plain-text 404) → 'not_available' with a clear "daemon outdated?" message.
// Neither path may surface credential values — the daemon's error bodies
// only carry the class string (ticket 9.4 design §4: "Passwort und Token
// landen in KEINER Log-Zeile").
async function errorFrom(label: string, res: Response): Promise<HaSettingsApiError> {
  try {
    const body = (await safeJson(res)) as { ok?: unknown; error?: unknown } | null
    if (typeof body === 'object' && body !== null) {
      const err = body.error
      if (
        err === 'bad_request' ||
        err === 'invalid_credentials' ||
        err === 'mfa' ||
        err === 'unreachable'
      ) {
        return new HaSettingsApiError(err, res.status, `${label} ${err} (${res.status})`)
      }
    }
    // JSON body without a known class — keep the status, class it as
    // bad_request (the only 400 the contract defines)
    return new HaSettingsApiError(
      'bad_request',
      res.status,
      `${label} ${res.status} (unknown error class)`,
    )
  } catch {
    // non-JSON body → the daemon predates the endpoints (old daemon,
    // compat matrix ticket 9.4 design §5)
    return new HaSettingsApiError(
      'not_available',
      res.status,
      `${label} not available (daemon outdated?)`,
    )
  }
}

export interface HaLoginCredentials {
  url: string
  username: string
  password: string
}

// Asks the daemon to log in to the HA server (WS auth + long-lived token
// minting) and returns the fresh token. Throws HaSettingsApiError with the
// concrete error class on any failure (see the endpoint contract above).
export async function haLogin(creds: HaLoginCredentials): Promise<{ token: string }> {
  const res = await haSettingsFetch('/api/ha/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // the credentials ride in the body — never in the URL, never logged
    body: JSON.stringify(creds),
  })
  if (!res.ok) throw await errorFrom('ha login', res)
  let body: { ok?: unknown; token?: unknown } | null
  try {
    body = (await safeJson(res)) as { ok?: unknown; token?: unknown } | null
  } catch {
    // a non-JSON 200 would make safeJson quote the body (which carries the
    // token) into the message — surface a clean class instead
    throw new HaSettingsApiError(
      'bad_request',
      res.status,
      'ha login 200 with non-JSON body (daemon contract violation)',
    )
  }
  if (body?.ok !== true || typeof body.token !== 'string' || body.token === '') {
    // contract violation (200 without a usable token) — the daemon is newer
    // than expected but answered malformed
    throw new HaSettingsApiError(
      'bad_request',
      res.status,
      'ha login 200 without token (daemon contract violation)',
    )
  }
  return { token: body.token }
}

export interface HaTestProbe {
  url: string
  // optional — omitted when no token is available (the probe then only
  // reports reachability)
  token?: string
}

export interface HaTestResult {
  reachable: boolean
  authenticated: boolean
  // the daemon's build-time default URL (config.yml) — '' when the daemon
  // answers without it (old new-daemon build / hand-edited config)
  defaultUrl: string
}

// Probes the given HA URL through the daemon (GET <url>/api/ with the
// optional Bearer token). ALWAYS resolves on a valid url (reachable=false
// is a RESULT, not an error); throws HaSettingsApiError only for a
// bad_request (400), an old daemon (non-JSON), timeout or network failure.
export async function haTest(probe: HaTestProbe): Promise<HaTestResult> {
  const body: Record<string, string> = { url: probe.url }
  if (probe.token !== undefined) body.token = probe.token
  const res = await haSettingsFetch('/api/ha/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await errorFrom('ha test', res)
  let data: { reachable?: unknown; authenticated?: unknown; defaults?: unknown } | null
  try {
    data = (await safeJson(res)) as {
      reachable?: unknown
      authenticated?: unknown
      defaults?: unknown
    } | null
  } catch {
    // a non-JSON 200 would make safeJson quote the body into the message —
    // surface a clean class instead (the no-leak rule, see file header)
    throw new HaSettingsApiError(
      'bad_request',
      res.status,
      'ha test 200 with non-JSON body (daemon contract violation)',
    )
  }
  const defaults =
    typeof data?.defaults === 'object' && data.defaults !== null
      ? (data.defaults as { url?: unknown })
      : null
  return {
    reachable: data?.reachable === true,
    authenticated: data?.authenticated === true,
    defaultUrl: typeof defaults?.url === 'string' ? defaults.url : '',
  }
}
