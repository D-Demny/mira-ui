import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSettings, getSettings, updateSettings } from '../settings'
import { getPreset, setPreset } from '../presets'

beforeEach(() => {
  localStorage.clear()
  // fake timers
  vi.useFakeTimers()
  __resetSettings()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('settings store', () => {
  it('uses sane defaults when nothing is stored', () => {
    expect(getSettings().showLyrics).toBe(true)
    expect(getSettings().lyricOffsetMs).toBe(0)
    expect(getSettings().volumeStepPct).toBe(2)
    expect(getSettings().autoBrightness).toBe(true)
    expect(getSettings().brightness).toBe(5)
  })

  it('round-trips updates through localStorage', () => {
    updateSettings({ lyricOffsetMs: 150, volumeStepPct: 5 })
    expect(getSettings().lyricOffsetMs).toBe(150)
    expect(getSettings().volumeStepPct).toBe(5)
    __resetSettings() // reload from localStorage
    expect(getSettings().lyricOffsetMs).toBe(150)
    expect(getSettings().volumeStepPct).toBe(5)
  })

  it('clamps an out-of-range volume step on load', () => {
    updateSettings({ volumeStepPct: 999 })
    __resetSettings()
    expect(getSettings().volumeStepPct).toBe(10)
  })

  it('round-trips and clamps the brightness settings', () => {
    updateSettings({ autoBrightness: false, brightness: 99 })
    __resetSettings()
    expect(getSettings().autoBrightness).toBe(false)
    expect(getSettings().brightness).toBe(10)
  })

  it('preset get falls back to defaults; set overrides via the store', () => {
    expect(getPreset(1)?.contextUri).toBe('spotify:collection:tracks') // default
    expect(getPreset(2)?.contextUri).toBeNull()
    setPreset(2, { contextUri: 'spotify:album:z', label: 'Album Z' })
    expect(getPreset(2)?.label).toBe('Album Z')
    expect(getSettings().presets[2]?.contextUri).toBe('spotify:album:z')
  })
})
