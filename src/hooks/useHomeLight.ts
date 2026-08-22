import { useCallback, useEffect, useState } from 'react'
import { fetchHaEntityState, toggleHaEntity } from '@/api/homeassistant'

export const HOME_LIGHT_ENTITY_ID = 'light.3er_stehlampe_gold_esszimmer'
export const HOME_LIGHT_LABEL = '3er Stehlampe Gold'

export type HomeLightState = 'on' | 'off'

// MainMenuView and HomeMenuView both render the light. A module-level store
// (same pattern as the usePlaylists/useRecent caches) keeps every hook
// instance in sync, and a 5s poll re-syncs external changes (phone, wall
// switch, automation) so the badge never shows a stale on/off state.
const POLL_MS = 5000

interface HomeLightStore {
  state: HomeLightState | null
  loading: boolean
  error: string | null
  toggling: boolean
}

let store: HomeLightStore = { state: null, loading: true, error: null, toggling: false }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function toLightState(raw: string): HomeLightState {
  return raw === 'on' ? 'on' : 'off'
}

function emit() {
  for (const listener of listeners) listener()
}

function refresh(initial: boolean): Promise<void> {
  if (initial && !inFlight) {
    store = { ...store, loading: true, error: null }
    emit()
  }
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const entity = await fetchHaEntityState(HOME_LIGHT_ENTITY_ID)
      store = { ...store, state: toLightState(entity.state), loading: false, error: null }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reach Home Assistant'
      console.warn('useHomeLight error:', message)
      store = { ...store, loading: false, error: message }
    } finally {
      inFlight = null
      emit()
    }
  })()
  return inFlight
}

function startPolling() {
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      void refresh(false)
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
  if (listeners.size === 1) {
    void refresh(true)
    startPolling()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopPolling()
  }
}

async function toggle() {
  if (store.toggling) return
  const previous = store.state
  store = { ...store, toggling: true, error: null }
  if (previous) store = { ...store, state: previous === 'on' ? 'off' : 'on' }
  emit()
  try {
    const updated = await toggleHaEntity(HOME_LIGHT_ENTITY_ID)
    if (updated) {
      // the toggle service answers with the entity's new state — trust it
      store = { ...store, state: toLightState(updated.state) }
    } else {
      // no entity in the service response — resync from the states endpoint
      await refresh(false)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle light'
    console.warn('useHomeLight toggle error:', message)
    if (previous) store = { ...store, state: previous }
    store = { ...store, error: message }
  } finally {
    store = { ...store, toggling: false }
    emit()
  }
}

// test isolation — resets the shared store (fresh module state per test)
export function __resetHomeLightStore() {
  stopPolling()
  listeners.clear()
  inFlight = null
  store = { state: null, loading: true, error: null, toggling: false }
}

export function useHomeLight() {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  const toggleCb = useCallback(() => {
    void toggle()
  }, [])
  const refetchCb = useCallback(() => {
    void refresh(false)
  }, [])

  return {
    state: store.state,
    loading: store.loading,
    error: store.error,
    toggling: store.toggling,
    toggle: toggleCb,
    refetch: refetchCb,
  }
}
