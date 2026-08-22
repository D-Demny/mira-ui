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
