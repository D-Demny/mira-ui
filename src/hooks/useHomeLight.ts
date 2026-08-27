import { useCallback, useEffect, useState } from 'react'
import { fetchHaEntityState, toggleHaEntity } from '@/api/homeassistant'
import type { HaEntityState } from '@/api/homeassistant'

export interface HomeLight {
  entityId: string
  label: string
  room: string
}

// all lights shown in the Home menu — order = menu order. The first entry is
// the "primary" light that the main menu card also controls.
export const HOME_LIGHTS: HomeLight[] = [
  { entityId: 'light.3er_stehlampe_gold_esszimmer', label: '3er Stehlampe Gold', room: 'Esszimmer' },
  { entityId: 'light.esstisch_hangelampe_3er', label: 'Esstisch Hängelampe', room: 'Esszimmer' },
  { entityId: 'light.3er_deko_esszimmer', label: '3er Deko', room: 'Esszimmer' },
  { entityId: 'light.kajplats_e27_ws_g60_clear_470lm', label: 'Stehlampe Gold', room: 'Wohnzimmer' },
  { entityId: 'light.kajplats_e14_ws_globe_806lm', label: 'Tischlampe', room: 'Gaderobe' },
  { entityId: 'light.gaderobe_lampe_3er', label: 'Lampe 3er', room: 'Gaderobe' },
  { entityId: 'light.kajplats_gu10_ws_575lm_3', label: 'Treppenspot Treppe', room: 'Flur Oben' },
  { entityId: 'light.kajplats_gu10_ws_575lm_5', label: 'Treppenspot Mitte', room: 'Flur Oben' },
  { entityId: 'light.kajplats_gu10_ws_575lm_6', label: 'Treppenspot Tür', room: 'Flur Oben' },
]

export const HOME_LIGHT_ENTITY_ID = HOME_LIGHTS[0].entityId
export const HOME_LIGHT_LABEL = HOME_LIGHTS[0].label

export type HomeLightState = 'on' | 'off'

interface HomeLightStore {
  state: HomeLightState | null
  loading: boolean
  error: string | null
  toggling: boolean
  // bug46: capability + current level from the entity's state attributes
  dimmable: boolean
  brightnessPct: number | null
}

export interface HomeLightView extends HomeLight {
  state: HomeLightState | null
  loading: boolean
  error: string | null
  toggling: boolean
  // bug46: true when supported_color_modes contains 'brightness' or
  // 'color_temp' — the main menu opens the control popup for these instead
  // of toggling; null while the light is off or the attribute is missing
  dimmable: boolean
  brightnessPct: number | null
  toggle: () => void
  refetch: () => void
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
function lightCapabilities(
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

// MainMenuView and HomeMenuView both render lights. A module-level store keyed
// by entity (same pattern as the usePlaylists/useRecent caches) keeps every
// hook instance in sync, and a 5s poll re-syncs external changes (phone, wall
// switch, automation) so the badge never shows a stale on/off state.
const POLL_MS = 5000

const stores = new Map<string, HomeLightStore>()
const listeners = new Set<() => void>()
const inFlight = new Map<string, Promise<void>>()
let pollTimer: ReturnType<typeof setInterval> | null = null

function storeOf(entityId: string): HomeLightStore {
  let store = stores.get(entityId)
  if (!store) {
    store = {
      state: null,
      loading: true,
      error: null,
      toggling: false,
      dimmable: false,
      brightnessPct: null,
    }
    stores.set(entityId, store)
  }
  return store
}

function toLightState(raw: string): HomeLightState {
  return raw === 'on' ? 'on' : 'off'
}

function emit() {
  for (const listener of listeners) listener()
}

function refresh(entityId: string, initial: boolean): Promise<void> {
  if (initial && !inFlight.has(entityId)) {
    // keep the last known state — the badge re-syncs in the background
    stores.set(entityId, { ...storeOf(entityId), loading: true, error: null })
    emit()
  }
  const existing = inFlight.get(entityId)
  if (existing) return existing
  const promise = (async () => {
    try {
      const entity = await fetchHaEntityState(entityId)
      const capabilities = lightCapabilities(entity)
      stores.set(entityId, {
        ...storeOf(entityId),
        state: toLightState(entity.state),
        loading: false,
        error: null,
        dimmable: capabilities.dimmable,
        brightnessPct: capabilities.brightnessPct,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reach Home Assistant'
      console.warn('useHomeLight error:', message)
      stores.set(entityId, { ...storeOf(entityId), loading: false, error: message })
    } finally {
      inFlight.delete(entityId)
      emit()
    }
  })()
  inFlight.set(entityId, promise)
  return promise
}

async function toggle(entityId: string) {
  const store = storeOf(entityId)
  if (store.toggling) return
  const previous = store.state
  stores.set(entityId, { ...store, toggling: true, error: null })
  if (previous) stores.set(entityId, { ...storeOf(entityId), state: previous === 'on' ? 'off' : 'on' })
  emit()
  try {
    const updated = await toggleHaEntity(entityId)
    if (updated) {
      // the toggle service answers with the entity's new state — trust it
      stores.set(entityId, { ...storeOf(entityId), state: toLightState(updated.state) })
    } else {
      // no entity in the service response — resync from the states endpoint
      await refresh(entityId, false)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle light'
    console.warn('useHomeLight toggle error:', message)
    const current = storeOf(entityId)
    if (previous) stores.set(entityId, { ...current, state: previous })
    stores.set(entityId, { ...storeOf(entityId), error: message })
  } finally {
    stores.set(entityId, { ...storeOf(entityId), toggling: false })
    emit()
  }
}

function startPolling() {
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      // only entities that some mounted hook knows about get polled
      for (const entityId of stores.keys()) void refresh(entityId, false)
    }, POLL_MS)
  }
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) startPolling()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopPolling()
  }
}

// test isolation — resets the shared store (fresh module state per test)
export function __resetHomeLightStore() {
  stopPolling()
  listeners.clear()
  inFlight.clear()
  stores.clear()
}

// test/debug introspection (bug45 option C: cache stats readout) — the store
// is bounded by HOME_LIGHTS, so the count alone documents the occupancy
export function __homeLightStoreStats() {
  return { entities: stores.size }
}

export function useHomeLight(entityId: string = HOME_LIGHT_ENTITY_ID) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    void refresh(entityId, true)
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [entityId])

  const toggleCb = useCallback(() => {
    void toggle(entityId)
  }, [entityId])
  const refetchCb = useCallback(() => {
    void refresh(entityId, false)
  }, [entityId])

  const store = storeOf(entityId)
  return {
    state: store.state,
    loading: store.loading,
    error: store.error,
    toggling: store.toggling,
    dimmable: store.dimmable,
    brightnessPct: store.brightnessPct,
    toggle: toggleCb,
    refetch: refetchCb,
  }
}

// every light in one hook — the Home menu renders one row per light. (Calling
// useHomeLight() once per light in a loop would trip rules-of-hooks.)
export function useHomeLights(): HomeLightView[] {
  const [, setVersion] = useState(0)

  useEffect(() => {
    for (const light of HOME_LIGHTS) void refresh(light.entityId, true)
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  return HOME_LIGHTS.map((light) => {
    const store = storeOf(light.entityId)
    return {
      ...light,
      state: store.state,
      loading: store.loading,
      error: store.error,
      toggling: store.toggling,
      dimmable: store.dimmable,
      brightnessPct: store.brightnessPct,
      toggle: () => void toggle(light.entityId),
      refetch: () => void refresh(light.entityId, false),
    }
  })
}
