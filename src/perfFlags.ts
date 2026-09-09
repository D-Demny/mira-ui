// PERF-A/B (temp) — Bug58 dial-scroll experiments (debug/fps-bug58 only, never
// merged into main): four runtime-togglable perf flags measured via the FpsOverlay
// chips. The whole module is temporary — strip this file plus every
// `PERF-A/B (temp)` marker when the branch is deleted.
//
// Persistence: localStorage key 'mira.perf.debug' (JSON object of booleans).
// Initial values come from the URL query
// `?perf=lowres-art,static-bg,comp-scroll,anim-carousel` (listed flags start ON,
// the rest keep their stored value) when present, else from localStorage, else
// all off. Seeded ONCE at module import — no explicit init call needed (same
// shape as settings.ts: synchronous read at module init).
import { useSyncExternalStore } from 'react'

export type PerfFlagName = 'lowresArt' | 'staticBg' | 'compScroll' | 'animCarousel'

export interface PerfFlags {
  // A: downsize i.scdn.co 640px artwork urls to the 300px variant in the menu
  lowresArt: boolean
  // S: freeze the ambient --menu-bg/--menu-glow-* css vars while dialing
  staticBg: boolean
  // C: force-composite the carousel scroll port (translateZ + will-change)
  compScroll: boolean
  // N: browser-side smooth scroll for the arithmetic dial scrollLeft writes
  //    (.animCarousel { scroll-behavior: smooth }) — no JS loop; CR69-safe
  //    (scroll-behavior since Chrome 61)
  animCarousel: boolean
}

const LS_KEY = 'mira.perf.debug'
const URL_PARAM = 'perf'
// wire names (URL query) → store keys
const WIRE_NAMES: Record<string, PerfFlagName> = {
  'lowres-art': 'lowresArt',
  'static-bg': 'staticBg',
  'comp-scroll': 'compScroll',
  'anim-carousel': 'animCarousel',
}

function readInitial(): PerfFlags {
  const flags: PerfFlags = {
    lowresArt: false,
    staticBg: false,
    compScroll: false,
    animCarousel: false,
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(flags) as PerfFlagName[]) {
          const value = (parsed as Record<string, unknown>)[key]
          if (typeof value === 'boolean') flags[key] = value
        }
      }
    }
  } catch {
    // corrupted/absent blob → defaults
  }
  try {
    const listed = new URLSearchParams(window.location.search).get(URL_PARAM)
    if (listed) {
      for (const part of listed.split(',')) {
        const key = WIRE_NAMES[part.trim()]
        if (key) flags[key] = true
      }
    }
  } catch {
    // no location (unit tests) → stored/defaults stand
  }
  return flags
}

// stable identity while the values are unchanged — useSyncExternalStore
// compares snapshots by reference (same pattern as uiScale.ts / settings.ts)
let current: PerfFlags = readInitial()
const listeners = new Set<() => void>()

export function subscribePerfFlags(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getPerfFlags(): PerfFlags {
  return current
}

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(current))
  } catch {
    // storage full/blocked — flags stay volatile in-session
  }
}

export function setPerfFlag(name: PerfFlagName, value: boolean): void {
  if (current[name] === value) return
  current = { ...current, [name]: value }
  persist()
  for (const cb of listeners) cb()
}

export function togglePerfFlag(name: PerfFlagName): void {
  setPerfFlag(name, !current[name])
}

// test-only escape hatch (same shape as settings.__resetSettings / warmedArt's
// __resetWarmedArt): re-seed the store from localStorage + URL — needed because
// the module state survives across tests in one file while each test expects a
// fresh seed
export function __resetPerfFlags(): void {
  current = readInitial()
}

// components that only care about the flags re-render when a flag flips
export function usePerfFlags(): PerfFlags {
  return useSyncExternalStore(subscribePerfFlags, getPerfFlags)
}
