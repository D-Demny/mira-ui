import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSettings,
  activePiProfile,
  defaultPiProfile,
  getSettings,
  updateActivePiProfileField,
  updateSettings,
} from '../settings'
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

  describe('pi profiles (ticket10-5A)', () => {
    it('starts with an empty profile list on a fresh install (no synthetic default profile)', () => {
      expect(getSettings().piProfiles).toEqual([])
      expect(getSettings().activePiId).toBeNull()
      expect(activePiProfile(getSettings())).toBeNull()
    })

    it('migrates a legacy piServer entry into exactly one profile (fields kept verbatim)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ piServer: { ip: ' 10.0.0.5 ', user: 'dietpi', password: 'secret' } }),
      )
      __resetSettings()
      expect(getSettings().piProfiles).toEqual([
        {
          id: 'pi-1',
          label: 'Pi 1',
          ip: '10.0.0.5',
          user: 'dietpi',
          password: 'secret',
          keyInstalled: false,
        },
      ])
      expect(getSettings().activePiId).toBe('pi-1')
      expect(activePiProfile(getSettings())?.ip).toBe('10.0.0.5')
    })

    it('treats a legacy blob holding only the ticket defaults as a fresh install', () => {
      // a pure-defaults blob is indistinguishable from a fresh install —
      // it never carried real credentials, so nothing is lost
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ piServer: { ip: '192.168.7.1', user: 'root', password: '' } }),
      )
      __resetSettings()
      expect(getSettings().piProfiles).toEqual([])
      expect(getSettings().activePiId).toBeNull()
    })

    it('does not migrate twice (idempotent through the persist cycle)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ piServer: { ip: '10.0.0.5', user: 'dietpi', password: 'secret' } }),
      )
      __resetSettings()
      updateSettings({}) // the persist cycle the app runs after a load
      __resetSettings() // reload the persisted (new-shape) blob
      expect(getSettings().piProfiles).toEqual([
        {
          id: 'pi-1',
          label: 'Pi 1',
          ip: '10.0.0.5',
          user: 'dietpi',
          password: 'secret',
          keyInstalled: false,
        },
      ])
      expect(getSettings().activePiId).toBe('pi-1')
    })

    it('round-trips profiles + active id through localStorage', () => {
      updateSettings({
        piProfiles: [
          { id: 'pi-1', label: 'Pi 1', ip: '10.0.0.1', user: 'root', password: 'a', keyInstalled: true },
          { id: 'pi-2', label: 'Pi 2', ip: '10.0.0.2', user: 'root', password: 'b', keyInstalled: false },
        ],
        activePiId: 'pi-2',
      })
      expect(getSettings().activePiId).toBe('pi-2')
      __resetSettings() // reload from localStorage
      expect(getSettings().piProfiles[0].keyInstalled).toBe(true)
      expect(getSettings().piProfiles[1].ip).toBe('10.0.0.2')
      expect(getSettings().activePiId).toBe('pi-2')
    })

    it('coerces a hand-edited profile list (drops unusable entries, dedupes ids)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({
          piProfiles: [
            { id: 'a', label: '', ip: ' 10.0.0.1 ', user: '  ', password: 'p1' },
            { id: 'a', label: 'Dup', ip: '10.0.0.2', user: 'root', password: 'x' },
            { id: '', ip: '', user: 'root', password: '' },
            'garbage',
          ],
          activePiId: 'missing',
        }),
      )
      __resetSettings()
      expect(getSettings().piProfiles).toEqual([
        { id: 'a', label: 'Pi 1', ip: '10.0.0.1', user: 'root', password: 'p1', keyInstalled: false },
      ])
      // a stale active id falls back to the first profile
      expect(getSettings().activePiId).toBe('a')
    })

    it('falls back to the first profile for a stale active id and to null for an empty list', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({
          piProfiles: [{ id: 'b', label: 'Pi B', ip: '10.0.0.9', user: 'root', password: '' }],
          activePiId: 'gone',
        }),
      )
      __resetSettings()
      expect(getSettings().activePiId).toBe('b')
      localStorage.setItem('mira.settings.v1', JSON.stringify({ piProfiles: [], activePiId: 'gone' }))
      __resetSettings()
      expect(getSettings().activePiId).toBeNull()
    })

    it('updateActivePiProfileField lazily creates profile 1 and then updates it', () => {
      expect(activePiProfile(getSettings())).toBeNull()
      updateActivePiProfileField('ip', '10.9.9.9')
      expect(getSettings().piProfiles).toEqual([
        { id: 'pi-1', label: 'Pi 1', ip: '10.9.9.9', user: 'root', password: '', keyInstalled: false },
      ])
      expect(getSettings().activePiId).toBe('pi-1')
      updateActivePiProfileField('user', 'dietpi')
      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].user).toBe('dietpi')
    })

    it('updateActivePiProfileField is a no-op for the display default without a profile', () => {
      // the wizard's shown defaults are not persisted until they actually change
      updateActivePiProfileField('ip', '192.168.7.1')
      updateActivePiProfileField('password', '')
      expect(getSettings().piProfiles).toEqual([])
      expect(defaultPiProfile()).toEqual({
        id: 'pi-1',
        label: 'Pi 1',
        ip: '192.168.7.1',
        user: 'root',
        password: '',
        keyInstalled: false,
      })
    })
  })
})
