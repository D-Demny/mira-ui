import { HOME_ASSISTANT_URL } from '@/config'

export interface HaEntityState {
  entity_id: string
  state: string
  attributes?: Record<string, unknown>
}

const HA_TIMEOUT_MS = 5000

// bug53: the full state catalog (GET /states) is a large payload that can take
// longer than the single-state budget on the device path — the timeout must
// EXCEED the daemon proxy's own 8 s client timeout so that a genuinely slow or
// broken HA call surfaces as the daemon's meaningful JSON error (e.g. the
// 502 {"error":"home assistant unreachable"}) instead of the UI aborting first
export const CATALOG_TIMEOUT_MS = 15_000

// testability seam (bug53): module-level override of the DEFAULT fetch
// timeout so tests can trigger the abort deterministically without real 5 s
// waits (fake timers + MSW, see the timeout tests in __tests__)
let haTimeoutOverride: number | null = null

export function __setHaTimeoutForTests(ms: number | null) {
  haTimeoutOverride = ms
}

// Chrome 69 target: AbortSignal.timeout() does not exist, so the request
// timeout is implemented with a plain AbortController + setTimeout.
async function haFetch(
  path: string,
  init: RequestInit = {},
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? haTimeoutOverride ?? HA_TIMEOUT_MS,
  )
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
  // bug56: 0 % (or a negative value) must switch the light OFF — turn_on
  // cannot express "off" (brightness_pct is bounded 1–100), so the modal's
  // 0 % slider position routes to light.turn_off with only { entity_id };
  // 1–100 % stays on light.turn_on with brightness_pct (capped at 100)
  const value = Math.round(pct)
  if (value <= 0) return callHaService('light', 'turn_off', { entity_id: entityId }, signal)
  return callHaLightService(entityId, { brightness_pct: Math.min(100, value) }, signal)
}

export function setHaLightColorTemp(
  entityId: string,
  kelvin: number,
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  return callHaLightService(entityId, { color_temp_kelvin: Math.round(kelvin) }, signal)
}

// HA's SUPPORT_BRIGHTNESS feature flag (bit 0 of the supported_features
// bitmask) — the pre-color-modes way of advertising dimmability
const SUPPORT_BRIGHTNESS = 1

// bug46: derive dimmability + the 0–100 brightness level from the state
// attributes. Ticket rule (primary path): a light is dimmable when
// supported_color_modes contains 'brightness' or 'color_temp' (all 9
// configured lights report ["color_temp", "xy"], so all of them are
// dimmable). The legacy supported_features bit 0 (SUPPORT_BRIGHTNESS) counts
// additionally as a strict union: integrations that predate color modes may
// only advertise dimmability there, and any light reporting it must get the
// popup. Either check alone is sufficient (the ticket rule stays at least
// equally powerful — the union can only add lights, never remove them);
// switches and non-dimmable lights report neither and stay direct toggles.
// The brightness attribute is 0–255, or null while the light is off.
// (ticket 9.3: moved from src/hooks/useHomeLight.ts — it is pure
// HaEntityState knowledge and belongs with the API layer)
export function lightCapabilities(
  entity: HaEntityState,
): { dimmable: boolean; brightnessPct: number | null } {
  const attrs = entity.attributes ?? {}
  const rawModes = attrs.supported_color_modes
  const modes = Array.isArray(rawModes)
    ? rawModes.filter((mode): mode is string => typeof mode === 'string')
    : []
  const rawFeatures = attrs.supported_features
  const supportedFeatures =
    typeof rawFeatures === 'number' && Number.isFinite(rawFeatures) ? rawFeatures : 0
  const dimmable =
    modes.includes('brightness') ||
    modes.includes('color_temp') ||
    (supportedFeatures & SUPPORT_BRIGHTNESS) !== 0
  const rawBrightness = attrs.brightness
  const brightnessPct =
    typeof rawBrightness === 'number' &&
    Number.isFinite(rawBrightness) &&
    rawBrightness > 0
      ? Math.round((rawBrightness / 255) * 100)
      : null
  return { dimmable, brightnessPct }
}

// ticket 9.3: the domains the Home carousel can control — the order doubles
// as the catalog sort order (priority)
export const HOME_ENTITY_DOMAINS = [
  'light',
  'switch',
  'fan',
  'scene',
  'cover',
  'input_boolean',
  'media_player',
] as const

export interface HaEntityCatalogEntry {
  entityId: string
  domain: string
  label: string
  state: string
  active: boolean | null
}

// ticket 9.3: which state counts as "active" per domain. `null` = no active
// concept (scenes are stateless) or a state the function does not know — the
// UI renders no on/off badge for those
export function entityActive(domain: string, state: string): boolean | null {
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return state === 'on'
    case 'cover':
      return state === 'open'
    case 'media_player':
      return state === 'playing'
    case 'scene':
      return null
    default:
      return ['off', 'closed', 'paused', 'idle', 'standby'].includes(state) ? false : null
  }
}

// ticket 9.3: readable fallback label when an entity has no friendly_name
// (domain prefix stripped, underscores to spaces, words capitalized):
// switch.wasserpumpe_keller → "Wasserpumpe Keller"
export function humanizeEntityLabel(entityId: string): string {
  const dot = entityId.indexOf('.')
  const name = dot === -1 ? entityId : entityId.slice(dot + 1)
  return name
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// ticket 9.3: flatten the raw GET /states object into the carousel catalog —
// only the controllable domains survive (domain = prefix before the first
// '.'), labels prefer friendly_name, sorted by domain priority then label
export function toHomeEntityCatalog(raw: Record<string, HaEntityState>): HaEntityCatalogEntry[] {
  const entries: HaEntityCatalogEntry[] = []
  for (const entityId of Object.keys(raw)) {
    const entity = raw[entityId]
    if (!entity) continue
    const dot = entityId.indexOf('.')
    if (dot === -1) continue
    const domain = entityId.slice(0, dot)
    if ((HOME_ENTITY_DOMAINS as readonly string[]).indexOf(domain) === -1) continue
    const state = entity.state
    if (typeof state !== 'string') continue
    const rawLabel = (entity.attributes ?? {}).friendly_name
    const label =
      typeof rawLabel === 'string' && rawLabel.length > 0 ? rawLabel : humanizeEntityLabel(entityId)
    entries.push({ entityId, domain, label, state, active: entityActive(domain, state) })
  }
  entries.sort((a, b) => {
    const da = (HOME_ENTITY_DOMAINS as readonly string[]).indexOf(a.domain)
    const db = (HOME_ENTITY_DOMAINS as readonly string[]).indexOf(b.domain)
    if (da !== db) return da - db
    return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })
  })
  return entries
}

// ticket 9.3: the full state catalog (GET /states via the daemon proxy)
// bug53: the dedicated CATALOG_TIMEOUT_MS budget (larger than the single-state
// HA_TIMEOUT_MS, see above)
// bug55: HA answers GET /api/states with a JSON ARRAY of
// {entity_id, state, attributes} entries (verified on the device: HTTP 200,
// 576,624 B, 1,186 entries) — the old guard rejected arrays, so every
// successful catalog fetch deterministically threw 'invalid entity list'.
// The array is normalized into the entity_id-keyed map the catalog consumers
// expect (toHomeEntityCatalog iterates the map's keys); an empty array is a
// legal (empty) catalog, a non-array body or an entry without a valid
// entity_id is a contract violation.
export async function fetchHaEntityList(
  signal?: AbortSignal,
): Promise<Record<string, HaEntityState>> {
  const res = await haFetch('/states', {}, signal, CATALOG_TIMEOUT_MS)
  if (!res.ok) throw new Error(`home assistant ${res.status}`)
  const body = (await safeJson(res)) as unknown
  if (!Array.isArray(body)) {
    throw new Error('invalid entity list')
  }
  const map: Record<string, HaEntityState> = {}
  for (const entry of body) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.entity_id !== 'string' ||
      entry.entity_id.length === 0
    ) {
      throw new Error('invalid entity list')
    }
    map[entry.entity_id] = entry as HaEntityState
  }
  return map
}

// ticket 9.3: the activation service per controllable domain — scenes can
// only be turned ON (there is no "toggle" for them), everything else toggles
export const ENTITY_SERVICES: Record<string, string> = {
  light: 'toggle',
  switch: 'toggle',
  fan: 'toggle',
  scene: 'turn_on',
  cover: 'toggle',
  input_boolean: 'toggle',
  media_player: 'toggle',
}

// both path segments are interpolated into the URL — validate them so the URL
// space stays limited to [a-z_]+ (defensive, no injection)
const SERVICE_SEGMENT = /^[a-z_]+$/

// ticket 9.3: generic service call (POST /services/<domain>/<service>) —
// the daemon's generic /ha-api/ service proxy forwards the body verbatim
export function callHaService(
  domain: string,
  service: string,
  data: { entity_id: string },
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  if (!SERVICE_SEGMENT.test(domain) || !SERVICE_SEGMENT.test(service)) {
    throw new TypeError(`invalid HA service: ${domain}/${service}`)
  }
  return haFetch(
    `/services/${domain}/${service}`,
    { method: 'POST', body: JSON.stringify(data) },
    signal,
  ).then(async (res) => {
    if (!res.ok) throw new Error(`home assistant ${res.status}`)
    const body = (await safeJson(res)) as unknown
    return Array.isArray(body) ? (body as HaEntityState[]) : []
  })
}

// ticket 9.3: activate one catalog entry via its domain's service
export function activateHaEntity(
  entry: { entityId: string; domain: string },
  signal?: AbortSignal,
): Promise<HaEntityState[]> {
  const service = ENTITY_SERVICES[entry.domain]
  if (!service) throw new TypeError(`no activation service for domain: ${entry.domain}`)
  return callHaService(entry.domain, service, { entity_id: entry.entityId }, signal)
}
