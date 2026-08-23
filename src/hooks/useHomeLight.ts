import { useCallback, useEffect, useState } from 'react'
import { fetchHaEntityState, toggleHaEntity } from '@/api/homeassistant'

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
]

export const HOME_LIGHT_ENTITY_ID = HOME_LIGHTS[0].entityId
export const HOME_LIGHT_LABEL = HOME_LIGHTS[0].label

export type HomeLightState = 'on' | 'off'

interface HomeLightStore {
  state: HomeLightState | null
  loading: boolean
  error: string | null
  toggling: boolean
}

export interface HomeLightView extends HomeLight {
  state: HomeLightState | null
  loading: boolean
  error: string | null
  toggling: boolean
  toggle: () => void
  refetch: () => void
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
    store = { state: null, loading: true, error: null, toggling: false }
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
      stores.set(entityId, {
        ...storeOf(entityId),
        state: toLightState(entity.state),
        loading: false,
        error: null,
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
      toggle: () => void toggle(light.entityId),
      refetch: () => void refresh(light.entityId, false),
    }
  })
}
