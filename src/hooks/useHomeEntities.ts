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

// ticket 9.5: reorder the carousel — swap one selected entity with its
// neighbor in the given direction ('up' = earlier, 'down' = later). The
// position IS the carousel order, so the swap is the whole operation.
// Clamped at the boundaries and a no-op for unselected ids (no persist,
// no emit — nothing changed)
function moveSelection(entityId: string, dir: 'up' | 'down') {
  const current = currentSelection()
  const from = current.indexOf(entityId)
  if (from === -1) return
  const to = from + (dir === 'up' ? -1 : 1)
  if (to < 0 || to >= current.length) return
  const next = [...current]
  ;[next[from], next[to]] = [next[to], next[from]]
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

// bug57 v2: 5000 → 3000 — external changes (HA app / wall switch /
// automation) must show up within a few seconds. The poll is only active
// while the Home carousel is actually visible (see addPoller), so the
// tighter interval keeps the daemon traffic low.
const POLL_MS = 3000

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
// bug57: stale-read protection — a monotonic write revision per entity.
// Every actuation write (optimistic flip, service answer, error revert)
// bumps it. A state read captures the revision at fetch start and may only
// land if no actuation write happened in the meantime: a read that started
// before a press can no longer clobber the optimistic flip, while reads that
// start AFTER the last write (5 s poll, fresh mount, the resync inside
// actuateEntity) keep mirroring external changes (phone / wall switch /
// automation). Reads never bump (in-flight reads are deduped per entity, so
// they can never overlap), and the `actuating: false` write at the end of an
// actuation deliberately does NOT bump (the resync read started earlier must
// still be allowed to land).
const writeRevisions = new Map<string, number>()

function writeRevision(entityId: string): number {
  return writeRevisions.get(entityId) ?? 0
}

function bumpWriteRevision(entityId: string): void {
  writeRevisions.set(entityId, writeRevision(entityId) + 1)
}
// bug57 v2: the in-flight actuation per entity. A service call is only
// authoritative once it has SETTLED — HA has processed the POST and the
// answer is in. A state read that starts while the call is still pending
// races with the POST: HA can answer the GET with the PRE-POST state, and
// the bug57 v1 revision check cannot catch it (the read started AFTER the
// optimistic flip write) — it would clobber the flip with the
// pre-actuation state (Build #109 user report: rapid re-press, card
// 'An' → 'Aus' → 'An' → 'Aus'). So such a read may never land; only a read
// that starts after the settlement (or with no actuation pending at all)
// is allowed. The actuation's own resync read starts right after the
// settlement, so it keeps landing.
interface PendingActuation {
  seq: number
  settled: boolean
}
const pendingActuations = new Map<string, PendingActuation>()
const actuationSeqs = new Map<string, number>()

function nextActuationSeq(entityId: string): number {
  const seq = (actuationSeqs.get(entityId) ?? 0) + 1
  actuationSeqs.set(entityId, seq)
  return seq
}

function actuationSeq(entityId: string): number {
  return actuationSeqs.get(entityId) ?? 0
}

// bug57 v2: the actuation's service call just settled — bump the write
// revision (every read that started before the settlement is stale by the
// v1 check as well) and mark the actuation so a read started NOW (the
// resync) may land. No-op when a newer actuation owns the state.
function settleActuation(entityId: string, seq: number): void {
  if (actuationSeq(entityId) !== seq) return
  bumpWriteRevision(entityId)
  const pending = pendingActuations.get(entityId)
  if (pending !== undefined && pending.seq === seq) pending.settled = true
}
// bug57 v3: transition hold — after an optimistic flip, HA keeps reporting
// the PRE-flip state while the entity is still transitioning (lights fading
// off take ~0.5–1 s; Build #110: press 'Aus', the card flickers back to
// 'An'). A read or service answer whose value DIVERGES from the flipped
// target within TRANSITION_HOLD_MS of the flip is a transition intermediate
// state: it is discarded and a single confirming re-read (deduped per
// entity) is scheduled at the window's end, so the true post-transition
// state lands without waiting for the next 3 s poll. A value EQUAL to the
// target always lands — it confirms the flip and cancels a pending
// confirming re-read. Divergent values AFTER the window land normally: a
// genuine external change (wall switch / phone) is delayed by at most the
// hold, worst case poll 3 s + hold 1.5 s. The hold is set by an optimistic
// flip only (never by a read; no flip = no hold, e.g. scenes), error reverts
// clear it (the revert is authoritative), and the v1 (write revisions) +
// v2 (pending settle) guards run FIRST — the hold filters what survives them.
const TRANSITION_HOLD_MS = 1500

interface TransitionHold {
  target: string
  until: number
}
const transitionHolds = new Map<string, TransitionHold>()
const confirmTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearConfirmTimer(entityId: string): void {
  const timer = confirmTimers.get(entityId)
  if (timer !== undefined) {
    clearTimeout(timer)
    confirmTimers.delete(entityId)
  }
}

// bug57 v3: a NEW optimistic flip replaces any pending hold — the newer
// actuation owns the state, so the older one's confirming re-read is dropped
function setTransitionHold(entityId: string, target: string): void {
  clearConfirmTimer(entityId)
  transitionHolds.set(entityId, { target, until: Date.now() + TRANSITION_HOLD_MS })
}

// bug57 v3: clears hold + pending confirming re-read — the error revert is
// authoritative and no report may be filtered against a state the entity did
// not actually reach
function clearTransitionHold(entityId: string): void {
  transitionHolds.delete(entityId)
  clearConfirmTimer(entityId)
}

// bug57 v3: applies the transition hold to a value about to land (a read or
// a service answer). Returns true when the value must be DISCARDED
// (divergent within the hold window) — a confirming re-read is scheduled
// exactly once at the window's end. False = the value lands; an expired hold
// is dropped with it, and a value equal to the target cancels a pending
// confirming re-read (it already confirmed the flip).
function applyTransitionHold(entityId: string, value: string): boolean {
  const hold = transitionHolds.get(entityId)
  if (hold === undefined) return false
  const now = Date.now()
  if (now >= hold.until) {
    // the window is over — a divergent value is a genuine external change,
    // it lands normally; drop the expired hold (and its stale re-read)
    transitionHolds.delete(entityId)
    clearConfirmTimer(entityId)
    return false
  }
  if (value === hold.target) {
    // confirmation of the flipped state — nothing to hold back, and a
    // pending confirming re-read is now redundant
    clearConfirmTimer(entityId)
    return false
  }
  // divergent mid-fade report — discard it; schedule the confirming re-read
  // ONCE (deduped: an already-pending timer is kept as-is)
  if (confirmTimers.get(entityId) === undefined) {
    const timer = setTimeout(() => {
      confirmTimers.delete(entityId)
      // a plain state read — the v1/v2 guards still apply to it, and by the
      // time it lands the hold window is over, so its value always lands
      void refreshEntity(entityId, false)
    }, hold.until - now)
    confirmTimers.set(entityId, timer)
  }
  return true
}
let pollTimer: ReturnType<typeof setInterval> | null = null
// bug57 v2: polling is decoupled from subscription — it runs only while at
// least one hook instance has explicitly activated it (the Home carousel is
// actually visible). Ref-counted so two mounted instances (MainMenuView +
// HomeMenuView) do not double-start the interval.
let pollerCount = 0
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
  // bug57: the revision this read starts with — see `writeRevisions`
  const readRevision = writeRevision(entityId)
  // bug57 v2: a read that starts while an actuation's service call is still
  // pending may NEVER land — it races with the in-flight POST and HA can
  // answer with the pre-POST state (see `pendingActuations`). A read that
  // starts after the settlement (or with no actuation pending) may land,
  // subject to the v1 revision check.
  const pending = pendingActuations.get(entityId)
  const startedAfterSettle = pending === undefined || pending.settled
  const promise = (async () => {
    try {
      const entity = await fetchHaEntityState(entityId)
      // stale read: an actuation write happened while the fetch was in
      // flight — that write owns the state, the fetched (older) state is
      // discarded so it cannot clobber the optimistic flip
      if (readRevision !== writeRevision(entityId)) return
      // bug57 v2: the read started while the actuation's service call was
      // still in flight — HA may have served the pre-POST state
      if (!startedAfterSettle) return
      // bug57 v3: mid-fade report — see applyTransitionHold
      if (applyTransitionHold(entityId, entity.state)) return
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
      // a failed STALE read reports nothing the user can act on — the
      // newer actuation write owns the error state
      if (readRevision !== writeRevision(entityId)) return
      if (!startedAfterSettle) return
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
  // bug57 v2: this actuation's sequence number. Its service answer (and its
  // error revert) are applied only if no NEWER actuation has since started —
  // defense in depth: the actuating guard above is the primary barrier
  // against interleaved actuations, the sequence check makes the answer path
  // safe on its own (a stale answer from a superseded actuation must never
  // clobber a newer flip).
  const mySeq = nextActuationSeq(entityId)
  pendingActuations.set(entityId, { seq: mySeq, settled: false })
  // bug57: the actuation owns the state from here on — any read that started
  // earlier is stale from this point on
  bumpWriteRevision(entityId)
  entityStates.set(entityId, {
    ...store,
    actuating: true,
    error: null,
    ...(flipped !== null ? { state: flipped } : {}),
  })
  // bug57 v3: the entity now transitions toward `flipped` — HA keeps
  // reporting the pre-flip state during the fade (lights dimming off take
  // ~0.5–1 s, Build #110); hold divergent reports for TRANSITION_HOLD_MS
  if (flipped !== null) setTransitionHold(entityId, flipped)
  emit()
  try {
    if (domain === 'scene') {
      // scenes are stateless — the service answer is not trustworthy, so
      // resync from the states endpoint afterwards. The actuation settles
      // first, and the resync read starts AFTER the settlement, so the
      // bug57 + bug57 v2 guards let it land
      await activateHaEntity({ entityId, domain })
      settleActuation(entityId, mySeq)
      await refreshEntity(entityId, false)
    } else {
      const updated = await activateHaEntity({ entityId, domain })
      const found = updated.find((s) => s.entity_id === entityId)
      if (found) {
        // the service answers with the entity's new state — trust it, but
        // only if this answer belongs to the NEWEST actuation
        if (actuationSeq(entityId) !== mySeq) return
        settleActuation(entityId, mySeq)
        // bug57 v3: mid-fade report (HA still says the old state while the
        // entity transitions) — held back, a confirming re-read follows at
        // the window's end
        if (applyTransitionHold(entityId, found.state)) return
        entityStates.set(entityId, {
          ...stateOf(entityId),
          state: found.state,
          attributes: found.attributes ?? null,
        })
      } else {
        // no entity in the service response — resync from the states
        // endpoint (settles first, the resync read starts after the
        // settlement — the bug57 + bug57 v2 guards let it land)
        if (actuationSeq(entityId) !== mySeq) return
        settleActuation(entityId, mySeq)
        await refreshEntity(entityId, false)
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to activate entity'
    console.warn('useHomeEntities actuate error:', message)
    // a NEWER actuation owns the state — its writes (not this older
    // actuation's revert) decide; skip the revert entirely
    if (actuationSeq(entityId) !== mySeq) return
    // bug57 v3: the revert is authoritative — clear any mid-fade hold so no
    // report gets filtered against a flip that never happened
    clearTransitionHold(entityId)
    // bug57: the revert is an actuation write — stale reads are discarded
    bumpWriteRevision(entityId)
    if (previous !== null) {
      entityStates.set(entityId, { ...stateOf(entityId), state: previous })
    }
    entityStates.set(entityId, { ...stateOf(entityId), error: message })
  } finally {
    // only the NEWEST actuation clears its own bookkeeping — a stale,
    // superseded actuation must not clear the newer one's flags
    if (actuationSeq(entityId) === mySeq) {
      pendingActuations.delete(entityId)
      // bug57: deliberately NO bump here — the resync read (scene / missing
      // entity in the service answer) started before this write and must be
      // allowed to land. The actuation is fully settled now, so a loading
      // flag left behind by a discarded initial read is cleared with it
      entityStates.set(entityId, { ...stateOf(entityId), actuating: false, loading: false })
    }
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

function addPoller() {
  pollerCount += 1
  if (pollerCount === 1) startPolling()
}

function removePoller() {
  pollerCount = Math.max(0, pollerCount - 1)
  if (pollerCount === 0) stopPolling()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // bug57 v2: subscriptions no longer start the poll — only an explicit
  // addPoller (a visible Home carousel, see useHomeSelectedEntities) does.
  // The other menus (playlists, settings, ...) and the transient overlays
  // (picker, light control) generate no HA daemon traffic while mounted.
  return () => {
    listeners.delete(listener)
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
  // ticket 9.5: move a selected entity one step in the selection (carousel)
  // order — see moveSelection for the boundary/no-op semantics
  const move = useCallback((entityId: string, dir: 'up' | 'down') => {
    moveSelection(entityId, dir)
  }, [])
  const reset = useCallback(() => {
    resetSelection()
  }, [])

  const selectedIds = currentSelection()
  return {
    selectedIds,
    isSelected: (entityId: string) => selectedIds.includes(entityId),
    toggle,
    move,
    reset,
    isCustomized: isCustomizedSelection(selectedIds),
  }
}

// ticket 9.3: the main hook — live views of the selected entities in
// selection order (the Home carousel renders exactly these).
//
// bug57 v2: `pollActive` — the 3s poll runs only while the Home carousel is
// actually visible (the caller passes whether its Home view is on screen).
// On (re-)becoming visible an immediate fresh read for every selected entity
// is issued — no waiting for the first 3s tick. While hidden: no poll, no
// daemon traffic.
export function useHomeSelectedEntities(pollActive: boolean = false): HomeEntityView[] {
  const [, setVersion] = useState(0)

  useEffect(() => {
    for (const entityId of currentSelection()) void refreshEntity(entityId, true)
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  // bug57 v2: visibility-gated polling — see the hook comment above
  useEffect(() => {
    if (!pollActive) return
    for (const entityId of currentSelection()) void refreshEntity(entityId, false)
    addPoller()
    return () => {
      removePoller()
    }
  }, [pollActive])

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
  pollerCount = 0
  listeners.clear()
  inFlightStates.clear()
  knownEntities.clear()
  entityStates.clear()
  writeRevisions.clear()
  pendingActuations.clear()
  actuationSeqs.clear()
  // bug57 v3: transition holds + their confirming re-read timers
  for (const timer of confirmTimers.values()) clearTimeout(timer)
  confirmTimers.clear()
  transitionHolds.clear()
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
