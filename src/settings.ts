import { useSyncExternalStore } from 'react'
import { API_BASE } from '@/config'
import type { PresetConfig } from '@/presets'

// preferences for volume, offset, brightness store
// settings are all given by the daemon

// epic10 ticket10-5A: one stored Raspberry Pi = one profile. The list holds
// any number of Pis; the ACTIVE profile decides which Pi the capabilities
// poll and the /img/ routes target (the hard-coded 192.168.7.1 default of
// the old flat piServer entry is gone — see src/api/miraServer.ts).
// Persisted with the rest of the settings (localStorage + the daemon's
// opaque settings blob). The password stays per profile (needed for the
// sshpass fallback / a wizard re-run) and is stored in plain text —
// documented open point, see the PiServerModal.
export interface PiProfile {
  id: string
  label: string
  ip: string
  user: string
  password: string
  keyInstalled: boolean
}

export interface Settings {
  showLyrics: boolean
  karaokeLyrics: boolean
  lyricOffsetMs: number
  volumeStepPct: number
  autoBrightness: boolean
  brightness: number
  voiceMic: boolean
  uiScalePct: number
  presets: Record<number, PresetConfig>
  defaultDeviceId: string | null
  piProfiles: PiProfile[]
  activePiId: string | null
}

export const VOLUME_STEP_MIN = 1
export const VOLUME_STEP_MAX = 10
export const BRIGHTNESS_MIN = 1
export const BRIGHTNESS_MAX = 10
export const UI_SCALE_MIN = 85
export const UI_SCALE_MAX = 115
export const UI_SCALE_STEP = 5
export const UI_SCALE_DEFAULT = 100

// ticket10-5A: the daemon settings blob changed shape (flat piServer entry →
// piProfiles list + activePiId). The version is part of the blob the daemon
// stores opaquely; initSettings only requires a numeric v, so an old build
// reading a v2 blob degrades to the flat defaults (no crash).
const SCHEMA_VERSION = 2
// NOTE (ticket10-5A): the localStorage key stays at v1 ON PURPOSE — the
// one-time migration of the legacy piServer entry must still find the old
// blob. A key bump would skip the migration and lose the stored credentials.
const LS_KEY = 'mira.settings.v1'
const PUT_DEBOUNCE_MS = 400

// epic10: the Pi helper-server defaults — the Pi sits behind the USB-Ethernet
// gateway at 192.168.7.1. With the profile model there is no longer a
// default profile (fresh install = empty list, ticket10-5A); these values
// only seed a lazily created profile 1 (see updateActivePiProfileField) and
// serve as the migration's "is this a real legacy config?" reference.
export const PI_SERVER_DEFAULT_IP = '192.168.7.1'
export const PI_SERVER_DEFAULT_USER = 'root'

// the migrated legacy profile always becomes profile 1 (stable id, the
// follow-up workers' per-profile key storage keys on it — ticket10-5B)
const MIGRATED_PROFILE_ID = 'pi-1'

const DEFAULTS: Settings = {
  showLyrics: true,
  karaokeLyrics: true,
  lyricOffsetMs: 0,
  volumeStepPct: 2,
  autoBrightness: true,
  brightness: 5,
  voiceMic: true,
  uiScalePct: UI_SCALE_DEFAULT,
  presets: {},
  defaultDeviceId: null,
  piProfiles: [],
  activePiId: null,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// the ui scale feeds arithmetic that ends up as a css length, and initSettings replaces
// the store wholesale from the daemon's opaque blob. a NaN here would render as "NaNpx"
// and take the lyrics drag math with it, so reject anything non-finite and snap to a notch
function coerceUiScale(raw: unknown): number {
  // Number(null) and Number('') are both 0, which would silently clamp to the minimum
  // rather than fall back, so only numbers and non-blank numeric strings get through
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULTS.uiScalePct
  return clamp(Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP, UI_SCALE_MIN, UI_SCALE_MAX)
}

// the legacy flat entry (epic10 task 4) — coercion is unchanged from the
// pre-profile shape (ip/user trimmed, password verbatim); used only to
// evaluate the one-time migration below
interface LegacyPiServerConfig {
  ip: string
  user: string
  password: string
}

function coercePiServer(raw: unknown): LegacyPiServerConfig {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<LegacyPiServerConfig>
  const ip =
    typeof obj.ip === 'string' && obj.ip.trim() !== '' ? obj.ip.trim() : PI_SERVER_DEFAULT_IP
  const user = typeof obj.user === 'string' ? obj.user.trim() : PI_SERVER_DEFAULT_USER
  const password = typeof obj.password === 'string' ? obj.password : ''
  return { ip, user, password }
}

// one profile entry of a hand-edited blob. A profile without a usable ip is
// useless (the base url is built from it) and dropped; ip/user are trimmed,
// the password is kept verbatim (same pattern as coercePiServer); label and
// id fall back to the position-based "Pi N" / "pi-N" names
function coercePiProfile(raw: unknown, index: number): PiProfile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Partial<PiProfile>
  const ip = typeof obj.ip === 'string' ? obj.ip.trim() : ''
  if (ip === '') return null
  const user = typeof obj.user === 'string' && obj.user.trim() !== '' ? obj.user.trim() : PI_SERVER_DEFAULT_USER
  return {
    id: typeof obj.id === 'string' && obj.id.trim() !== '' ? obj.id.trim() : `pi-${index + 1}`,
    label:
      typeof obj.label === 'string' && obj.label.trim() !== '' ? obj.label.trim() : `Pi ${index + 1}`,
    ip,
    user,
    password: typeof obj.password === 'string' ? obj.password : '',
    keyInstalled: obj.keyInstalled === true,
  }
}

// ticket10-5A migration + coercion. Exactly ONE of the two input shapes is
// acted on:
//   1. new shape (piProfiles present, even empty) → coerce in place. An
//      empty array is the deliberate fresh-install state (design decision:
//      no synthetic default profile — the follow-up worker's list UI shows
//      "kein Pi konfiguriert").
//   2. legacy shape (flat piServer, no piProfiles) → migrate ONCE into
//      profile 1 when the entry carries more than the ticket defaults
//      (a pure-defaults blob is indistinguishable from a fresh install and
//      migrates to nothing — no data is lost, it only ever held defaults).
// Idempotent: after the first load the persisted blob has shape 1 (and no
// piServer key anymore), so a second load never migrates again. The
// parameter carries the optional legacy `piServer` key on purpose — a raw
// blob from localStorage / the daemon predating this change still has it.
function coercePiProfiles(
  partial: (Partial<Settings> & { piServer?: unknown }) | null | undefined,
): PiProfile[] {
  const raw = partial?.piProfiles
  if (Array.isArray(raw)) {
    const profiles: PiProfile[] = []
    const seenIds = new Set<string>()
    raw.forEach((entry, index) => {
      const profile = coercePiProfile(entry, index)
      if (!profile || seenIds.has(profile.id)) return
      seenIds.add(profile.id)
      profiles.push(profile)
    })
    return profiles
  }
  const legacy = coercePiServer(partial?.piServer)
  const isDefault =
    legacy.ip === PI_SERVER_DEFAULT_IP &&
    legacy.user === PI_SERVER_DEFAULT_USER &&
    legacy.password === ''
  if (isDefault) return []
  return [
    {
      id: MIGRATED_PROFILE_ID,
      label: 'Pi 1',
      ip: legacy.ip,
      user: legacy.user,
      password: legacy.password,
      keyInstalled: false,
    },
  ]
}

// a stale active id (hand-edited blob, or the profile was deleted) falls
// back to the first profile; an empty list has no active profile
function coerceActivePiId(profiles: PiProfile[], raw: unknown): string | null {
  if (profiles.length === 0) return null
  if (typeof raw === 'string' && profiles.some((p) => p.id === raw)) return raw
  return profiles[0].id
}

function coerce(partial: Partial<Settings> | null | undefined): Settings {
  const piProfiles = coercePiProfiles(partial)
  return {
    showLyrics: partial?.showLyrics ?? DEFAULTS.showLyrics,
    karaokeLyrics: partial?.karaokeLyrics ?? DEFAULTS.karaokeLyrics,
    lyricOffsetMs: partial?.lyricOffsetMs ?? DEFAULTS.lyricOffsetMs,
    volumeStepPct: clamp(
      partial?.volumeStepPct ?? DEFAULTS.volumeStepPct,
      VOLUME_STEP_MIN,
      VOLUME_STEP_MAX,
    ),
    autoBrightness: partial?.autoBrightness ?? DEFAULTS.autoBrightness,
    brightness: clamp(partial?.brightness ?? DEFAULTS.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX),
    voiceMic: partial?.voiceMic ?? DEFAULTS.voiceMic,
    uiScalePct: coerceUiScale(partial?.uiScalePct),
    presets: partial?.presets ?? {},
    defaultDeviceId: partial?.defaultDeviceId ?? DEFAULTS.defaultDeviceId,
    piProfiles,
    activePiId: coerceActivePiId(piProfiles, partial?.activePiId),
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

// ticket10-5A: the profile the capabilities poll and the /img/ routes
// target. A stale activePiId can never happen in the coerced store (the
// coercion falls back to the first profile), but the fallback is kept —
// consumers may pass arbitrary Settings-shaped values.
export function activePiProfile(s: Settings): PiProfile | null {
  if (s.piProfiles.length === 0) return null
  return s.piProfiles.find((p) => p.id === s.activePiId) ?? s.piProfiles[0]
}

// ticket10-5A: the profile 1 that a fresh wizard session materializes.
// There is deliberately NO synthetic default profile in the store (fresh
// install = empty list) — this only seeds the lazily created entry with the
// ticket defaults so the wizard keeps working before the profile list UI
// exists (follow-up worker 10-5C).
export function defaultPiProfile(index = 1): PiProfile {
  return {
    id: `pi-${index}`,
    label: `Pi ${index}`,
    ip: PI_SERVER_DEFAULT_IP,
    user: PI_SERVER_DEFAULT_USER,
    password: '',
    keyInstalled: false,
  }
}

// ticket10-5C: the next free profile number for the "pi-N" id format. The
// format is what the daemon's sanitizeProfileID (ticket10-5B) accepts, and
// it matches the migrated legacy profile (pi-1) and the coerced ids
// (coercePiProfile falls back to pi-<index+1>). Numbering is gap-aware:
// after deleting pi-2 from [pi-1, pi-3] the next profile is pi-2 again
// (labels are cosmetic; ids just have to stay unique and safe).
export function nextPiProfileNumber(profiles: PiProfile[]): number {
  const taken = new Set(profiles.map((p) => p.id))
  let n = 1
  while (taken.has(`pi-${n}`)) n += 1
  return n
}

// ticket10-5C: the fresh profile the "Profil hinzufügen" button creates.
// Id and label derive from the number ("pi-3" / "Pi 3"); the ip is seeded
// with the ticket default (the USB-Ethernet gateway) so "Verbindung testen"
// works out of the box — the user edits ip/user/password via the keyboard
// before starting the wizard.
export function newPiProfile(profiles: PiProfile[]): PiProfile {
  const n = nextPiProfileNumber(profiles)
  return {
    id: `pi-${n}`,
    label: `Pi ${n}`,
    ip: PI_SERVER_DEFAULT_IP,
    user: PI_SERVER_DEFAULT_USER,
    password: '',
    keyInstalled: false,
  }
}

// ticket10-5A: write one field of the ACTIVE profile (ticket10-5C added the
// label to the editable set — the keyboard covers label/ip/user/password).
// The first write lazily creates profile 1 (design decision: the wizard of
// ticket10-4 keeps working unchanged — it operates on the active profile,
// which does not exist yet on a fresh install). Writing exactly the
// display default on a fresh store is a no-op (nothing new to persist).
export function updateActivePiProfileField(
  field: 'label' | 'ip' | 'user' | 'password',
  value: string,
): void {
  const cur = getSettings()
  const active = activePiProfile(cur)
  if (!active) {
    if (value === defaultPiProfile()[field]) return
    const fresh: PiProfile = { ...defaultPiProfile(), [field]: value }
    updateSettings({ piProfiles: [fresh], activePiId: fresh.id })
    return
  }
  if (active[field] === value) return
  updateSettings({
    piProfiles: cur.piProfiles.map((p) => (p.id === active.id ? { ...p, [field]: value } : p)),
  })
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, () => current)
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
