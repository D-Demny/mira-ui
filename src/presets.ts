// Physical preset buttons (Digit1-4 on the Car Thing).
//
// For now this is mostly scaffolding: preset 1 plays Liked Songs, presets 2-4
// are unassigned. Will be further developed once we have the library
// Designed so a long-press would save the currently-playing context to a
// slot

export interface PresetConfig {
  contextUri: string | null
  label: string
}

const STORAGE_KEY = 'thing.presets.v1'

// Liked songs context
const DEFAULTS: Record<number, PresetConfig> = {
  1: { contextUri: 'spotify:collection:tracks', label: 'Liked Songs' },
  2: { contextUri: null, label: 'Preset 2' },
  3: { contextUri: null, label: 'Preset 3' },
  4: { contextUri: null, label: 'Preset 4' },
}

function loadOverrides(): Record<number, PresetConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<number, PresetConfig>) : {}
  } catch {
    return {}
  }
}

export function getPreset(index: number): PresetConfig | null {
  const overrides = loadOverrides()
  return overrides[index] ?? DEFAULTS[index] ?? null
}

// called on long-press to assign the currently-playing context to a slot
export function setPreset(index: number, config: PresetConfig): void {
  const overrides = loadOverrides()
  overrides[index] = config
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Ignore
  }
}

// try to get the human readable label or fall back to a generic one
export function labelFromUri(uri: string): string {
  if (uri.startsWith('spotify:collection')) return 'Liked Songs'
  if (uri.includes(':playlist:')) return 'Playlist'
  if (uri.includes(':album:')) return 'Album'
  if (uri.includes(':artist:')) return 'Artist'
  if (uri.includes(':show:') || uri.includes(':episode:')) return 'Podcast'
  return 'Saved'
}

// maps a KeyboardEvent.code from a preset button
export function presetIndexFromCode(code: string): number | null {
  switch (code) {
    case 'Digit1':
      return 1
    case 'Digit2':
      return 2
    case 'Digit3':
      return 3
    case 'Digit4':
      return 4
    default:
      return null
  }
}
