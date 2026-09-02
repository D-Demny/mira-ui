// Epic 10 task 4 — the daemon's Pi provisioning endpoints.
//
// The "Pi automatisch einrichten" button of the Raspberry Pi settings view
// asks the LOCAL daemon to run the provisioning wizard (setup-pi.sh, epic10
// task 3) over USB-Ethernet: the daemon execs the script with the SSH
// credentials from the settings and tracks the job in memory. The UI then
// polls the job status and shows the tail of the wizard log.
//
//   POST /api/setup-pi            { ip, user, password }
//       202 { job_id }  — accepted, the run is tracked via /status
//       400 { error }   — validation (ip format, empty fields) / bad JSON
//       409 { error }   — a provisioning run is already in progress
//       500 { error }   — wizard script missing / spawn failure
//       503 (no body)   — handler not wired (old daemon build)
//
//   GET /api/setup-pi/status
//       200 { state: 'idle'|'running'|'success'|'failed',
//             job_id?, started_at?, finished_at?, model?, tier?,
//             error?, log_tail?: string[] }
//       503 (no body)   — handler not wired (old daemon build)
//
// The daemon API is CORS-open (allow_origin "*"), same as the /ha-api/
// proxy. The password travels only to the daemon, which hands it to the
// script as an env var (never on the CLI, never in its logs).

import { API_BASE } from '@/config'

// The daemon is local and answers in milliseconds; a generous timeout still
// bounds the buttons (Chrome 69 has no AbortSignal.timeout — manual
// AbortController + setTimeout, same pattern as homeassistant.ts)
export const SETUP_PI_TIMEOUT_MS = 10000

// how often the settings view polls the job status while the wizard runs
export const SETUP_PI_POLL_MS = 2000

// the UI gives up after this much wall time; the daemon itself kills the
// script at 30 minutes, the UI only stops watching earlier than that
export const SETUP_PI_UI_CAP_MS = 5 * 60 * 1000

export interface SetupPiCredentials {
  ip: string
  user: string
  password: string
}

export type SetupPiState = 'idle' | 'running' | 'success' | 'failed'

export interface SetupPiStatus {
  state: SetupPiState
  jobId?: string
  model?: string
  tier?: string
  error?: string
  logTail: string[]
}

// res.json() throws a TypeError on non-JSON error bodies (the 503s ship
// without one) — guard the parse (same pattern as miraServer.ts)
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

async function setupPiFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SETUP_PI_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('setup-pi timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Extracts the daemon's error message from an error response. The 503s have
// no body at all — those keep the plain status text.
async function errorFrom(res: Response): Promise<string> {
  const base = `setup-pi ${res.status}`
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

// Triggers the provisioning wizard. Resolves on 202 (the run is tracked via
// getPiSetupStatus), throws an Error with the daemon's message on 400/409/
// 5xx and on network/timeout failures.
export async function startPiSetup(creds: SetupPiCredentials): Promise<void> {
  const res = await setupPiFetch('/api/setup-pi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (res.status === 202) return
  throw new Error(await errorFrom(res))
}

// Reads the job status. Throws on non-OK (503 = old daemon without the
// endpoints) and network/timeout failures.
export async function getPiSetupStatus(): Promise<SetupPiStatus> {
  const res = await setupPiFetch('/api/setup-pi/status')
  if (!res.ok) throw new Error(await errorFrom(res))
  const body = (await safeJson(res)) as Partial<Record<string, unknown>>
  const state: SetupPiState =
    body.state === 'running' || body.state === 'success' || body.state === 'failed'
      ? body.state
      : 'idle'
  const logTail = Array.isArray(body.log_tail)
    ? body.log_tail.filter((line): line is string => typeof line === 'string')
    : []
  return {
    state,
    jobId: typeof body.job_id === 'string' ? body.job_id : undefined,
    model: typeof body.model === 'string' && body.model !== '' ? body.model : undefined,
    tier: typeof body.tier === 'string' && body.tier !== '' ? body.tier : undefined,
    error: typeof body.error === 'string' && body.error !== '' ? body.error : undefined,
    logTail,
  }
}
