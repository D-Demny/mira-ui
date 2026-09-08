import { useCallback, useEffect, useState } from 'react'
import { fetchHaEntityState, lightCapabilities, toggleHaEntity } from '@/api/homeassistant'

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

// ticket 9.3: lightCapabilities now lives in src/api/homeassistant.ts
// (pure HaEntityState knowledge — imported above)

// MainMenuView and HomeMenuView both render lights. A module-level store keyed
// by entity (same pattern as the usePlaylists/useRecent caches) keeps every
// hook instance in sync, and a 5s poll re-syncs external changes (phone, wall
// switch, automation) so the badge never shows a stale on/off state.
const POLL_MS = 5000

const stores = new Map<string, HomeLightStore>()
const listeners = new Set<() => void>()
const inFlight = new Map<string, Promise<void>>()
// bug57: same stale-read protection as useHomeEntities — a monotonic write
// revision per entity, bumped by every actuation write (optimistic flip,
// service answer, error revert). A read captures the revision at fetch
// start and only lands if no actuation write happened in the meantime, so
// a pre-toggle read can never clobber the optimistic flip, while reads
// that start after the last write (5 s poll, fresh mount, the resync inside
// toggle) keep mirroring external changes. Reads never bump (in-flight
// reads are deduped per entity) and the `toggling: false` write at the end
// of a toggle deliberately does NOT bump (the resync read started earlier
// must still be allowed to land).
const writeRevisions = new Map<string, number>()

function writeRevision(entityId: string): number {
  return writeRevisions.get(entityId) ?? 0
}

function bumpWriteRevision(entityId: string): void {
  writeRevisions.set(entityId, writeRevision(entityId) + 1)
}
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
  // bug57: the revision this read starts with — see `writeRevisions`
  const readRevision = writeRevision(entityId)
  const promise = (async () => {
    try {
      const entity = await fetchHaEntityState(entityId)
      // stale read: a toggle write happened while the fetch was in flight —
      // that write owns the state, the fetched (older) state is discarded
      if (readRevision !== writeRevision(entityId)) return
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
      // a failed STALE read reports nothing the user can act on
      if (readRevision !== writeRevision(entityId)) return
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
  // bug57: the toggle owns the state from here on — any read that started
  // earlier is stale from this point on
  bumpWriteRevision(entityId)
  stores.set(entityId, { ...store, toggling: true, error: null })
  if (previous) {
    // bug57: an actuation write — stale reads are discarded from here on
    bumpWriteRevision(entityId)
    stores.set(entityId, { ...storeOf(entityId), state: previous === 'on' ? 'off' : 'on' })
  }
  emit()
  try {
    const updated = await toggleHaEntity(entityId)
    if (updated) {
      // the toggle service answers with the entity's new state — trust it
      // bug57: an actuation write — stale reads are discarded from here on
      bumpWriteRevision(entityId)
      stores.set(entityId, { ...storeOf(entityId), state: toLightState(updated.state) })
    } else {
      // no entity in the service response — resync from the states endpoint
      // (its read starts AFTER the flip write above, so the bug57 guard
      // lets it land — the toggle's finally does not bump)
      await refresh(entityId, false)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle light'
    console.warn('useHomeLight toggle error:', message)
    // bug57: the revert is an actuation write — stale reads are discarded
    bumpWriteRevision(entityId)
    const current = storeOf(entityId)
    if (previous) stores.set(entityId, { ...current, state: previous })
    stores.set(entityId, { ...storeOf(entityId), error: message })
  } finally {
    // bug57: deliberately NO bump here — the resync read (missing entity in
    // the service answer) started before this write and must be allowed to
    // land. The toggle is fully settled now, so a loading flag left behind
    // by a discarded initial read is cleared with it
    stores.set(entityId, { ...storeOf(entityId), toggling: false, loading: false })
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
  writeRevisions.clear()
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
