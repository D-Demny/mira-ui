import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  __resetSettings,
  activePiProfile,
  defaultPiProfile,
  getSettings,
  initSettings,
  updateActivePiProfileField,
  updateSettings,
} from '../settings'
import { getPreset, setPreset } from '../presets'
import { server } from './msw-server'

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

  describe('hybridDisabled (ticket10-7 KR4)', () => {
    it('defaults to false on a fresh install', () => {
      expect(getSettings().hybridDisabled).toBe(false)
    })

    it('coerces a missing field in an old blob to false (idempotent migration)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ showLyrics: false, volumeStepPct: 3, piProfiles: [], activePiId: null }),
      )
      __resetSettings()
      expect(getSettings().hybridDisabled).toBe(false)
    })

    it.each([
      ['true', true, true],
      ['the string "true"', '"true"', false],
      ['the number 1', 1, false],
      ['false', false, false],
    ])('strict coercion: stored %s → %s', (_label, stored, expected) => {
      localStorage.setItem('mira.settings.v1', JSON.stringify({ hybridDisabled: stored }))
      __resetSettings()
      expect(getSettings().hybridDisabled).toBe(expected)
    })

    it('round-trips true through localStorage', () => {
      updateSettings({ hybridDisabled: true })
      expect(getSettings().hybridDisabled).toBe(true)
      __resetSettings()
      expect(getSettings().hybridDisabled).toBe(true)
    })

    it('round-trips a clear back to false', () => {
      updateSettings({ hybridDisabled: true })
      updateSettings({ hybridDisabled: false })
      expect(getSettings().hybridDisabled).toBe(false)
      __resetSettings()
      expect(getSettings().hybridDisabled).toBe(false)
    })
  })

  describe('sidebarBackground (bug54/bug58)', () => {
    it('defaults to solid on a fresh install', () => {
      expect(getSettings().sidebarBackground).toBe('solid')
    })

    it('coerces a missing field in an old blob to solid (idempotent migration)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ showLyrics: false, piProfiles: [], activePiId: null }),
      )
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe('solid')
    })

    it.each([
      ['the exact "translucent" string', 'translucent', 'translucent'],
      ['the exact "clear" string (v2)', 'clear', 'clear'],
      ['the exact "blur" string (bug58)', 'blur', 'blur'],
      ['"transparent"', 'transparent', 'solid'],
      ['"SOLID"', 'SOLID', 'solid'],
      ['"Unschärfe" (a German label, not an enum value)', 'Unschärfe', 'solid'],
      ['"BLUR"', 'BLUR', 'solid'],
      ['the number 1', 1, 'solid'],
      ['true', true, 'solid'],
      ['null', null, 'solid'],
      ['an object', {}, 'solid'],
    ])('strict coercion: stored %s → %s', (_label, stored, expected) => {
      localStorage.setItem('mira.settings.v1', JSON.stringify({ sidebarBackground: stored }))
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe(expected)
    })

    // backward compat: blobs predating v2 only ever held 'solid' or
    // 'translucent' — the strict coercion above is the (null-op) migration
    it('keeps an old-blob "translucent" value on reload (no v2 migration needed)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ showLyrics: false, sidebarBackground: 'translucent' }),
      )
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe('translucent')
    })

    it('round-trips translucent through localStorage', () => {
      updateSettings({ sidebarBackground: 'translucent' })
      expect(getSettings().sidebarBackground).toBe('translucent')
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe('translucent')
    })

    it('round-trips clear through localStorage', () => {
      updateSettings({ sidebarBackground: 'clear' })
      expect(getSettings().sidebarBackground).toBe('clear')
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe('clear')
    })

    it('round-trips blur (bug58) through localStorage', () => {
      updateSettings({ sidebarBackground: 'blur' })
      expect(getSettings().sidebarBackground).toBe('blur')
      __resetSettings()
      expect(getSettings().sidebarBackground).toBe('blur')
    })

    // backward compat: blobs predating bug58 never held 'blur' — a missing
    // field stays 'solid' (no migration needed; the strict coercion above is
    // the null-op migration), so the pre-bug58 tests keep running unchanged
  })

  describe('ha (ticket 9.4)', () => {
    const DEFAULT_HA = {
      url: '',
      username: '',
      password: '',
      token: '',
      tokenSource: 'default' as const,
    }

    it('defaults to the empty ha config on a fresh install (daemon defaults apply)', () => {
      expect(getSettings().ha).toEqual(DEFAULT_HA)
    })

    it('coerces a v2 blob without an ha key to the defaults (v2→v3 migration)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ showLyrics: false, piProfiles: [], activePiId: null }),
      )
      __resetSettings()
      expect(getSettings().ha).toEqual(DEFAULT_HA)
    })

    it('coerces a complete ha object 1:1 (url/username trimmed, password/token verbatim)', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({
          ha: {
            url: '  http://10.10.1.104:8123  ',
            username: '  mira  ',
            password: 'p w  with  spaces ',
            token: '  eyJhbGciOi.eyJpc3Mi  ',
            tokenSource: 'login',
          },
        }),
      )
      __resetSettings()
      expect(getSettings().ha).toEqual({
        url: 'http://10.10.1.104:8123',
        username: 'mira',
        // verbatim — a secret with stray spaces is part of the value,
        // never "fixed" client-side (the daemon parses identically)
        password: 'p w  with  spaces ',
        token: '  eyJhbGciOi.eyJpc3Mi  ',
        tokenSource: 'login',
      })
    })

    it('coerces a non-object ha (hand-edited blob) to the defaults', () => {
      localStorage.setItem('mira.settings.v1', JSON.stringify({ ha: 'http://x' }))
      __resetSettings()
      expect(getSettings().ha).toEqual(DEFAULT_HA)
      localStorage.setItem('mira.settings.v1', JSON.stringify({ ha: null }))
      __resetSettings()
      expect(getSettings().ha).toEqual(DEFAULT_HA)
    })

    it.each([
      ['a foreign tokenSource', { tokenSource: 'bogus' }],
      ['the wrong-case tokenSource', { tokenSource: 'Login' }],
      ['a numeric tokenSource', { tokenSource: 1 }],
      ['a null tokenSource', { tokenSource: null }],
    ])('coerces %s to tokenSource default', (_label, ha) => {
      localStorage.setItem('mira.settings.v1', JSON.stringify({ ha }))
      __resetSettings()
      expect(getSettings().ha.tokenSource).toBe('default')
    })

    it('coerces a missing tokenSource (partial hand-edited blob) to default', () => {
      localStorage.setItem(
        'mira.settings.v1',
        JSON.stringify({ ha: { url: 'http://10.0.0.9:8123', token: 't' } }),
      )
      __resetSettings()
      expect(getSettings().ha).toEqual({ ...DEFAULT_HA, url: 'http://10.0.0.9:8123', token: 't' })
    })

    it.each(['manual', 'login'])('keeps the enum tokenSource %s', (tokenSource) => {
      localStorage.setItem('mira.settings.v1', JSON.stringify({ ha: { tokenSource } }))
      __resetSettings()
      expect(getSettings().ha.tokenSource).toBe(tokenSource)
    })

    it('round-trips updateSettings({ ha }) through localStorage (v3 blob)', () => {
      const ha = {
        url: 'http://192.168.1.10:8123',
        username: 'mira',
        password: 'pw',
        token: 'tok',
        tokenSource: 'login' as const,
      }
      updateSettings({ ha })
      expect(getSettings().ha).toEqual(ha)
      __resetSettings() // reload the persisted (v3) blob
      expect(getSettings().ha).toEqual(ha)
      // the persisted blob is the v3 shape the daemon parses opaquely
      const stored = JSON.parse(String(localStorage.getItem('mira.settings.v1'))) as {
        ha?: Record<string, unknown>
      }
      expect(stored.ha?.token).toBe('tok')
      expect(stored.ha?.tokenSource).toBe('login')
    })

    it('initSettings adopts a daemon v3 blob with an ha object', async () => {
      vi.useRealTimers() // the fetch round-trip needs the real clock
      server.use(
        http.get('*/settings', () =>
          HttpResponse.json({
            v: 3,
            showLyrics: false,
            ha: {
              url: 'http://10.10.1.104:8123',
              username: 'mira',
              password: 'pw',
              token: 'tok',
              tokenSource: 'login',
            },
          }),
        ),
      )
      await initSettings()
      expect(getSettings().ha).toEqual({
        url: 'http://10.10.1.104:8123',
        username: 'mira',
        password: 'pw',
        token: 'tok',
        tokenSource: 'login',
      })
    })

    it('initSettings coerces a daemon v2 blob without ha to the defaults', async () => {
      vi.useRealTimers()
      server.use(http.get('*/settings', () => HttpResponse.json({ v: 2, showLyrics: false })))
      await initSettings()
      expect(getSettings().ha).toEqual(DEFAULT_HA)
      // the store is re-persisted in the v3 shape for the next daemon read
      const stored = JSON.parse(String(localStorage.getItem('mira.settings.v1'))) as {
        ha?: Record<string, unknown>
      }
      expect(stored.ha).toEqual(DEFAULT_HA)
    })
  })
})
