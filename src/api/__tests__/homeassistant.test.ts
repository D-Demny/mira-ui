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
  domainLabel,
  entityActive,
  fetchHaEntityList,
  fetchHaEntityState,
  humanizeEntityLabel,
  lightCapabilities,
  setHaLightBrightness,
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
      http.get('*/ha-api/states/light.missing', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
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
      http.post('*/ha-api/services/light/toggle', () =>
        HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
    )
    await expect(toggleHaEntity('light.3er_stehlampe_gold_esszimmer')).rejects.toThrow(/404|401/)
  })

  // bug56: 0 % (or negative) must switch the light OFF via light.turn_off —
  // the old code clamped to Math.max(1, …) and sent turn_on brightness_pct: 1
  describe('setHaLightBrightness (bug56)', () => {
    it('sends light.turn_off with only { entity_id } for 0 % and negative values', async () => {
      const off: unknown[] = []
      const on: unknown[] = []
      server.use(
        http.post('*/ha-api/services/light/turn_off', async ({ request }) => {
          off.push(await request.json())
          return HttpResponse.json([
            { entity_id: 'light.livingroom', state: 'off', attributes: {} },
          ])
        }),
        http.post('*/ha-api/services/light/turn_on', async ({ request }) => {
          on.push(await request.json())
          return HttpResponse.json([{ entity_id: 'light.livingroom', state: 'on', attributes: {} }])
        }),
      )
      const offResult = await setHaLightBrightness('light.livingroom', 0)
      expect(off).toEqual([{ entity_id: 'light.livingroom' }])
      expect(on).toEqual([]) // the old bug: turn_on with brightness_pct: 1
      expect(offResult[0]?.state).toBe('off')

      await setHaLightBrightness('light.livingroom', -3)
      expect(off).toEqual([{ entity_id: 'light.livingroom' }, { entity_id: 'light.livingroom' }])
      expect(on).toEqual([])
    })

    it('keeps light.turn_on with brightness_pct for 1–100 %', async () => {
      const off: unknown[] = []
      const on: unknown[] = []
      server.use(
        http.post('*/ha-api/services/light/turn_on', async ({ request }) => {
          on.push(await request.json())
          return HttpResponse.json([{ entity_id: 'light.livingroom', state: 'on', attributes: {} }])
        }),
        http.post('*/ha-api/services/light/turn_off', async ({ request }) => {
          off.push(await request.json())
          return HttpResponse.json([
            { entity_id: 'light.livingroom', state: 'off', attributes: {} },
          ])
        }),
      )
      await setHaLightBrightness('light.livingroom', 5)
      expect(on).toEqual([{ entity_id: 'light.livingroom', brightness_pct: 5 }])
      expect(off).toEqual([])

      await setHaLightBrightness('light.livingroom', 100)
      expect(on).toEqual([
        { entity_id: 'light.livingroom', brightness_pct: 5 },
        { entity_id: 'light.livingroom', brightness_pct: 100 },
      ])
      expect(off).toEqual([])
    })
  })

  describe('fetchHaEntityList (ticket 9.3)', () => {
    it('fetches the full state catalog via the daemon proxy', async () => {
      const list = await fetchHaEntityList()
      expect(Object.keys(list).length).toBeGreaterThan(0)
      // the default MSW fixture carries the curated lights + one per domain
      expect(list['light.3er_stehlampe_gold_esszimmer']?.state).toBe('off')
      expect(list['switch.wasserpumpe']?.state).toBe('off')
      expect(list['scene.abendstimmung']?.state).toBe('none')
      // the raw list is unfiltered — issue #37: toHomeEntityCatalog now
      // admits every domain, so the sensor survives into the catalog too
      expect(list['sensor.temperatur_wohnzimmer']?.state).toBe('21.5')
    })

    // bug55: HA's REAL contract is a JSON array — a well-formed array must be
    // accepted and normalized into the entity_id-keyed map (the old test
    // asserted the opposite: that an array body must throw)
    it("accepts HA's JSON array contract and normalizes it to the entity_id map", async () => {
      server.use(
        http.get('*/ha-api/states', () =>
          HttpResponse.json([
            { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'A' } },
            { entity_id: 'switch.b', state: 'off' },
          ]),
        ),
      )
      const list = await fetchHaEntityList()
      expect(list).toEqual({
        'light.a': { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'A' } },
        'switch.b': { entity_id: 'switch.b', state: 'off' },
      })
    })

    it('maps an empty array to an empty catalog without error', async () => {
      server.use(http.get('*/ha-api/states', () => HttpResponse.json([])))
      await expect(fetchHaEntityList()).resolves.toEqual({})
    })

    // bug55: the shape guard now rejects NON-array bodies — an object map (the
    // old, wrong fixture contract) must throw
    it('rejects a non-array object body', async () => {
      server.use(
        http.get('*/ha-api/states', () =>
          HttpResponse.json({ 'light.a': { entity_id: 'light.a', state: 'on' } }),
        ),
      )
      await expect(fetchHaEntityList()).rejects.toThrow('invalid entity list')
    })

    it('rejects an array containing an entry without a valid entity_id', async () => {
      for (const badEntry of [null, 42, { state: 'on' }, { entity_id: '' }]) {
        server.use(
          http.get('*/ha-api/states', () =>
            HttpResponse.json([{ entity_id: 'light.a', state: 'on' }, badEntry]),
          ),
        )
        await expect(fetchHaEntityList()).rejects.toThrow('invalid entity list')
      }
    })

    it('maps a non-JSON (HTML error page) body to a clean error', async () => {
      server.use(
        http.get(
          '*/ha-api/states',
          () =>
            new HttpResponse('<html>502 Bad Gateway</html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            }),
        ),
      )
      await expect(fetchHaEntityList()).rejects.toThrow(/Expected JSON but got text\/html/)
    })

    it('throws on a non-ok response', async () => {
      server.use(
        http.get('*/ha-api/states', () =>
          HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
        ),
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
      server.use(http.get('*/ha-api/states', () => new Promise<HttpResponse<undefined>>(() => {})))
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
          // bug55: real HA contract — a JSON array, not an object map
          return HttpResponse.json([{ entity_id: 'switch.b', state: 'off' }])
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
        http.get(
          '*/ha-api/states/light.slow-seam',
          () => new Promise<HttpResponse<undefined>>(() => {}),
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
    it('includes every domain: known ones in priority order, unknown ones after (alphabetical), label sort within a domain', () => {
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
        // issue #37: dynamic catalog — previously filtered out, now present
        'person.max': { entity_id: 'person.max', state: 'home' },
        'climate.schlafzimmer': {
          entity_id: 'climate.schlafzimmer',
          state: 'heat_cool',
          attributes: { friendly_name: 'Schlafzimmer' },
        },
        'sensor.b_feuchte': { entity_id: 'sensor.b_feuchte', state: '48.0' },
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
        'climate.schlafzimmer', // unknown domain: after ALL known ones,
        'person.max', // alphabetical by domain string (climate < person < sensor)
        'sensor.b_feuchte', // within a domain still by label
        'sensor.temperatur',
      ])
      expect(entries.map((e) => e.active)).toEqual([
        true, // light on
        true, // switch on
        false, // switch off
        null, // scene stateless
        true, // cover open
        false, // input_boolean off
        true, // media_player playing
        null, // climate: no active concept
        null, // person: no active concept
        null, // sensor: no active concept
        null, // sensor: no active concept
      ])
      // labels: humanized (no friendly_name) vs friendly_name
      expect(entries[0].label).toBe('3er Lampe')
      expect(entries[1].label).toBe('A Erste')
      expect(entries[2].label).toBe('Zweite')
      expect(entries[3].label).toBe('Abend')
      expect(entries[7].label).toBe('Schlafzimmer')
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
        no_dot: { entity_id: 'no_dot', state: 'on' },
        'light.broken': { entity_id: 'light.broken' } as unknown as HaEntityState,
      }
      expect(toHomeEntityCatalog(raw)).toEqual([])
    })

    it('carries attributes.icon through for every domain that reports one (issue #57 T2)', () => {
      const raw: Record<string, HaEntityState> = {
        'light.bulb': {
          entity_id: 'light.bulb',
          state: 'on',
          attributes: { icon: 'mdi:lightbulb' },
        },
        'cover.rollo': {
          entity_id: 'cover.rollo',
          state: 'open',
          attributes: { icon: 'mdi:window-closed-variant' },
        },
        'scene.cosy': { entity_id: 'scene.cosy', state: 'none', attributes: { icon: 'mdi:sofa' } },
      }
      const byId = new Map(toHomeEntityCatalog(raw).map((e) => [e.entityId, e]))
      expect(byId.get('light.bulb')?.icon).toBe('mdi:lightbulb')
      expect(byId.get('cover.rollo')?.icon).toBe('mdi:window-closed-variant')
      expect(byId.get('scene.cosy')?.icon).toBe('mdi:sofa')
    })

    it('leaves icon absent when the attribute is missing, empty, or not a string (issue #57 T2)', () => {
      const raw: Record<string, HaEntityState> = {
        'light.no_attrs': { entity_id: 'light.no_attrs', state: 'on' },
        'light.empty_icon': {
          entity_id: 'light.empty_icon',
          state: 'on',
          attributes: { icon: '' },
        },
        'light.null_icon': {
          entity_id: 'light.null_icon',
          state: 'on',
          attributes: { icon: null },
        },
        'light.weird_icon': {
          entity_id: 'light.weird_icon',
          state: 'on',
          attributes: { icon: 42 },
        },
      }
      const entries = toHomeEntityCatalog(raw)
      for (const entry of entries) expect(entry.icon).toBeUndefined()
    })

    it('carries the cover positionPct (current_position) clamped + rounded into 0–100, null when absent/null, and null for non-covers (issue #57 T2)', () => {
      const raw: Record<string, HaEntityState> = {
        'cover.normal': {
          entity_id: 'cover.normal',
          state: 'closed',
          attributes: { current_position: 42.6 },
        },
        'cover.over': {
          entity_id: 'cover.over',
          state: 'open',
          attributes: { current_position: 130 },
        },
        'cover.under': {
          entity_id: 'cover.under',
          state: 'closed',
          attributes: { current_position: -5 },
        },
        // issue #63: the LEGACY short `position` name is accepted as a fallback
        // only — integrations that do not report current_position still render
        // a thumb
        'cover.legacy': {
          entity_id: 'cover.legacy',
          state: 'closed',
          attributes: { position: 20 },
        },
        'cover.no_position': { entity_id: 'cover.no_position', state: 'open' },
        'cover.null_position': {
          entity_id: 'cover.null_position',
          state: 'open',
          attributes: { current_position: null },
        },
        'light.position_attr': {
          entity_id: 'light.position_attr',
          state: 'on',
          attributes: { position: 50 },
        },
      }
      const byId = new Map(toHomeEntityCatalog(raw).map((e) => [e.entityId, e]))
      expect(byId.get('cover.normal')?.positionPct).toBe(43) // rounded
      expect(byId.get('cover.over')?.positionPct).toBe(100) // clamped up
      expect(byId.get('cover.under')?.positionPct).toBe(0) // clamped down
      expect(byId.get('cover.legacy')?.positionPct).toBe(20) // legacy fallback
      expect(byId.get('cover.no_position')?.positionPct).toBeNull() // attribute absent
      expect(byId.get('cover.null_position')?.positionPct).toBeNull() // null value
      // other domains never carry a position, even with the attribute present
      expect(byId.get('light.position_attr')?.positionPct).toBeNull()
    })

    it('prefers current_position over the legacy position attribute when both are present (issue #63)', () => {
      const raw: Record<string, HaEntityState> = {
        'cover.both': {
          entity_id: 'cover.both',
          state: 'closed',
          attributes: { current_position: 10, position: 90 },
        },
      }
      const byId = new Map(toHomeEntityCatalog(raw).map((e) => [e.entityId, e]))
      // the standard attribute wins — and its semantics are "how far down":
      // 0 = fully open (top of the slider scale), 100 = fully closed (bottom)
      expect(byId.get('cover.both')?.positionPct).toBe(10)
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

  describe('domainLabel (issue #37)', () => {
    it('returns the German label for every known domain', () => {
      // the German domain labels rendered on the picker's level-1 category
      // cards (task 3 removed the duplicated SECTION_LABELS from the modal —
      // these are now the single source)
      const sectionLabels: Record<string, string> = {
        light: 'Lichter',
        switch: 'Schalter',
        fan: 'Lüfter',
        scene: 'Szenen',
        cover: 'Rollläden',
        input_boolean: 'Boolesche Werte',
        media_player: 'Mediaplayer',
      }
      for (const domain of Object.keys(sectionLabels)) {
        expect(domainLabel(domain)).toBe(sectionLabels[domain])
      }
    })

    it('title-cases unknown domains, keeping digits', () => {
      expect(domainLabel('input_select')).toBe('Input Select')
      expect(domainLabel('sensor')).toBe('Sensor')
      expect(domainLabel('fan_2')).toBe('Fan 2')
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

    it('falls back to the generic toggle service for unknown domains (issue #37)', async () => {
      // no TypeError anymore — the dynamic catalog admits any domain; a real
      // HA without a toggleable sensor would answer non-ok and surface via the
      // existing error path instead of throwing client-side
      const sensor = await activateHaEntity({
        entityId: 'sensor.temperatur_wohnzimmer',
        domain: 'sensor',
      })
      expect(sensor[0]?.entity_id).toBe('sensor.temperatur_wohnzimmer')
      expect(sensor[0]?.state).toBe('on') // MSW generic services catch-all (toggle path)
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
        lightCapabilities({
          entity_id: 'light.x',
          state: 'on',
          attributes: { supported_features: 1 },
        }),
      ).toEqual({ dimmable: true, brightnessPct: null })
      expect(
        lightCapabilities({
          entity_id: 'light.x',
          state: 'on',
          attributes: { supported_features: 0 },
        }),
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
