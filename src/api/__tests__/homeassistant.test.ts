import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  CATALOG_TIMEOUT_MS,
  ENTITY_SERVICES,
  HOME_ENTITY_DOMAINS,
  __setHaTimeoutForTests,
  activateHaEntity,
  callHaService,
  entityActive,
  fetchHaEntityList,
  fetchHaEntityState,
  humanizeEntityLabel,
  lightCapabilities,
  toHomeEntityCatalog,
  toggleHaEntity,
} from '../homeassistant'
import type { HaEntityState } from '../homeassistant'

describe('homeassistant api', () => {
  afterEach(() => {
    vi.useRealTimers()
    // bug53: never leak the test-timeout override into other tests
    __setHaTimeoutForTests(null)
  })

  it('fetches an entity state via the daemon /ha-api/ proxy', async () => {
    // the token is injected by the daemon proxy, the UI sends no Authorization
    let auth: string | null = 'sentinel'
    server.use(
      http.get('*/ha-api/states/light.livingroom', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({
          entity_id: 'light.livingroom',
          state: 'on',
          attributes: { friendly_name: 'Livingroom' },
        })
      }),
    )
    const entity = await fetchHaEntityState('light.livingroom')
    expect(entity.state).toBe('on')
    expect(auth).toBeNull()
  })

  it('throws on a non-ok response', async () => {
    server.use(
      http.get(
        '*/ha-api/states/light.missing',
        () => HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    )
    await expect(fetchHaEntityState('light.missing')).rejects.toThrow(/404/)
  })

  it('times out after 5 seconds', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('*/ha-api/states/light.slow', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = fetchHaEntityState('light.slow').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('home assistant timeout')
  })

  it('toggles the light and returns the updated state', async () => {
    let payload: unknown = null
    server.use(
      http.post('*/ha-api/services/light/toggle', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json([
          { entity_id: 'light.other', state: 'on' },
          { entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' },
        ])
      }),
    )
    const entity = await toggleHaEntity('light.3er_stehlampe_gold_esszimmer')
    expect(payload).toEqual({ entity_id: 'light.3er_stehlampe_gold_esszimmer' })
    expect(entity?.state).toBe('off')
  })

  it('throws when the toggle service fails', async () => {
    server.use(
      http.post(
        '*/ha-api/services/light/toggle',
        () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
    )
    await expect(toggleHaEntity('light.3er_stehlampe_gold_esszimmer')).rejects.toThrow(/404|401/)
  })

  describe('fetchHaEntityList (ticket 9.3)', () => {
    it('fetches the full state catalog via the daemon proxy', async () => {
      const list = await fetchHaEntityList()
      expect(Object.keys(list).length).toBeGreaterThan(0)
      // the default MSW fixture carries the curated lights + one per domain
      expect(list['light.3er_stehlampe_gold_esszimmer']?.state).toBe('off')
      expect(list['switch.wasserpumpe']?.state).toBe('off')
      expect(list['scene.abendstimmung']?.state).toBe('none')
      // the raw list is unfiltered — the sensor only drops in toHomeEntityCatalog
      expect(list['sensor.temperatur_wohnzimmer']?.state).toBe('21.5')
    })

    it('rejects non-object bodies', async () => {
      server.use(
        http.get('*/ha-api/states', () => HttpResponse.json(['light.a', 'light.b'])),
      )
      await expect(fetchHaEntityList()).rejects.toThrow('invalid entity list')
    })

    it('throws on a non-ok response', async () => {
      server.use(
        http.get('*/ha-api/states', () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 })),
      )
      await expect(fetchHaEntityList()).rejects.toThrow(/401/)
    })

    // MSW ignores AbortSignal — the timeout tests need FULL fake timers
    // (same pattern as the fetchHaEntityState timeout test above)
    // bug53: the catalog carries the dedicated CATALOG_TIMEOUT_MS budget
    // (15 s — deliberately ABOVE the daemon proxy's 8 s client timeout), so
    // the abort fires at that deadline, not at the 5 s single-state budget
    it('times out after the catalog budget, not the single-state budget', async () => {
      vi.useFakeTimers()
      server.use(
        http.get('*/ha-api/states', () => new Promise<HttpResponse<undefined>>(() => {})),
      )
      const pending = fetchHaEntityList().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS)
      const err = await pending
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe('home assistant timeout')
    })

    // bug53: a response slower than the old 5 s single-state budget (here:
    // 6 s) must now SUCCEED — the catalog's own 15 s budget no longer
    // aborts it; the daemon proxy's 8 s client timeout is the next wall
    it('accepts a catalog response slower than the single-state budget', async () => {
      vi.useFakeTimers()
      server.use(
        http.get('*/ha-api/states', async () => {
          await new Promise((resolve) => setTimeout(resolve, 6000))
          return HttpResponse.json({ 'switch.b': { entity_id: 'switch.b', state: 'off' } })
        }),
      )
      const pending = fetchHaEntityList()
      await vi.advanceTimersByTimeAsync(6000)
      const list = await pending
      expect(list['switch.b']?.state).toBe('off')
    })

    // bug53: the testability seam overrides the DEFAULT fetch timeout — the
    // single-state budget can be shrunk for deterministic abort tests without
    // real 5 s waits (the catalog keeps its explicit CATALOG_TIMEOUT_MS)
    it('the test-timeout override shrinks the default single-state budget', async () => {
      vi.useFakeTimers()
      __setHaTimeoutForTests(100)
      server.use(
        http.get('*/ha-api/states/light.slow-seam', () =>
          new Promise<HttpResponse<undefined>>(() => {}),
        ),
      )
      const pending = fetchHaEntityState('light.slow-seam').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(100)
      const err = await pending
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe('home assistant timeout')
    })
  })

  describe('toHomeEntityCatalog (ticket 9.3)', () => {
    it('filters to the controllable domains and sorts by domain then label', () => {
      const raw: Record<string, HaEntityState> = {
        'sensor.temperatur': { entity_id: 'sensor.temperatur', state: '21.5' },
        'switch.b_zweite': {
          entity_id: 'switch.b_zweite',
          state: 'off',
          attributes: { friendly_name: 'Zweite' },
        },
        'switch.a_erste': { entity_id: 'switch.a_erste', state: 'on' },
        'light.3er_lampe': { entity_id: 'light.3er_lampe', state: 'on' },
        'scene.abend': { entity_id: 'scene.abend', state: 'none' },
        'cover.tor': { entity_id: 'cover.tor', state: 'open' },
        'input_boolean.flag': { entity_id: 'input_boolean.flag', state: 'off' },
        'media_player.tv': { entity_id: 'media_player.tv', state: 'playing' },
      }
      const entries = toHomeEntityCatalog(raw)
      expect(entries.map((e) => e.entityId)).toEqual([
        'light.3er_lampe', // light first (domain priority 0)
        'switch.a_erste', // "A Erste" < "Zweite" (de locale, base sensitivity)
        'switch.b_zweite',
        'scene.abend',
        'cover.tor',
        'input_boolean.flag',
        'media_player.tv',
      ])
      expect(entries.map((e) => e.active)).toEqual([
        true, // light on
        true, // switch on
        false, // switch off
        null, // scene stateless
        true, // cover open
        false, // input_boolean off
        true, // media_player playing
      ])
      // labels: humanized (no friendly_name) vs friendly_name
      expect(entries[0].label).toBe('3er Lampe')
      expect(entries[1].label).toBe('A Erste')
      expect(entries[2].label).toBe('Zweite')
      expect(entries[3].label).toBe('Abend')
    })

    it('prefers friendly_name and humanizes when it is missing or empty', () => {
      const raw: Record<string, HaEntityState> = {
        'switch.with_name': {
          entity_id: 'switch.with_name',
          state: 'on',
          attributes: { friendly_name: 'Wasserpumpe' },
        },
        'switch.no_name': { entity_id: 'switch.no_name', state: 'on' },
        'switch.empty_name': {
          entity_id: 'switch.empty_name',
          state: 'on',
          attributes: { friendly_name: '' },
        },
      }
      const entries = toHomeEntityCatalog(raw)
      expect(entries.map((e) => e.entityId)).toEqual([
        'switch.empty_name', // "Empty Name" < "No Name" < "Wasserpumpe" (de, base)
        'switch.no_name',
        'switch.with_name',
      ])
      expect(entries.find((e) => e.entityId === 'switch.with_name')?.label).toBe('Wasserpumpe')
      expect(entries.find((e) => e.entityId === 'switch.no_name')?.label).toBe('No Name')
      expect(entries.find((e) => e.entityId === 'switch.empty_name')?.label).toBe('Empty Name')
    })

    it('skips entries without a domain prefix or state', () => {
      const raw: Record<string, HaEntityState> = {
        'no_dot': { entity_id: 'no_dot', state: 'on' },
        'light.broken': { entity_id: 'light.broken' } as unknown as HaEntityState,
      }
      expect(toHomeEntityCatalog(raw)).toEqual([])
    })
  })

  describe('entityActive (ticket 9.3)', () => {
    it('maps state to active per domain', () => {
      expect(entityActive('light', 'on')).toBe(true)
      expect(entityActive('light', 'off')).toBe(false)
      expect(entityActive('switch', 'off')).toBe(false)
      expect(entityActive('fan', 'on')).toBe(true)
      expect(entityActive('input_boolean', 'on')).toBe(true)
      expect(entityActive('cover', 'open')).toBe(true)
      expect(entityActive('cover', 'closed')).toBe(false)
      expect(entityActive('media_player', 'playing')).toBe(true)
      expect(entityActive('media_player', 'idle')).toBe(false)
      expect(entityActive('scene', 'none')).toBeNull()
    })

    it('returns false for known-inactive states and null otherwise for unknown domains', () => {
      expect(entityActive('sensor', 'off')).toBe(false)
      expect(entityActive('sensor', 'closed')).toBe(false)
      expect(entityActive('sensor', 'paused')).toBe(false)
      expect(entityActive('sensor', 'idle')).toBe(false)
      expect(entityActive('sensor', 'standby')).toBe(false)
      expect(entityActive('sensor', 'weird-state')).toBeNull()
    })
  })

  describe('humanizeEntityLabel (ticket 9.3)', () => {
    it('strips the domain prefix and capitalizes the words', () => {
      expect(humanizeEntityLabel('switch.wasserpumpe_keller')).toBe('Wasserpumpe Keller')
      expect(humanizeEntityLabel('light.3er_stehlampe_gold_esszimmer')).toBe(
        '3er Stehlampe Gold Esszimmer',
      )
      expect(humanizeEntityLabel('media_player.tv')).toBe('Tv')
    })
  })

  describe('callHaService / activateHaEntity (ticket 9.3)', () => {
    it('calls the generic service endpoint and parses the echoed response', async () => {
      const res = await callHaService('switch', 'toggle', { entity_id: 'switch.wasserpumpe' })
      expect(res).toEqual([{ entity_id: 'switch.wasserpumpe', state: 'on', attributes: {} }])
    })

    it('throws a TypeError for invalid domain or service segments', () => {
      expect(() => callHaService('bad..domain', 'toggle', { entity_id: 'x.y' })).toThrow(TypeError)
      expect(() => callHaService('Light', 'toggle', { entity_id: 'x.y' })).toThrow(TypeError)
      expect(() => callHaService('light', 'Toggle!', { entity_id: 'x.y' })).toThrow(TypeError)
      expect(() => callHaService('light/', 'toggle', { entity_id: 'x.y' })).toThrow(TypeError)
    })

    it('dispatches per domain via ENTITY_SERVICES', async () => {
      const scene = await activateHaEntity({ entityId: 'scene.abendstimmung', domain: 'scene' })
      expect(scene[0]?.entity_id).toBe('scene.abendstimmung')
      // lights go through the SPECIFIC light/toggle handler (declared first)
      const light = await activateHaEntity({
        entityId: 'light.3er_stehlampe_gold_esszimmer',
        domain: 'light',
      })
      expect(light[0]?.state).toBe('on')
    })

    it('throws a TypeError for unknown domains', () => {
      expect(() => activateHaEntity({ entityId: 'sensor.x', domain: 'sensor' })).toThrow(TypeError)
    })

    it('exports the domain list and service map as specced', () => {
      expect(HOME_ENTITY_DOMAINS).toEqual([
        'light',
        'switch',
        'fan',
        'scene',
        'cover',
        'input_boolean',
        'media_player',
      ])
      expect(ENTITY_SERVICES.scene).toBe('turn_on')
      expect(ENTITY_SERVICES.light).toBe('toggle')
    })
  })

  describe('lightCapabilities (ticket 9.3 move from useHomeLight)', () => {
    it('derives dimmability from color modes and the brightness pct', () => {
      expect(
        lightCapabilities({
          entity_id: 'light.x',
          state: 'on',
          attributes: { supported_color_modes: ['color_temp', 'xy'], brightness: 128 },
        }),
      ).toEqual({ dimmable: true, brightnessPct: 50 })
    })

    it('counts the legacy SUPPORT_BRIGHTNESS feature bit as a union', () => {
      expect(
        lightCapabilities({ entity_id: 'light.x', state: 'on', attributes: { supported_features: 1 } }),
      ).toEqual({ dimmable: true, brightnessPct: null })
      expect(
        lightCapabilities({ entity_id: 'light.x', state: 'on', attributes: { supported_features: 0 } }),
      ).toEqual({ dimmable: false, brightnessPct: null })
    })

    it('is not dimmable without any capability and hides the pct while off', () => {
      expect(lightCapabilities({ entity_id: 'light.x', state: 'on', attributes: {} })).toEqual({
        dimmable: false,
        brightnessPct: null,
      })
      expect(
        lightCapabilities({
          entity_id: 'light.x',
          state: 'off',
          attributes: { supported_color_modes: ['brightness'], brightness: 0 },
        }),
      ).toEqual({ dimmable: true, brightnessPct: null })
    })
  })
})
