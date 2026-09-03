// Epic 10 ticket10-5 (part C) — the daemon's Pi profile deletion endpoint.
//
//   DELETE /api/pi/profile?id=<profileId>
//       200 { key_removed, authorized_keys_removed, error? }
//       400 { error }   — missing/unsafe profile id, bad JSON body
//       503 (no body)   — handler not wired (old daemon build)
//
// The optional JSON body { ip, user, password } enables the best-effort
// Pi-side authorized_keys cleanup; the device-side key removal always
// happens. The daemon never touches the settings blob: the UI removes the
// profile from the store itself and re-points activePiId (PiServerModal,
// ticket10-5C).
//
// The UI bounds the request with the standard 10 s timeout like its sibling
// clients. The daemon's Pi-side cleanup (key-first SSH, up to 3 min
// server-side) keeps running after an aborted fetch — by design the
// endpoint is best-effort and the profile removal in the store never waits
// for it.

import { API_BASE } from '@/config'

export const PI_PROFILE_TIMEOUT_MS = 10000

export interface PiProfileDeleteCredentials {
  ip?: string
  user?: string
  password?: string
}

export interface PiProfileDeleteResult {
  // the device-side key pair was removed
  keyRemoved: boolean
  // the public key was removed from the Pi's authorized_keys (reachable Pi)
  authorizedKeysRemoved: boolean
  // Pi-side cleanup problem (missing/empty = none)
  error?: string
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

async function piProfileFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PI_PROFILE_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('pi profile timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Extracts the daemon's error message from an error response. The 503 has
// no body at all — it keeps the plain status text.
async function errorFrom(res: Response): Promise<string> {
  const base = `pi/profile ${res.status}`
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

// Removes a profile's device-side key pair and — when the credentials are
// carried in the body — its public key from the Pi's authorized_keys.
// Resolves on 200 (even with a best-effort cleanup error in `error`),
// throws an Error with the daemon's message on 400/5xx and network/timeout.
export async function deletePiProfile(
  profileId: string,
  creds: PiProfileDeleteCredentials,
): Promise<PiProfileDeleteResult> {
  const res = await piProfileFetch(`/api/pi/profile?id=${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (!res.ok) throw new Error(await errorFrom(res))
  const body = (await safeJson(res)) as Partial<Record<string, unknown>>
  return {
    keyRemoved: body.key_removed === true,
    authorizedKeysRemoved: body.authorized_keys_removed === true,
    error: typeof body.error === 'string' && body.error !== '' ? body.error : undefined,
  }
}
