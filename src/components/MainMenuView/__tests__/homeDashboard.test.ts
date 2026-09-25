import { describe, expect, it } from 'vitest'
import type { DashboardEntity } from '../homeDashboard'
import {
  COVER_COLUMN_SIZE,
  COVER_PLACEHOLDER_LABELS,
  COVER_SECTION_SUBTITLE,
  COVER_SECTION_TITLE,
  LIGHT_GRID_SLOTS,
  LIGHT_PLACEHOLDERS,
  SCENE_PLACEHOLDER_LABELS,
  SCENE_ROW_SIZE,
  buildCoverSection,
  buildLightGrid,
  buildSceneRow,
  classifyEntities,
  clampBrightnessPct,
  lightMenuIcon,
  sceneMenuIcon,
} from '../homeDashboard'

// minimal DashboardEntity factory (structurally = HomeEntityView, 9.3) — the
// defaults keep the tests focused on one field at a time
function entity(overrides: Partial<DashboardEntity> & { entityId: string }): DashboardEntity {
  return {
    domain: 'light',
    label: overrides.entityId.slice(overrides.entityId.indexOf('.') + 1),
    state: 'on',
    active: true,
    dimmable: false,
    brightnessPct: null,
    // issue #57 (T2): no icon by default (absent), no cover position — the
    // propagation tests below override both explicitly
    positionPct: null,
    ...overrides,
  }
}

function light(entityId: string, extra: Partial<DashboardEntity> = {}): DashboardEntity {
  return entity({ entityId, domain: 'light', ...extra })
}

describe('classifyEntities (ticket9.6)', () => {
  it('splits by domain into scenes / lights / covers, preserving order', () => {
    const classified = classifyEntities([
      light('light.esstisch'),
      entity({ entityId: 'scene.cosy', domain: 'scene', active: null }),
      light('light.flur'),
      entity({ entityId: 'cover.rollo', domain: 'cover', state: 'open' }),
      entity({ entityId: 'scene.normal', domain: 'scene', active: null }),
    ])
    expect(classified.scenes.map((e) => e.entityId)).toEqual(['scene.cosy', 'scene.normal'])
    expect(classified.lights.map((e) => e.entityId)).toEqual(['light.esstisch', 'light.flur'])
    expect(classified.covers.map((e) => e.entityId)).toEqual(['cover.rollo'])
  })

  it('drops domains outside the three dashboard zones (switch / fan / ...)', () => {
    const classified = classifyEntities([
      entity({ entityId: 'switch.pumpe', domain: 'switch' }),
      entity({ entityId: 'fan.luefter', domain: 'fan' }),
      entity({ entityId: 'media_player.tv', domain: 'media_player' }),
    ])
    expect(classified).toEqual({ scenes: [], lights: [], covers: [] })
  })

  it('returns empty buckets for an empty selection', () => {
    expect(classifyEntities([])).toEqual({ scenes: [], lights: [], covers: [] })
  })

  it('does not mutate the input list', () => {
    const input = [light('light.a'), entity({ entityId: 'cover.b', domain: 'cover' })]
    const before = [...input]
    classifyEntities(input)
    expect(input).toEqual(before)
  })
})

describe('buildSceneRow (ticket9.6)', () => {
  it('fills all 3 slots with the default labels when no scene is configured', () => {
    const row = buildSceneRow([])
    expect(row).toHaveLength(SCENE_ROW_SIZE)
    expect(row.map((slot) => slot.label)).toEqual([...SCENE_PLACEHOLDER_LABELS])
    expect(row.every((slot) => slot.isPlaceholder && slot.entityId === null)).toBe(true)
  })

  it('keeps one configured scene first, pads the rest in placeholder order', () => {
    const row = buildSceneRow([entity({ entityId: 'scene.cosy', domain: 'scene', label: 'Cosy' })])
    expect(row).toHaveLength(3)
    expect(row[0]).toEqual({
      entityId: 'scene.cosy',
      label: 'Cosy',
      isPlaceholder: false,
      icon: null, // issue #57 (T2): fixture entity carries no HA icon
    })
    expect(row[1].label).toBe('Cosy time')
    expect(row[2].label).toBe('Betti Zeit')
    expect(row.slice(1).every((slot) => slot.isPlaceholder)).toBe(true)
  })

  it('pads only the last slot for two configured scenes', () => {
    const row = buildSceneRow([
      entity({ entityId: 'scene.a', domain: 'scene', label: 'A' }),
      entity({ entityId: 'scene.b', domain: 'scene', label: 'B' }),
    ])
    expect(row.map((slot) => slot.isPlaceholder)).toEqual([false, false, true])
    expect(row[2].label).toBe('Betti Zeit')
  })

  it('uses no placeholders for exactly 3 configured scenes', () => {
    const row = buildSceneRow([
      entity({ entityId: 'scene.a', domain: 'scene' }),
      entity({ entityId: 'scene.b', domain: 'scene' }),
      entity({ entityId: 'scene.c', domain: 'scene' }),
    ])
    expect(row).toHaveLength(3)
    expect(row.every((slot) => !slot.isPlaceholder && slot.entityId !== null)).toBe(true)
  })

  it('keeps MORE than 3 configured scenes (the row grows, nothing is dropped)', () => {
    const row = buildSceneRow([
      entity({ entityId: 'scene.a', domain: 'scene' }),
      entity({ entityId: 'scene.b', domain: 'scene' }),
      entity({ entityId: 'scene.c', domain: 'scene' }),
      entity({ entityId: 'scene.d', domain: 'scene' }),
    ])
    expect(row.map((slot) => slot.entityId)).toEqual(['scene.a', 'scene.b', 'scene.c', 'scene.d'])
    expect(row.every((slot) => !slot.isPlaceholder)).toBe(true)
  })
})

describe('buildLightGrid (ticket9.6)', () => {
  it('fills all 4 slots with the mockup defaults when no light is configured', () => {
    const grid = buildLightGrid([])
    expect(grid).toHaveLength(LIGHT_GRID_SLOTS)
    grid.forEach((tile, i) => {
      const expected = LIGHT_PLACEHOLDERS[i]
      expect(tile).toEqual({
        entityId: null,
        label: expected.label,
        isOn: expected.isOn,
        brightnessPct: expected.brightnessPct,
        // issue #60: placeholders are static mock content — the turn-off
        // marker never applies (the Stehlampen mock keeps its muted bar)
        fadingOff: false,
        dimmable: true,
        isPlaceholder: true,
        icon: null, // issue #57 (T2): placeholders carry no HA icon
      })
    })
    // slot order per mockup: Esstisch 20% An / Flurlicht 50% An /
    // Stehlampen 0% Aus / Treppenspots 10% An
    expect(grid.map((t) => `${t.label} ${t.brightnessPct}%`)).toEqual([
      'Esstisch 20%',
      'Flurlicht 50%',
      'Stehlampen 0%',
      'Treppenspots 10%',
    ])
    expect(grid[2].isOn).toBe(false)
  })

  it('maps one configured light into slot 0 and pads slots 1–3', () => {
    const grid = buildLightGrid([
      light('light.esstisch', { label: 'Esstisch', dimmable: true, brightnessPct: 20 }),
    ])
    expect(grid).toHaveLength(4)
    expect(grid[0]).toEqual({
      entityId: 'light.esstisch',
      label: 'Esstisch',
      isOn: true,
      brightnessPct: 20,
      // issue #60: an ON tile never carries the turn-off marker
      fadingOff: false,
      dimmable: true,
      isPlaceholder: false,
      icon: null, // issue #57 (T2): fixture entity carries no HA icon
    })
    expect(grid.slice(1).map((t) => t.label)).toEqual(['Flurlicht', 'Stehlampen', 'Treppenspots'])
    expect(grid.slice(1).every((t) => t.isPlaceholder)).toBe(true)
  })

  it('pads only the last two slots for 2 configured lights', () => {
    const grid = buildLightGrid([light('light.a'), light('light.b')])
    expect(grid.map((t) => t.isPlaceholder)).toEqual([false, false, true, true])
    expect(grid[2].label).toBe('Stehlampen')
    expect(grid[3].label).toBe('Treppenspots')
  })

  it('pads only the last slot for 3 configured lights', () => {
    const grid = buildLightGrid([light('light.a'), light('light.b'), light('light.c')])
    expect(grid.map((t) => t.isPlaceholder)).toEqual([false, false, false, true])
    expect(grid[3]).toMatchObject({ label: 'Treppenspots', brightnessPct: 10, dimmable: true })
  })

  it('uses no placeholders for exactly 4 configured lights', () => {
    const grid = buildLightGrid([
      light('light.a'),
      light('light.b'),
      light('light.c'),
      light('light.d'),
    ])
    expect(grid).toHaveLength(4)
    expect(grid.every((t) => !t.isPlaceholder && t.entityId !== null)).toBe(true)
  })

  it('keeps MORE than 4 configured lights (the grid grows by rows)', () => {
    const grid = buildLightGrid([1, 2, 3, 4, 5].map((n) => light(`light.l${n}`)))
    expect(grid).toHaveLength(5)
    expect(grid.every((t) => !t.isPlaceholder)).toBe(true)
  })

  it('carries the dimmable capability through (W2 long-press gate)', () => {
    const grid = buildLightGrid([
      light('light.dimmable', { dimmable: true }),
      light('light.switch_like', { dimmable: false, active: false, state: 'off' }),
    ])
    expect(grid[0].dimmable).toBe(true)
    expect(grid[1].dimmable).toBe(false)
    // every placeholder tile is long-pressable per the ticket as well
    expect(grid.slice(2).every((t) => t.dimmable)).toBe(true)
  })

  it('treats an unknown (null) active state as off', () => {
    const grid = buildLightGrid([light('light.unknown', { active: null, state: null })])
    expect(grid[0].isOn).toBe(false)
  })

  it('flags the turn-off transition window as fadingOff (issue #60)', () => {
    // OFF + known level = the stale attributes.brightness lingers while HA
    // confirms 'off' (~1–2 s) — the slider must stay on its warm accent
    const grid = buildLightGrid([
      light('light.fading', { dimmable: true, active: false, state: 'off', brightnessPct: 40 }),
      light('light.lit', { dimmable: true, active: true, state: 'on', brightnessPct: 40 }),
      // settled OFF: HA cleared the level → no transition window
      light('light.settled', { dimmable: true, active: false, state: 'off', brightnessPct: null }),
    ])
    expect(grid[0].fadingOff).toBe(true)
    expect(grid[1].fadingOff).toBe(false)
    expect(grid[2].fadingOff).toBe(false)
  })
})

describe('clampBrightnessPct (ticket9.6)', () => {
  it('passes valid percentages through (rounded)', () => {
    expect(clampBrightnessPct(0)).toBe(0)
    expect(clampBrightnessPct(100)).toBe(100)
    expect(clampBrightnessPct(20.4)).toBe(20)
  })

  it('is null-safe: null / NaN / Infinity stay null', () => {
    expect(clampBrightnessPct(null)).toBeNull()
    expect(clampBrightnessPct(Number.NaN)).toBeNull()
    expect(clampBrightnessPct(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('clamps out-of-range values into 0–100', () => {
    // a raw 0–255 scale value (e.g. 255) must not overflow the bar width
    expect(clampBrightnessPct(255)).toBe(100)
    expect(clampBrightnessPct(-30)).toBe(0)
  })

  it('keeps null brightness null through buildLightGrid (off / unknown light)', () => {
    const grid = buildLightGrid([
      light('light.off', { active: false, state: 'off', brightnessPct: null }),
    ])
    expect(grid[0].brightnessPct).toBeNull()
  })
})

describe('buildCoverSection (ticket9.6)', () => {
  it('renders the default placeholder section when no cover is mapped', () => {
    const section = buildCoverSection([])
    expect(section.isPlaceholder).toBe(true)
    expect(section.title).toBe(COVER_SECTION_TITLE)
    expect(section.subtitle).toBe(COVER_SECTION_SUBTITLE)
    expect(section.title).toBe('Wohnzimmer und Esszimmer')
    expect(section.subtitle).toBe('Rollo Steuerung EG')
    expect(section.columns).toHaveLength(COVER_COLUMN_SIZE)
    section.columns.forEach((column, i) => {
      expect(column).toEqual({
        entityId: null,
        label: COVER_PLACEHOLDER_LABELS[i],
        state: null,
        isPlaceholder: true,
        positionPct: null, // issue #57 (T2): placeholders have no position
        thumbTopPct: null, // issue #76: nothing to derive for placeholders
      })
    })
  })

  it('maps one configured cover and pads the second column with a placeholder', () => {
    const section = buildCoverSection([
      entity({ entityId: 'cover.wohnzimmer', domain: 'cover', label: 'Rollo WZ', state: 'open' }),
    ])
    expect(section.isPlaceholder).toBe(false)
    expect(section.columns).toHaveLength(2)
    expect(section.columns[0]).toEqual({
      entityId: 'cover.wohnzimmer',
      label: 'Rollo WZ',
      state: 'open',
      isPlaceholder: false,
      positionPct: null, // issue #57 (T2): fixture cover reports no position
      thumbTopPct: null, // issue #76: unknown raw position → no derived offset
    })
    expect(section.columns[1].isPlaceholder).toBe(true)
    expect(section.columns[1].label).toBe('Esszimmer')
  })

  it('uses no placeholders for 2 configured covers (mockup layout)', () => {
    const section = buildCoverSection([
      entity({ entityId: 'cover.wz', domain: 'cover', state: 'open' }),
      entity({ entityId: 'cover.ess', domain: 'cover', state: 'closed' }),
    ])
    expect(section.isPlaceholder).toBe(false)
    expect(section.columns.every((c) => !c.isPlaceholder && c.entityId !== null)).toBe(true)
    expect(section.columns.map((c) => c.state)).toEqual(['open', 'closed'])
  })

  it('keeps MORE than 2 configured covers (columns grow)', () => {
    const section = buildCoverSection([
      entity({ entityId: 'cover.a', domain: 'cover' }),
      entity({ entityId: 'cover.b', domain: 'cover' }),
      entity({ entityId: 'cover.c', domain: 'cover' }),
    ])
    expect(section.isPlaceholder).toBe(false)
    expect(section.columns.map((c) => c.entityId)).toEqual(['cover.a', 'cover.b', 'cover.c'])
  })
})

describe('icon + position propagation (issue #57 T2)', () => {
  it('buildSceneRow carries the entity icon into real slots, null for placeholders and icon-less entities', () => {
    const row = buildSceneRow([
      entity({ entityId: 'scene.cosy', domain: 'scene', label: 'Cosy', icon: 'mdi:sofa' }),
      entity({ entityId: 'scene.normal', domain: 'scene', label: 'Normal' }),
    ])
    expect(row.map((slot) => slot.icon)).toEqual(['mdi:sofa', null, null])
  })

  it('buildLightGrid carries the entity icon into real tiles, null for placeholders and icon-less entities', () => {
    const grid = buildLightGrid([
      light('light.esstisch', { label: 'Esstisch', icon: 'mdi:ceiling-light' }),
      light('light.flur', { label: 'Flurlicht' }),
    ])
    expect(grid.map((tile) => tile.icon)).toEqual([
      'mdi:ceiling-light',
      null,
      null, // placeholder tiles never carry an icon
      null,
    ])
  })

  it('buildCoverSection carries the cover position into real columns, null for placeholders and position-less covers', () => {
    const section = buildCoverSection([
      entity({ entityId: 'cover.wz', domain: 'cover', label: 'WZ', positionPct: 42 }),
      entity({ entityId: 'cover.ess', domain: 'cover', label: 'Ess' }),
    ])
    expect(section.columns.map((column) => column.positionPct)).toEqual([42, null])
  })

  it('keeps positionPct raw and derives thumbTopPct = 100 - positionPct (issue #76)', () => {
    // device-verified inversion: the user's cover entity reports
    // current_position opposite to the HA convention (verified on device
    // 2026-09-25) — physically OPEN carries raw 100, physically CLOSED raw 0.
    // The model keeps the raw value UNCHANGED; only the derived display field
    // is inverted (null stays null).
    const section = buildCoverSection([
      entity({ entityId: 'cover.auf', domain: 'cover', label: 'Auf', positionPct: 100 }),
      entity({ entityId: 'cover.halb', domain: 'cover', label: 'Halb', positionPct: 42 }),
      entity({ entityId: 'cover.zu', domain: 'cover', label: 'Zu', positionPct: 0 }),
      entity({ entityId: 'cover.na', domain: 'cover', label: 'Na' }),
    ])
    expect(section.columns.map((column) => column.positionPct)).toEqual([100, 42, 0, null])
    // thumb at the TOP for an open cover (raw 100), BOTTOM when closed (raw 0)
    expect(section.columns.map((column) => column.thumbTopPct)).toEqual([0, 58, 100, null])
  })
})

describe('sceneMenuIcon (issue #57 T3)', () => {
  it('maps HA lightbulb / light family icons to the bulb tile icon', () => {
    expect(sceneMenuIcon('mdi:lightbulb', 'Abendstimmung')).toBe('bulb')
    expect(sceneMenuIcon('mdi:ceiling-light', 'Licht an')).toBe('bulb')
    expect(sceneMenuIcon('LIGHT', 'X')).toBe('bulb') // case-insensitive match
  })

  it('maps candle HA icons to the candle tile icon', () => {
    expect(sceneMenuIcon('mdi:candle', 'Abendstimmung')).toBe('candle')
  })

  it('maps moon / night HA icons to the moon tile icon', () => {
    expect(sceneMenuIcon('mdi:moon', 'Abendstimmung')).toBe('moon')
    expect(sceneMenuIcon('mdi:weather-night', 'Abendstimmung')).toBe('moon')
  })

  it('falls back to the curated label map when no HA icon is carried (null)', () => {
    expect(sceneMenuIcon(null, 'Cosy time')).toBe('candle')
    expect(sceneMenuIcon(null, 'Betti Zeit')).toBe('moon')
    // anything else — including the plain placeholder label — takes the bulb default
    expect(sceneMenuIcon(null, 'Normales Licht')).toBe('bulb')
  })

  it('applies the label fallback when the HA icon is an unrelated family', () => {
    expect(sceneMenuIcon('mdi:sofa', 'Cosy time')).toBe('candle')
    expect(sceneMenuIcon('mdi:sofa', 'Betti Zeit')).toBe('moon')
    expect(sceneMenuIcon('mdi:sofa', 'Abendstimmung')).toBe('bulb') // unknown -> default
  })

  it('prefers the HA icon family over the label (icon first, label second)', () => {
    expect(sceneMenuIcon('mdi:candle', 'Betti Zeit')).toBe('candle')
    expect(sceneMenuIcon('mdi:lightbulb', 'Cosy time')).toBe('bulb')
  })

  it('maps every placeholder label to its curated icon (no scenes configured)', () => {
    // SCENE_PLACEHOLDER_LABELS = ['Normales Licht', 'Cosy time', 'Betti Zeit']
    expect(sceneMenuIcon(null, SCENE_PLACEHOLDER_LABELS[0])).toBe('bulb')
    expect(sceneMenuIcon(null, SCENE_PLACEHOLDER_LABELS[1])).toBe('candle')
    expect(sceneMenuIcon(null, SCENE_PLACEHOLDER_LABELS[2])).toBe('moon')
  })
})

describe('lightMenuIcon (issue #57 T4)', () => {
  it('maps HA floor-lamp icon families to the lamp tile icon', () => {
    expect(lightMenuIcon('mdi:lamp-floor', 'X')).toBe('lamp')
    expect(lightMenuIcon('mdi:floor-lamp', 'X')).toBe('lamp') // substring, any order
  })

  it('maps HA spot / ceiling / downlight icon families to the spot tile icon', () => {
    expect(lightMenuIcon('mdi:spot', 'X')).toBe('spot')
    expect(lightMenuIcon('mdi:ceiling-light', 'X')).toBe('spot')
    expect(lightMenuIcon('mdi:wall-downlight', 'X')).toBe('spot')
  })

  it('maps HA pendant / hang icon families to the pendant tile icon', () => {
    expect(lightMenuIcon('mdi:pendant', 'X')).toBe('pendant')
    expect(lightMenuIcon('mdi:hanging-light', 'X')).toBe('pendant') // before 'light'
  })

  it('maps HA lightbulb / light icon families to the bulb tile icon (case-insensitive)', () => {
    expect(lightMenuIcon('mdi:lightbulb', 'X')).toBe('bulb')
    expect(lightMenuIcon('LIGHT', 'X')).toBe('bulb')
  })

  it('falls back to the curated label map when no HA icon is carried (null)', () => {
    expect(lightMenuIcon(null, 'Esstisch')).toBe('pendant')
    expect(lightMenuIcon(null, 'Stehlampen')).toBe('lamp')
    expect(lightMenuIcon(null, 'Stehlampe Gold')).toBe('lamp') // starts-with form
    expect(lightMenuIcon(null, 'Flurlicht')).toBe('spot')
    expect(lightMenuIcon(null, 'Treppenspots')).toBe('spot')
  })

  it('applies the label fallback when the HA icon is an unrelated family', () => {
    expect(lightMenuIcon('mdi:sofa', 'Esstisch')).toBe('pendant')
    expect(lightMenuIcon('mdi:sofa', 'Treppenspots')).toBe('spot')
    expect(lightMenuIcon('mdi:sofa', 'Deckenleuchte')).toBe('bulb') // unknown -> default
  })

  it('prefers the HA icon family over the label (icon first, label second)', () => {
    expect(lightMenuIcon('mdi:lamp-floor', 'Esstisch')).toBe('lamp')
    expect(lightMenuIcon('mdi:spot', 'Esstisch')).toBe('spot')
  })

  it('defaults to the bulb for an unknown icon AND an unknown label (incl. null)', () => {
    expect(lightMenuIcon(null, 'Unbekannt')).toBe('bulb')
    expect(lightMenuIcon('mdi:sofa', 'Unbekannt')).toBe('bulb')
  })

  it('maps every light placeholder label to its curated icon (no lights configured)', () => {
    // LIGHT_PLACEHOLDERS = Esstisch / Flurlicht / Stehlampen / Treppenspots
    for (const placeholder of LIGHT_PLACEHOLDERS) {
      const expected: Record<string, 'pendant' | 'lamp' | 'spot'> = {
        Esstisch: 'pendant',
        Flurlicht: 'spot',
        Stehlampen: 'lamp',
        Treppenspots: 'spot',
      }
      expect(lightMenuIcon(null, placeholder.label)).toBe(expected[placeholder.label])
    }
  })
})
