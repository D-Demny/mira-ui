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
    expect(getSettings().uiScalePct).toBe(100)
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

  it('round-trips the ui scale', () => {
    updateSettings({ uiScalePct: 115 })
    __resetSettings()
    expect(getSettings().uiScalePct).toBe(115)
  })

  it('snaps an off-step ui scale to the nearest notch on load', () => {
    localStorage.setItem('mira.settings.v1', JSON.stringify({ uiScalePct: 103 }))
    __resetSettings()
    expect(getSettings().uiScalePct).toBe(105)
  })

  // this one is load-bearing: the value becomes a css length and a divisor for the
  // lyrics drag math, and initSettings replaces the store wholesale from the daemon
  it.each([
    ['out of range high', 999, 115],
    ['out of range low', 10, 85],
    ['a numeric string', '110', 110],
    ['null', null, 100],
    ['undefined', undefined, 100],
    ['NaN (serialises to null)', Number.NaN, 100],
    ['Infinity (serialises to null)', Number.POSITIVE_INFINITY, 100],
    ['an empty string', '', 100],
    ['a non-numeric string', 'big', 100],
    ['an object', {}, 100],
  ])('coerces %s to a usable ui scale', (_label, stored, expected) => {
    localStorage.setItem('mira.settings.v1', JSON.stringify({ uiScalePct: stored }))
    __resetSettings()
    expect(getSettings().uiScalePct).toBe(expected)
  })

  it('default device id is null by default', () => {
    expect(getSettings().defaultDeviceId).toBeNull()
  })

  it('round-trips default device id', () => {
    updateSettings({ defaultDeviceId: 'device-abc-123' })
    expect(getSettings().defaultDeviceId).toBe('device-abc-123')
    __resetSettings()
    expect(getSettings().defaultDeviceId).toBe('device-abc-123')
  })

  it('clears default device id to null', () => {
    updateSettings({ defaultDeviceId: 'device-abc-123' })
    updateSettings({ defaultDeviceId: null })
    expect(getSettings().defaultDeviceId).toBeNull()
  })

  it('preset get falls back to defaults; set overrides via the store', () => {
    expect(getPreset(1)?.contextUri).toBe('spotify:collection:tracks') // default
    expect(getPreset(2)?.contextUri).toBeNull()
    setPreset(2, { contextUri: 'spotify:album:z', label: 'Album Z' })
    expect(getPreset(2)?.label).toBe('Album Z')
    expect(getSettings().presets[2]?.contextUri).toBe('spotify:album:z')
  })

  it('pi server credentials use the ticket defaults when nothing is stored', () => {
    expect(getSettings().piServer).toEqual({ ip: '192.168.7.1', user: 'root', password: '' })
  })

  it('round-trips the pi server credentials through localStorage', () => {
    updateSettings({ piServer: { ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' } })
    expect(getSettings().piServer).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' })
    __resetSettings() // reload from localStorage
    expect(getSettings().piServer).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' })
  })

  it('coerces a hand-edited pi server blob back to usable strings', () => {
    localStorage.setItem(
      'mira.settings.v1',
      JSON.stringify({ piServer: { ip: ' 10.0.0.9 ', user: 42, password: null } }),
    )
    __resetSettings()
    expect(getSettings().piServer).toEqual({ ip: '10.0.0.9', user: 'root', password: '' })
  })
})
