// Epic 10 ticket10-6 (part A contract) — the daemon's USB-tethering
// endpoints. The onboarding wizard (and the daemon's own reboot recovery)
// ask the LOCAL daemon to configure USB tethering on the RPi over SSH: the
// daemon execs scripts/setup-tethering.sh (which detects the RPi uplink —
// Ethernet vs WLAN — and sets up usb0 + NAT/DNS) and tracks the job in
// memory. The UI polls the job status and shows the log tail.
//
//   POST /api/pi/tethering            { profile_id? }
//       202 { job_id }  — accepted, the run is tracked via /status
//       400 { error }   — validation (unknown / unsafe / credential-less
//                          profile, bad JSON)
//       409 { error }   — no device-side key pair for the profile (the text
//                          says to run the provisioning wizard first) OR a
//                          tethering run is already in progress
//       500 { error }   — script not packaged
//       503 (no body)   — handler not wired (old daemon build)
//
//   GET /api/pi/tethering/status
//       200 { state: 'idle'|'running'|'success'|'failed',
//             job_id?, profile_id?, started_at?, finished_at?,
//             uplink?: 'eth'|'wlan'|'none'  (empty before a finished run),
//             tethering_ok: bool, internet_ok: bool,   // ALWAYS present
//             error?, log_tail?: string[] (≤ 20 lines) }
//       503 (no body)   — handler not wired (old daemon build)
//
// The request body carries NO credentials (unlike /api/setup-pi): the
// daemon takes host/user/password from the stored profile (the key is the
// primary auth, the password only the run_ssh fallback), so the credentials
// never leave the device a second time.

import { API_BASE } from '@/config'

// the daemon is local and answers in milliseconds; a generous timeout still
// bounds the calls (Chrome 69 has no AbortSignal.timeout — manual
// AbortController + setTimeout, same pattern as piServer.ts)
export const TETHERING_TIMEOUT_MS = 10000

// how often the wizard polls the job status while the tethering run goes on
// (the 2 s rhythm of the Pi API surface, ticket10-6C)
export const TETHERING_POLL_MS = 2000

// the daemon kills the script at 10 minutes; the UI gives up watching at
// the same wall time (plus one poll period of slack is never needed — the
// cap check runs on the polling rhythm)
export const TETHERING_UI_CAP_MS = 10 * 60 * 1000

export type TetheringState = 'idle' | 'running' | 'success' | 'failed'

// the RPi's upstream as detected by the script (alphabetically-first UP
// interface wins — 'eth' = Ethernet, 'wlan' = WLAN, 'none' = neither)
export type TetheringUplink = 'eth' | 'wlan' | 'none'

export interface TetheringStatus {
  state: TetheringState
  jobId?: string
  profileId?: string
  // RFC3339 UTC timestamps (missing = not set yet)
  startedAt?: string
  finishedAt?: string
  // the RPi uplink (missing before a finished run / unknown)
  uplink?: TetheringUplink
  // both flags are ALWAYS present in the daemon response — false means
  // "not achieved yet", not "not run"
  tetheringOk: boolean
  internetOk: boolean
  // the run's error message (missing = no error)
  error?: string
  // newest log lines of the script (≤ 20)
  logTail: string[]
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

async function tetheringFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TETHERING_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('pi tethering timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Extracts the daemon's error message from an error response. The 503 has
// no body at all — it keeps the plain status text.
async function errorFrom(res: Response): Promise<string> {
  const base = `pi/tethering ${res.status}`
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

// Triggers the USB-tethering setup on the RPi. Resolves on 202 (the run is
// tracked via getPiTetheringStatus), throws an Error with the daemon's
// message on 400/409/5xx and on network/timeout failures. `profileId` is
// optional (missing = the daemon's active profile from the settings blob —
// the wizard always sends the explicit id it operates on).
export async function startPiTethering(profileId?: string): Promise<void> {
  const body: Record<string, string> = {}
  if (profileId) body.profile_id = profileId
  const res = await tetheringFetch('/api/pi/tethering', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 202) return
  throw new Error(await errorFrom(res))
}

// Reads the tethering job status. Throws on non-OK (503 = old daemon
// without the endpoints) and network/timeout failures.
export async function getPiTetheringStatus(): Promise<TetheringStatus> {
  const res = await tetheringFetch('/api/pi/tethering/status')
  if (!res.ok) throw new Error(await errorFrom(res))
  const body = (await safeJson(res)) as Partial<Record<string, unknown>>
  const state: TetheringState =
    body.state === 'running' || body.state === 'success' || body.state === 'failed'
      ? body.state
      : 'idle'
  const uplink: TetheringUplink | undefined =
    body.uplink === 'eth' || body.uplink === 'wlan' || body.uplink === 'none'
      ? body.uplink
      : undefined
  const logTail = Array.isArray(body.log_tail)
    ? body.log_tail.filter((line): line is string => typeof line === 'string')
    : []
  return {
    state,
    jobId: typeof body.job_id === 'string' && body.job_id !== '' ? body.job_id : undefined,
    profileId:
      typeof body.profile_id === 'string' && body.profile_id !== '' ? body.profile_id : undefined,
    startedAt:
      typeof body.started_at === 'string' && body.started_at !== '' ? body.started_at : undefined,
    finishedAt:
      typeof body.finished_at === 'string' && body.finished_at !== ''
        ? body.finished_at
        : undefined,
    uplink,
    // the daemon always sends both flags (bool); a missing field (older
    // shape / partial response) degrades to "not achieved yet"
    tetheringOk: body.tethering_ok === true,
    internetOk: body.internet_ok === true,
    error: typeof body.error === 'string' && body.error !== '' ? body.error : undefined,
    logTail,
  }
}
