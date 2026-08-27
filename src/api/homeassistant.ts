import { HOME_ASSISTANT_URL } from '@/config'

export interface HaEntityState {
  entity_id: string
  state: string
  attributes?: Record<string, unknown>
}

const HA_TIMEOUT_MS = 5000

// Chrome 69 target: AbortSignal.timeout() does not exist, so the request
// timeout is implemented with a plain AbortController + setTimeout.
async function haFetch(
  path: string,
  init: RequestInit = {},
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HA_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort)
  }
  try {
    return await fetch(`${HOME_ASSISTANT_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    // our own timeout fired (the external signal is still alive) — surface a
    // plain Error, since an aborted fetch rejects with a DOMException
    if (controller.signal.aborted && !(externalSignal?.aborted ?? false)) {
      throw new Error('home assistant timeout', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export async function fetchHaEntityState(
  entityId: string,
  signal?: AbortSignal,
): Promise<HaEntityState> {
  // the daemon maps /ha-api/<path> to the HA REST root /api/<path>
  const res = await haFetch(`/states/${encodeURIComponent(entityId)}`, {}, signal)
  if (!res.ok) throw new Error(`home assistant ${res.status}`)
  const body = (await res.json()) as HaEntityState
  if (!body || typeof body.state !== 'string') throw new Error('invalid entity state')
  return body
}

// the toggle service answers with an array of the updated entity states
export async function toggleHaEntity(
  entityId: string,
  signal?: AbortSignal,
): Promise<HaEntityState | null> {
  const res = await haFetch(
    '/services/light/toggle',
    { method: 'POST', body: JSON.stringify({ entity_id: entityId }) },
    signal,
  )
  if (!res.ok) throw new Error(`home assistant ${res.status}`)
  const body = (await res.json()) as HaEntityState[]
  if (!Array.isArray(body)) return null
  return body.find((s) => s.entity_id === entityId) ?? null
}

// bug46: res.json() throws a TypeError on non-JSON error bodies (HTML 500s
// from the proxy) — guard the parse (same pattern as client.ts)
async function safeJson(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '')
    throw new Error(`Expected JSON but got ${ct || 'unknown'}: ${text.slice(0, 200)}`)
  }
  try {
    return (await res.json()) as unknown
  } catch {
    throw new Error('Failed to parse JSON')
  }
}

// bug46: light.turn_on via the daemon's GENERIC /ha-api/ service proxy
// (POST /ha-api/services/light/turn_on) — the proxy forwards the body
// verbatim, so the new service parameters need no daemon change.
//
// Parameter note (ticket correction): HA's color-temperature parameter for
// light.turn_on is `color_temp_kelvin` — NOT `kelvin` as the ticket wrote.
// Brightness is `brightness_pct` (0–100).
export interface HaLightServiceData {
  brightness_pct?: number
  color_temp_kelvin?: number
}

export async function callHaLightService(
  entityId: string,
  data: HaLightServiceData,
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  const res = await haFetch(
    '/services/light/turn_on',
    { method: 'POST', body: JSON.stringify({ entity_id: entityId, ...data }) },
    signal,
  )
  if (!res.ok) throw new Error(`home assistant ${res.status}`)
  const body = (await safeJson(res)) as HaEntityState[]
  return Array.isArray(body) ? body : []
}

export function setHaLightBrightness(
  entityId: string,
  pct: number,
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  // turn_on cannot express "off": brightness_pct is 1–100, so the modal's
  // 0 % slider position maps to the minimum 1 %
  const value = Math.max(1, Math.min(100, Math.round(pct)))
  return callHaLightService(entityId, { brightness_pct: value }, signal)
}

export function setHaLightColorTemp(
  entityId: string,
  kelvin: number,
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  return callHaLightService(entityId, { color_temp_kelvin: Math.round(kelvin) }, signal)
}
