import { useSyncExternalStore } from 'react'
import { API_BASE } from '@/config'
import type { PresetConfig } from '@/presets'

// preferences for volume, offset, brightness store
// settings are all given by the daemon

export interface Settings {
  showLyrics: boolean
  lyricOffsetMs: number
  volumeStepPct: number
  autoBrightness: boolean
  brightness: number
  presets: Record<number, PresetConfig>
}

export const VOLUME_STEP_MIN = 1
export const VOLUME_STEP_MAX = 10
export const BRIGHTNESS_MIN = 1
export const BRIGHTNESS_MAX = 10

const SCHEMA_VERSION = 1
const LS_KEY = 'thing.settings.v1'
const PUT_DEBOUNCE_MS = 400

const DEFAULTS: Settings = {
  showLyrics: true,
  lyricOffsetMs: 0,
  volumeStepPct: 2,
  autoBrightness: true,
  brightness: 5,
  presets: {},
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function coerce(partial: Partial<Settings> | null | undefined): Settings {
  return {
    showLyrics: partial?.showLyrics ?? DEFAULTS.showLyrics,
    lyricOffsetMs: partial?.lyricOffsetMs ?? DEFAULTS.lyricOffsetMs,
    volumeStepPct: clamp(
      partial?.volumeStepPct ?? DEFAULTS.volumeStepPct,
      VOLUME_STEP_MIN,
      VOLUME_STEP_MAX,
    ),
    autoBrightness: partial?.autoBrightness ?? DEFAULTS.autoBrightness,
    brightness: clamp(partial?.brightness ?? DEFAULTS.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX),
    presets: partial?.presets ?? {},
  }
}

function readLocal(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return coerce(JSON.parse(raw) as Partial<Settings>)
  } catch {
    // ignore
  }
  return coerce(null)
}

let current: Settings = readLocal()

const listeners = new Set<() => void>()
function emit(): void {
  for (const l of listeners) l()
}

function writeLocal(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
}

let putTimer = 0
function schedulePut(): void {
  window.clearTimeout(putTimer)
  putTimer = window.setTimeout(() => void putSettings(current), PUT_DEBOUNCE_MS)
}

async function putSettings(s: Settings): Promise<void> {
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: SCHEMA_VERSION, ...s }),
    })
  } catch {
    // offline/daemon busy
  }
}

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  writeLocal()
  emit()
  schedulePut()
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

// check with the daemon once at startup
let initialized = false
export async function initSettings(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const res = await fetch(`${API_BASE}/settings`)
    if (!res.ok) return
    const data = (await res.json()) as (Partial<Settings> & { v?: number }) | null
    if (data && typeof data.v === 'number') {
      current = coerce(data)
      writeLocal()
      emit()
    } else {
      // daemon never seeded
      void putSettings(current)
    }
  } catch {
    // offline
  }
}

// test-only
export function __resetSettings(): void {
  initialized = false
  current = readLocal()
  emit()
}
