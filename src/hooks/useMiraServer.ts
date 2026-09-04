import { useEffect, useState } from 'react'
import {
  capabilitiesBaseUrl,
  fetchMiraServerCapabilities,
  standaloneMiraServerState,
  type MiraServerState,
} from '@/api/miraServer'
import { activePiProfile, getSettings, subscribeSettings, updateSettings } from '@/settings'

// Epic 10 — re-poll interval for Pi helper-server detection. A Pi that is
// connected later (or back after a power loss) is picked up within one
// tick; a Pi that goes away degrades to standalone within one tick.
export const MIRA_SERVER_POLL_MS = 30000

// What the hook hands to components: the shared state plus whether a
// capabilities request is currently in flight.
export interface MiraServerView extends MiraServerState {
  checking: boolean
}

// MainMenuView (and later the settings UI) subscribe via useMiraServer.
// The first subscriber starts the detection poll, the last one stops it,
// so the 30s interval only runs while a consumer is mounted. The single
// module-level store keeps every hook instance in sync (same pattern as
// useHomeLight / the usePlaylists caches).
//
// ticket10-5A — active-profile targeting: the poll targets the ip of the
// ACTIVE Pi profile in the settings store (there is no hard-coded default
// address anymore). While no profile is configured the hook stays in
// standalone mode WITHOUT polling. A profile switch (or removal) re-targets
// immediately: the new address gets its own ping, and a background check
// that settles for an OLDER ip must not overwrite the new target's state
// (the inFlightBase settle pattern from epic10 task 4, extended with the
// targetIp staleness guard below).
const listeners = new Set<() => void>()
let store: MiraServerView = { ...standaloneMiraServerState(), checking: false }
let inFlight: Promise<void> | null = null
// the base url the in-flight request targets — a manual re-check for a
// different address must not join it (epic10 task 4), or the settings UI
// would report the default address' result for the entered ip
let inFlightBase: string | null = null
// ticket10-5A: the ip the current store state reflects (null = standalone,
// no active profile). A background check that settles after the target has
// moved on is stale and must not publish its result.
let targetIp: string | null = null
let activeCount = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let settingsUnsubscribe: (() => void) | null = null

function emit() {
  for (const listener of listeners) listener()
}

// One capabilities check. Concurrent callers (poll tick + manual re-check)
// share the in-flight request when they target the same address. Keeps the
// last known mode while the request is in flight so a slow re-poll never
// flashes the UI back to standalone.
// `manual` (ticket10-5A) marks the explicit re-check from the settings UI
// (checkMiraServer): it always publishes its result, even if the active
// profile moved in the meantime. Background checks only publish while their
// ip is still the current target.
async function check(ip: string, manual: boolean): Promise<void> {
  const base = capabilitiesBaseUrl(ip)
  if (inFlight) {
    const joins = inFlightBase === base
    await inFlight
    if (joins) return
  }
  inFlightBase = base
  inFlight = (async () => {
    store = { ...store, checking: true }
    emit()
    let state: MiraServerState
    try {
      state = await fetchMiraServerCapabilities(ip)
    } catch (err) {
      // Pi offline (or slow / broken) — degrade to standalone
      const message = err instanceof Error ? err.message : 'mira server unreachable'
      console.warn('useMiraServer error:', message)
      state = standaloneMiraServerState()
    }
    inFlight = null
    inFlightBase = null
    const stale = !manual && targetIp !== ip
    store = stale ? { ...store, checking: false } : { ...state, checking: false }
    emit()
  })()
  return inFlight
}

// ticket10-7 KR4: the profile count the last retarget saw. While
// hybridDisabled is set the hook is behaviourally identical to "no profile"
// (standalone store with all features false — remoteArtUrl/Colors fall back
// to CDN/local immediately — and NO capability poll, even if profiles
// exist: defence in depth, the Deaktivieren flow deletes the profiles in
// the same write, but a leftover profile must not resurrect the poll).
//
// The flag clears ONLY when a profile is created while it is set — a
// profile count GROWTH observed here. Design decision (ticket10-7, vs. the
// four UI handlers proposed by audit block (f)): the clear lives in the ONE
// place that sees every creation path (wizard mount, "Profil hinzufügen",
// setup materialisation, lazy keyboard creation, any future one) instead of
// being repeated in four handlers; a mere coexistence of flag + existing
// profiles is not a creation and must NOT clear, so the disabled end state
// stays stable across settings writes and remounts. The clearing write
// re-enters retarget synchronously via the settings emit; the second run
// sees the flag already false and performs no write, so the loop terminates
// after exactly one settings write (the 400ms PUT debounce coalesces it
// with the user's profile write into a single daemon PUT).
let lastProfileCount = 0

// ticket10-5A: point the poll (and the store) at the active profile's ip —
// or drop to standalone without polling when the list is empty. Called on
// (re)subscribe and on every settings change while a subscriber exists.
function retarget(): void {
  const settings = getSettings()
  const profileCount = settings.piProfiles.length
  if (settings.hybridDisabled) {
    if (profileCount > lastProfileCount) {
      // a profile was created while hybrid was disabled — an explicit
      // re-opt-in: clear the flag and let the re-entered retarget take
      // the normal profile path (poll + immediate check)
      lastProfileCount = profileCount
      updateSettings({ hybridDisabled: false })
      return
    }
    // exactly the no-profile state — idempotent, emits only on change
    if (targetIp !== null) {
      targetIp = null
      stopPolling()
      store = { ...standaloneMiraServerState(), checking: false }
      emit()
    }
    lastProfileCount = profileCount
    return
  }
  const profile = activePiProfile(settings)
  const ip = profile ? profile.ip : null
  if (ip !== targetIp) {
    targetIp = ip
    if (ip === null) {
      stopPolling()
      store = { ...standaloneMiraServerState(), checking: false }
      emit()
    } else {
      startPolling()
      void check(ip, false)
    }
  }
  lastProfileCount = profileCount
}

function startPolling() {
  if (pollTimer === null) {
    pollTimer = setInterval(() => {
      if (targetIp !== null) void check(targetIp, false)
    }, MIRA_SERVER_POLL_MS)
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
  activeCount += 1
  if (activeCount === 1) {
    // track the active profile for the lifetime of the subscription — a
    // profile switch in the settings view re-targets the poll immediately
    settingsUnsubscribe = subscribeSettings(() => retarget())
    retarget()
  }
  return () => {
    listeners.delete(listener)
    activeCount -= 1
    if (activeCount === 0) {
      stopPolling()
      if (settingsUnsubscribe) {
        settingsUnsubscribe()
        settingsUnsubscribe = null
      }
    }
  }
}

// Test isolation — resets the shared store (fresh module state per test)
export function __resetMiraServerState() {
  stopPolling()
  if (settingsUnsubscribe) {
    settingsUnsubscribe()
    settingsUnsubscribe = null
  }
  listeners.clear()
  activeCount = 0
  inFlight = null
  inFlightBase = null
  targetIp = null
  lastProfileCount = 0
  store = { ...standaloneMiraServerState(), checking: false }
}

// Manual re-check (the settings UI's "Verbindung testen", epic10 §4).
// `ip` pings the Pi at an explicit address — the settings UI passes the
// ip of the profile it is showing (the active profile, or the ticket
// defaults while no profile exists yet).
// ticket10-7 KR4: allowed while hybridDisabled is set — it is a deliberate
// user action — and its result is published to the shared store like any
// manual check. The capability poll stays stopped either way: targetIp (and
// thus the poll) is untouched, and the next settings change retargets back
// to standalone while the flag is set.
export function checkMiraServer(ip: string): Promise<void> {
  return check(ip, true)
}

// Synchronous read of the shared state (e.g. the settings UI shows the
// result of a just-finished re-check; the hook covers reactive consumers)
export function getMiraServerState(): MiraServerView {
  return { mode: store.mode, features: store.features, checking: store.checking }
}

// Shared global state for the Pi helper server (epic10 §1, ticket10-5A).
// Subscribing targets the active Pi profile (standalone without polling
// while the profile list is empty) and re-polls every MIRA_SERVER_POLL_MS.
export function useMiraServer(): MiraServerView {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  return { mode: store.mode, features: store.features, checking: store.checking }
}
