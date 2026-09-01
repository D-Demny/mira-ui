import { useEffect, useState } from 'react'
import {
  fetchMiraServerCapabilities,
  standaloneMiraServerState,
  type MiraServerState,
} from '@/api/miraServer'

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
const listeners = new Set<() => void>()
let store: MiraServerView = { ...standaloneMiraServerState(), checking: false }
let inFlight: Promise<void> | null = null
let activeCount = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

function emit() {
  for (const listener of listeners) listener()
}

// One capabilities check. Concurrent callers (poll tick + manual re-check)
// share the in-flight request. Keeps the last known mode while the request
// is in flight so a slow re-poll never flashes the UI back to standalone.
async function check(): Promise<void> {
  if (inFlight) {
    await inFlight
    return
  }
  inFlight = (async () => {
    store = { ...store, checking: true }
    emit()
    try {
      const state = await fetchMiraServerCapabilities()
      store = { ...state, checking: false }
    } catch (err) {
      // Pi offline (or slow / broken) — degrade to standalone
      const message = err instanceof Error ? err.message : 'mira server unreachable'
      console.warn('useMiraServer error:', message)
      store = { ...standaloneMiraServerState(), checking: false }
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
      void check()
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
    void check()
    startPolling()
  }
  return () => {
    listeners.delete(listener)
    activeCount -= 1
    if (activeCount === 0) stopPolling()
  }
}

// Test isolation — resets the shared store (fresh module state per test)
export function __resetMiraServerState() {
  stopPolling()
  listeners.clear()
  activeCount = 0
  inFlight = null
  store = { ...standaloneMiraServerState(), checking: false }
}

// Manual re-check (e.g. the settings UI's "re-check" button, epic10 §4)
export function checkMiraServer(): Promise<void> {
  return check()
}

// Shared global state for the Pi helper server (epic10 §1). Subscribing
// starts detection on first use and re-polls every MIRA_SERVER_POLL_MS.
export function useMiraServer(): MiraServerView {
  const [, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribe(() => setVersion((v) => v + 1))
    return unsubscribe
  }, [])

  return { mode: store.mode, features: store.features, checking: store.checking }
}
