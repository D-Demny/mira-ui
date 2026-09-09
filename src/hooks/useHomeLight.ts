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
// hook instance in sync, and a 3s poll re-syncs external changes (phone, wall
// switch, automation) so the badge never shows a stale on/off state.
// bug57 v2: 5000 → 3000. This store's only persistent consumer is the
// light-control popup (mounted = visible), so the poll is already gated on
// visibility by the mount/subscription below — like the useHomeEntities poll,
// it only runs while a consumer is actually on screen.
const POLL_MS = 3000

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
// bug57 v2: same in-flight-actuation tracking as useHomeEntities — a state
// read that starts while the toggle's service call is still pending races
// with the POST (HA can serve the pre-POST state) and may never land; only
// a read that starts after the settlement (or with no toggle pending) may
// land. The toggle's own resync read starts right after the settlement.
interface PendingToggle {
  seq: number
  settled: boolean
}
const pendingToggles = new Map<string, PendingToggle>()
const toggleSeqs = new Map<string, number>()

function nextToggleSeq(entityId: string): number {
  const seq = (toggleSeqs.get(entityId) ?? 0) + 1
  toggleSeqs.set(entityId, seq)
  return seq
}

function toggleSeq(entityId: string): number {
  return toggleSeqs.get(entityId) ?? 0
}

// bug57 v2: the toggle's service call just settled — bump the write revision
// (reads started before the settlement are stale by the v1 check as well)
// and mark it so a read started NOW (the resync) may land. No-op when a
// newer toggle owns the state.
function settleToggle(entityId: string, seq: number): void {
  if (toggleSeq(entityId) !== seq) return
  bumpWriteRevision(entityId)
  const pending = pendingToggles.get(entityId)
  if (pending !== undefined && pending.seq === seq) pending.settled = true
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
  // bug57 v2: a read that starts while a toggle's service call is still
  // pending may NEVER land — it races with the in-flight POST (see
  // `pendingToggles`). A read that starts after the settlement (or with no
  // toggle pending) may land, subject to the v1 revision check.
  const pending = pendingToggles.get(entityId)
  const startedAfterSettle = pending === undefined || pending.settled
  const promise = (async () => {
    try {
      const entity = await fetchHaEntityState(entityId)
      // stale read: a toggle write happened while the fetch was in flight —
      // that write owns the state, the fetched (older) state is discarded
      if (readRevision !== writeRevision(entityId)) return
      // bug57 v2: the read started while the toggle's service call was still
      // in flight — HA may have served the pre-POST state
      if (!startedAfterSettle) return
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
      if (!startedAfterSettle) return
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
  // bug57 v2: this toggle's sequence number. Its service answer (and its
  // error revert) are applied only if no NEWER toggle has since started —
  // defense in depth: the toggling guard above is the primary barrier
  // against interleaved toggles, the sequence check makes the answer path
  // safe on its own (a stale answer from a superseded toggle must never
  // clobber a newer flip).
  const mySeq = nextToggleSeq(entityId)
  pendingToggles.set(entityId, { seq: mySeq, settled: false })
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
      // the toggle service answers with the entity's new state — trust it,
      // but only if this answer belongs to the NEWEST toggle
      if (toggleSeq(entityId) !== mySeq) return
      settleToggle(entityId, mySeq)
      stores.set(entityId, { ...storeOf(entityId), state: toLightState(updated.state) })
    } else {
      // no entity in the service response — resync from the states endpoint
      // (settles first, the resync read starts after the settlement — the
      // bug57 + bug57 v2 guards let it land)
      if (toggleSeq(entityId) !== mySeq) return
      settleToggle(entityId, mySeq)
      await refresh(entityId, false)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to toggle light'
    console.warn('useHomeLight toggle error:', message)
    // a NEWER toggle owns the state — its writes (not this older toggle's
    // revert) decide; skip the revert entirely
    if (toggleSeq(entityId) !== mySeq) return
    // bug57: the revert is an actuation write — stale reads are discarded
    bumpWriteRevision(entityId)
    const current = storeOf(entityId)
    if (previous) stores.set(entityId, { ...current, state: previous })
    stores.set(entityId, { ...storeOf(entityId), error: message })
  } finally {
    // only the NEWEST toggle clears its own bookkeeping — a stale,
    // superseded toggle must not clear the newer one's flags
    if (toggleSeq(entityId) === mySeq) {
      pendingToggles.delete(entityId)
      // bug57: deliberately NO bump here — the resync read (missing entity
      // in the service answer) started before this write and must be
      // allowed to land. The toggle is fully settled now, so a loading flag
      // left behind by a discarded initial read is cleared with it
      stores.set(entityId, { ...storeOf(entityId), toggling: false, loading: false })
    }
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
  pendingToggles.clear()
  toggleSeqs.clear()
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
