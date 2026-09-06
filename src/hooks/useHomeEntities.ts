import { useCallback, useEffect, useState } from 'react'
import {
  activateHaEntity,
  entityActive,
  fetchHaEntityList,
  fetchHaEntityState,
  humanizeEntityLabel,
  lightCapabilities,
  toHomeEntityCatalog,
} from '@/api/homeassistant'
import type { HaEntityCatalogEntry } from '@/api/homeassistant'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'

// ticket 9.3: one view per selected HA entity — the Home carousel renders
// exactly these, in selection order. Same module-level store pattern as
// useHomeLight (shared across mounted hook instances + 5s polling).
export interface HomeEntityView {
  entityId: string
  domain: string
  label: string
  room?: string
  state: string | null
  loading: boolean
  error: string | null
  actuating: boolean
  active: boolean | null
  dimmable: boolean
  brightnessPct: number | null
  actuate: () => void
}

// ------------------------------------------------------------------ selection

// ticket 9.3: the carousel selection — an ordered array in insertion order
// (the order IS the carousel order), persisted device-locally in localStorage
// (no daemon sync — each device keeps its own carousel)
export const SELECTION_LS_KEY = 'mira.home.entitySelection.v1'

function defaultSelection(): string[] {
  return HOME_LIGHTS.map((light) => light.entityId)
}

// lazy load from localStorage: valid = a JSON array of non-empty strings
// (duplicates dropped). Corrupt or missing → the default (and the default is
// NOT persisted — the file should only ever contain an explicit user choice)
function loadSelection(): string[] {
  try {
    const raw = window.localStorage.getItem(SELECTION_LS_KEY)
    if (raw === null) return defaultSelection()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultSelection()
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of parsed) {
      if (typeof item !== 'string' || item.length === 0) return defaultSelection()
      if (!seen.has(item)) {
        seen.add(item)
        out.push(item)
      }
    }
    return out
  } catch {
    // corrupt JSON or a throwing localStorage (CR69 private mode) → default
    return defaultSelection()
  }
}

function persistSelection(ids: string[]) {
  try {
    window.localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(ids))
  } catch {
    // localStorage can throw in CR69 private mode — the in-memory selection
    // still works for this session
  }
}

let selection: string[] | null = null

function currentSelection(): string[] {
  if (selection === null) selection = loadSelection()
  return selection
}

function toggleSelection(entityId: string) {
  const current = currentSelection()
  const next = current.includes(entityId)
    ? current.filter((id) => id !== entityId)
    : [...current, entityId]
  selection = next
  persistSelection(next)
  emit()
}

function resetSelection() {
  selection = defaultSelection()
  persistSelection(selection)
  emit()
}

function isCustomizedSelection(ids: string[]): boolean {
  const def = defaultSelection()
  if (ids.length !== def.length) return true
  const defSet = new Set(def)
  for (const id of ids) {
    if (!defSet.has(id)) return true
  }
  return false
}

// ------------------------------------------------------------------- catalog

const CATALOG_TTL_MS = 60_000

interface CatalogStore {
  entries: HaEntityCatalogEntry[]
  loading: boolean
  error: string | null
  fetchedAt: number
}

const catalog: CatalogStore = { entries: [], loading: false, error: null, fetchedAt: 0 }
let catalogInFlight: Promise<void> | null = null

function fetchCatalog(force: boolean): Promise<void> {
  const fresh = catalog.fetchedAt > 0 && Date.now() - catalog.fetchedAt < CATALOG_TTL_MS
  if (!force && fresh) return Promise.resolve()
  if (catalogInFlight) return catalogInFlight
  catalog.loading = true
  emit()
  const promise = (async () => {
    try {
      const raw = await fetchHaEntityList()
      catalog.entries = toHomeEntityCatalog(raw)
      catalog.fetchedAt = Date.now()
      catalog.error = null
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load entity catalog'
      console.warn('useHomeEntities catalog error:', message)
      catalog.error = message
    } finally {
      catalog.loading = false
      catalogInFlight = null
      emit()
    }
  })()
  catalogInFlight = promise
  return promise
}

// --------------------------------------------------------- entity live states

const POLL_MS = 5000

interface EntityState {
  state: string | null
  loading: boolean
  error: string | null
  actuating: boolean
  attributes: Record<string, unknown> | null
}

const entityStates = new Map<string, EntityState>()
const inFlightStates = new Map<string, Promise<void>>()
// ids for which a refresh has been started — the state store alone is NOT a
// signal (stateOf() creates entries during render, before any fetch)
const knownEntities = new Set<string>()
let pollTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function stateOf(entityId: string): EntityState {
  let state = entityStates.get(entityId)
  if (!state) {
    state = { state: null, loading: true, error: null, actuating: false, attributes: null }
    entityStates.set(entityId, state)
  }
  return state
}

// the domain always comes from the entity id prefix — more reliable than the
// catalog while it is still loading
function domainOf(entityId: string): string {
  const dot = entityId.indexOf('.')
  return dot === -1 ? entityId : entityId.slice(0, dot)
}

function emit() {
  for (const listener of listeners) listener()
}

function refreshEntity(entityId: string, initial: boolean): Promise<void> {
  if (initial && !inFlightStates.has(entityId)) {
    // keep the last known state — the view re-syncs in the background
    entityStates.set(entityId, { ...stateOf(entityId), loading: true, error: null })
    emit()
  }
  const existing = inFlightStates.get(entityId)
  if (existing) return existing
  knownEntities.add(entityId)
  const promise = (async () => {
    try {
      const entity = await fetchHaEntityState(entityId)
      entityStates.set(entityId, {
        ...stateOf(entityId),
        state: entity.state,
        loading: false,
        error: null,
        attributes: entity.attributes ?? null,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reach Home Assistant'
      console.warn('useHomeEntities error:', message)
      entityStates.set(entityId, { ...stateOf(entityId), loading: false, error: message })
    } finally {
      inFlightStates.delete(entityId)
      emit()
    }
  })()
  inFlightStates.set(entityId, promise)
  return promise
}

// optimistic state flip per domain — `null` = no flip (the state is unknown
// yet, or the domain is stateless like scene)
function optimisticState(domain: string, previous: string | null): string | null {
  if (previous === null) return null
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return previous === 'on' ? 'off' : 'on'
    case 'cover':
      return previous === 'open' ? 'closed' : 'open'
    case 'media_player':
      return previous === 'playing' ? 'paused' : 'playing'
    default:
      return null
  }
}

async function actuateEntity(entityId: string) {
  const store = stateOf(entityId)
  if (store.actuating) return
  const domain = domainOf(entityId)
  const previous = store.state
  const flipped = optimisticState(domain, previous)
  entityStates.set(entityId, {
    ...store,
    actuating: true,
    error: null,
    ...(flipped !== null ? { state: flipped } : {}),
  })
  emit()
  try {
    if (domain === 'scene') {
      // scenes are stateless — the service answer is not trustworthy, so
      // resync from the states endpoint afterwards
      await activateHaEntity({ entityId, domain })
      await refreshEntity(entityId, false)
    } else {
      const updated = await activateHaEntity({ entityId, domain })
      const found = updated.find((s) => s.entity_id === entityId)
      if (found) {
        // the service answers with the entity's new state — trust it
        entityStates.set(entityId, {
          ...stateOf(entityId),
          state: found.state,
          attributes: found.attributes ?? null,
        })
      } else {
        // no entity in the service response — resync from the states endpoint
        await refreshEntity(entityId, false)
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to activate entity'
    console.warn('useHomeEntities actuate error:', message)
    if (previous !== null) {
      entityStates.set(entityId, { ...stateOf(entityId), state: previous })
    }
    entityStates.set(entityId, { ...stateOf(entityId), error: message })
  } finally {
    entityStates.set(entityId, { ...stateOf(entityId), actuating: false })
    emit()
  }
}

function startPolling() {
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      // only entities that some mounted hook knows about get polled
      for (const entityId of entityStates.keys()) void refreshEntity(entityId, false)
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

// ------------------------------------------------------------------------ meta

// curated HOME_LIGHTS labels (with room) win; otherwise the catalog's label
// (friendly_name or humanized); last resort: humanize the entity id
function homeEntityMeta(entityId: string): { label: string; room?: string } {
  const curated = HOME_LIGHTS.find((light) => light.entityId === entityId)
  if (curated) return { label: curated.label, room: curated.room }
  const entry = catalog.entries.find((e) => e.entityId === entityId)
  if (entry) return { label: entry.label }
  return { label: humanizeEntityLabel(entityId) }
}

// ----------------------------------------------------------------------- hooks

// ticket 9.3: the full catalog (Picker-UI data source) — fetches once on
// mount (TTL-gated), refetch forces a fresh fetch
export function useHomeEntityCatalog() {
  const [, setVersion] = useState(0)

  useEffect(() => {
    void fetchCatalog(false)
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  const refetch = useCallback(() => {
    void fetchCatalog(true)
  }, [])

  return {
    entries: catalog.entries,
    loading: catalog.loading,
    error: catalog.error,
    refetch,
  }
}

// ticket 9.3: the persisted carousel selection
export function useHomeEntitySelection() {
  const [, setVersion] = useState(0)

  useEffect(() => {
    currentSelection() // trigger the lazy localStorage load
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  const toggle = useCallback((entityId: string) => {
    toggleSelection(entityId)
  }, [])
  const reset = useCallback(() => {
    resetSelection()
  }, [])

  const selectedIds = currentSelection()
  return {
    selectedIds,
    isSelected: (entityId: string) => selectedIds.includes(entityId),
    toggle,
    reset,
    isCustomized: isCustomizedSelection(selectedIds),
  }
}

// ticket 9.3: the main hook — live views of the selected entities in
// selection order (the Home carousel renders exactly these)
export function useHomeSelectedEntities(): HomeEntityView[] {
  const [, setVersion] = useState(0)

  useEffect(() => {
    for (const entityId of currentSelection()) void refreshEntity(entityId, true)
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  // selection changes: fetch the newly added ids (the mount effect above
  // covers the initial set, this one reacts to toggles/reset)
  const selectionKey = currentSelection().join('\u0000')
  useEffect(() => {
    for (const entityId of currentSelection()) {
      if (!knownEntities.has(entityId)) void refreshEntity(entityId, true)
    }
  }, [selectionKey])

  return currentSelection().map((entityId) => {
    const state = stateOf(entityId)
    const domain = domainOf(entityId)
    const meta = homeEntityMeta(entityId)
    const caps =
      domain === 'light'
        ? lightCapabilities({
            entity_id: entityId,
            state: state.state ?? '',
            attributes: state.attributes ?? {},
          })
        : { dimmable: false, brightnessPct: null }
    return {
      entityId,
      domain,
      label: meta.label,
      room: meta.room,
      state: state.state,
      loading: state.loading,
      error: state.error,
      actuating: state.actuating,
      active: state.state === null ? null : entityActive(domain, state.state),
      dimmable: caps.dimmable,
      brightnessPct: caps.brightnessPct,
      actuate: () => void actuateEntity(entityId),
    }
  })
}

// test isolation — resets all shared stores (fresh module state per test)
export function __resetHomeEntityStores() {
  stopPolling()
  listeners.clear()
  inFlightStates.clear()
  knownEntities.clear()
  entityStates.clear()
  catalog.entries = []
  catalog.loading = false
  catalog.error = null
  catalog.fetchedAt = 0
  catalogInFlight = null
  selection = null
}

// test/debug introspection (like __homeLightStoreStats)
export function __homeEntityStoreStats() {
  return {
    selected: currentSelection().length,
    catalogEntries: catalog.entries.length,
    stateStores: entityStates.size,
  }
}
