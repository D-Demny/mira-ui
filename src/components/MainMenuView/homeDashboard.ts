// ticket 9.6 W1: pure view-model builders for the Home dashboard grid (the
// replacement for the Home content carousel). Kept in a plain (non-component)
// module like carouselWindow.ts so HomeDashboardView.tsx keeps exporting only
// components (react-refresh) and the mapping math is directly unit-testable.
// READ-FREE: no DOM, no hooks, no store access — plain data in, render-ready
// view models out. Interaction wiring (scene activate / light toggle / cover
// up-down, long-press → HALightControlModal) is W2 and keys off the entityId
// carried here.

import type { MenuIconName } from './mockData'

// The input shape: exactly the fields these builders need, structurally
// satisfied by `HomeEntityView` (src/hooks/useHomeEntities.ts, ticket 9.3 —
// the output of useHomeSelectedEntities()) so the real carousel data can be
// passed straight in without copying or transforming it first. Deliberately
// NOT importing the hook's type: this module must stay free of React/store
// dependencies (react-refresh, testability).
export interface DashboardEntity {
  entityId: string
  domain: string
  label: string
  room?: string
  state: string | null
  active: boolean | null
  dimmable: boolean
  brightnessPct: number | null
  // issue #57 (T2): HA's attributes.icon passthrough (absent when the entity
  // reports no icon) + the clamped cover position 0–100 for covers only
  // (null for non-covers and covers without position support) — carried into
  // the zone models below; rendering them is the restyling task (T3)
  icon?: string
  positionPct: number | null
}

// ---------------------------------------------------------------- classification

// ticket 9.6: the three dashboard zones, by domain. Scenes ARE part of the
// 9.3 catalog (HOME_ENTITY_DOMAINS includes 'scene', ENTITY_SERVICES maps it
// to 'turn_on'), so any selected scene.* entity lands here — but there is no
// curated default scene yet, so in practice buildSceneRow() will usually fall
// back to its placeholders until the user selects scenes in the picker.
// Domains outside these three (switch / fan / input_boolean / media_player)
// are NOT part of the mockup layout and are dropped here — HomeDashboardView
// still holds the full entity list, so a later task can render them without
// re-deriving anything.
export interface ClassifiedHomeEntities {
  scenes: DashboardEntity[]
  lights: DashboardEntity[]
  covers: DashboardEntity[]
}

export function classifyEntities(entities: readonly DashboardEntity[]): ClassifiedHomeEntities {
  const scenes: DashboardEntity[] = []
  const lights: DashboardEntity[] = []
  const covers: DashboardEntity[] = []
  for (const entity of entities) {
    if (entity.domain === 'scene') scenes.push(entity)
    else if (entity.domain === 'light') lights.push(entity)
    else if (entity.domain === 'cover') covers.push(entity)
  }
  return { scenes, lights, covers }
}

// ---------------------------------------------------------------------- scene row

// the mockup's top row is exactly 3 buttons; with fewer (or no) configured
// scenes the remaining slots fall back to the default labels below, in slot
// order. More than 3 configured scenes: ALL are kept (row grows) instead of
// silently dropping user selections — the mockup size is a floor, not a cap.
export const SCENE_ROW_SIZE = 3

export const SCENE_PLACEHOLDER_LABELS: readonly string[] = [
  'Normales Licht',
  'Cosy time',
  'Betti Zeit',
]

// render-ready scene button. `entityId === null` marks a placeholder — the
// UI must style/mark it differently (Task B) and W2 toasts instead of
// activating when pressed. `icon` carries the real entity's HA icon through
// (issue #57 T2); placeholders have none → null (the zone restyling task T3
// decides what renders there).
export interface SceneSlotModel {
  entityId: string | null
  label: string
  isPlaceholder: boolean
  icon: string | null
}

export function buildSceneRow(scenes: readonly DashboardEntity[]): SceneSlotModel[] {
  const out: SceneSlotModel[] = scenes.map((scene) => ({
    entityId: scene.entityId,
    label: scene.label,
    isPlaceholder: false,
    icon: scene.icon ?? null,
  }))
  for (let i = scenes.length; i < SCENE_ROW_SIZE; i++) {
    out.push({
      entityId: null,
      label: SCENE_PLACEHOLDER_LABELS[i % SCENE_PLACEHOLDER_LABELS.length],
      isPlaceholder: true,
      icon: null,
    })
  }
  return out
}

// issue #57 T3: pick the tile icon for a scene slot (HomeDashboardView Z1).
// Priority: (a) the carried HA icon, matched against a small family table —
// HA scene icons are usually generic, so this is only a bonus signal;
// (b) the curated label map — the practical primary path. Anything unmatched
// (including every placeholder label except the two curated ones) falls back
// to the bulb default, which fits "Normales Licht" and most light scenes.
export function sceneMenuIcon(icon: string | null, label: string): MenuIconName {
  if (icon !== null) {
    const i = icon.toLowerCase()
    if (i.includes('candle')) return 'candle'
    if (i.includes('moon') || i.includes('night')) return 'moon'
    if (i.includes('lightbulb') || i.includes('light')) return 'bulb'
  }
  const l = label.toLowerCase()
  if (l.includes('cosy')) return 'candle'
  if (l.includes('betti')) return 'moon'
  return 'bulb'
}

// --------------------------------------------------------------------- light grid

// the mockup's middle zone is a 2x2 tile grid. Fewer than 4 configured lights
// → the remaining slots are filled with the placeholder tiles below (label +
// realistic default readout, in slot order); more than 4 → ALL are kept (the
// grid grows by rows) instead of truncating user selections. Placeholders are
// marked `dimmable: true` ON PURPOSE: the ticket wants long-press to open the
// HALightControlModal for dimmable lights AND light placeholders alike (W2).
export const LIGHT_GRID_SLOTS = 4

export const LIGHT_PLACEHOLDERS: readonly {
  label: string
  brightnessPct: number
  isOn: boolean
}[] = [
  { label: 'Esstisch', brightnessPct: 20, isOn: true },
  { label: 'Flurlicht', brightnessPct: 50, isOn: true },
  { label: 'Stehlampen', brightnessPct: 0, isOn: false },
  { label: 'Treppenspots', brightnessPct: 10, isOn: true },
]

// HA reports brightness as an integer 0–255 (null while off / unknown); the
// 9.3 view models already convert it to 0–100 via lightCapabilities, so this
// helper's job is null-safety + clamping: non-finite / out-of-range input
// must never reach the brightness bar (a NaN width would break the tile).
export function clampBrightnessPct(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.round(value)))
}

// render-ready 2x2 grid tile (flat slot list — the CSS grid in Task B does
// the 2-column wrapping). `brightnessPct` stays null when the light is off or
// reports no level: the UI then renders an empty bar + the An/Aus status only.
export interface LightTileModel {
  entityId: string | null
  label: string
  isOn: boolean
  brightnessPct: number | null
  // issue #60: true when the tile is OFF but still carries a known level —
  // the turn-off transition window. The optimistic flip (and HA itself) goes
  // 'off' first, but attributes.brightness only clears once the physical fade
  // settles (~1–2 s), so for that window the slider keeps rendering its last
  // level and must stay on the warm lit accent (.tileFadingOff), never the
  // green default fill. When HA clears the level, brightnessPct → null and
  // the bar empties into the neutral OFF track.
  fadingOff: boolean
  dimmable: boolean
  isPlaceholder: boolean
  icon: string | null
}

export function buildLightGrid(lights: readonly DashboardEntity[]): LightTileModel[] {
  const count = Math.max(LIGHT_GRID_SLOTS, lights.length)
  const out: LightTileModel[] = []
  for (let i = 0; i < count; i++) {
    const light = lights[i]
    if (light !== undefined) {
      // `active` is null while the state is unknown → render as off
      const isOn = light.active === true
      const brightnessPct = clampBrightnessPct(light.brightnessPct)
      out.push({
        entityId: light.entityId,
        label: light.label,
        isOn,
        brightnessPct,
        // issue #60: off + level known = the turn-off transition window (the
        // stale attributes.brightness lingers until HA confirms 'off') — the
        // slider keeps its last level ON THE WARM ACCENT for that window
        fadingOff: !isOn && brightnessPct !== null,
        dimmable: light.dimmable,
        isPlaceholder: false,
        icon: light.icon ?? null,
      })
    } else {
      const placeholder = LIGHT_PLACEHOLDERS[i % LIGHT_PLACEHOLDERS.length]
      out.push({
        entityId: null,
        label: placeholder.label,
        isOn: placeholder.isOn,
        brightnessPct: placeholder.brightnessPct,
        // issue #60: placeholders are static mock content — they never enter a
        // turn-off transition, so the warm-accent marker stays off (the
        // Stehlampen mock keeps its muted empty bar)
        fadingOff: false,
        dimmable: true,
        isPlaceholder: true,
        icon: null,
      })
    }
  }
  return out
}

// issue #57 T4: pick the tile icon for a light grid slot (HomeDashboardView
// Z2). Priority — (a) the carried HA icon, matched against a small family
// table (lowercased substring, in this order so e.g. 'ceiling-light' hits the
// spot branch BEFORE the generic light/bulb branch):
//   contains 'floor'                      -> lamp      (mdi:lamp-floor, ...)
//   contains 'spot' | 'ceiling' |
//                                            'downlight'     -> spot
//   contains 'pendant' | 'hang'           -> pendant
//   contains 'lightbulb' | 'light'        -> bulb
// then (b) the curated label map (lowercased), which is the practical primary
// path for placeholder tiles that carry no HA icon at all:
//   contains 'esstisch'                   -> pendant
//   contains 'stehlampen' | starts with
//                                            'stehlampe'       -> lamp
//   contains 'flurlicht'                  -> spot
//   contains 'treppen' | 'spot'           -> spot
// Anything unmatched (including null icon + unknown label) falls back to the
// bulb default — the generic light, fitting most remaining fixtures.
export function lightMenuIcon(icon: string | null, label: string): MenuIconName {
  if (icon !== null) {
    const i = icon.toLowerCase()
    if (i.includes('floor')) return 'lamp'
    if (i.includes('spot') || i.includes('ceiling') || i.includes('downlight')) return 'spot'
    if (i.includes('pendant') || i.includes('hang')) return 'pendant'
    if (i.includes('lightbulb') || i.includes('light')) return 'bulb'
  }
  const l = label.toLowerCase()
  if (l.includes('esstisch')) return 'pendant'
  if (l.includes('stehlampen') || l.startsWith('stehlampe')) return 'lamp'
  if (l.includes('flurlicht')) return 'spot'
  if (l.includes('treppen') || l.includes('spot')) return 'spot'
  return 'bulb'
}

// ---------------------------------------------------------------- cover section

// the mockup's bottom zone: one header ("Wohnzimmer und Esszimmer" / "Rollo
// Steuerung EG") above 2 columns, each with up (^) / down (v) controls. The
// same header serves the placeholder case AND the mapped case (it names the
// ground-floor roller area, not the entity list). Fewer than 2 configured
// covers → the remaining columns are filled with the default labels; more
// than 2 → ALL are kept (columns grow), placeholders never truncate.
export const COVER_SECTION_TITLE = 'Wohnzimmer und Esszimmer'
export const COVER_SECTION_SUBTITLE = 'Rollo Steuerung EG'
export const COVER_COLUMN_SIZE = 2

export const COVER_PLACEHOLDER_LABELS: readonly string[] = ['Wohnzimmer', 'Esszimmer']

// one control column. `state` (e.g. 'open' / 'closed' / 'opening') stays as
// the raw HA state string — W2 maps it to the up/down visual + stop handling.
// `positionPct` is the clamped 0–100 cover position (issue #57 T2), carried
// through UNCHANGED from HA's attributes.current_position: 0 = fully open
// ("Auf", TOP of the slider track), 100 = fully closed ("Zu", BOTTOM) — the
// thumb renders it at exactly `top: positionPct%`, so it always lines up with
// its own scale mark (issue #63). Null for placeholders and covers without
// position support (no thumb).
export interface CoverColumnModel {
  entityId: string | null
  label: string
  state: string | null
  isPlaceholder: boolean
  positionPct: number | null
}

// `isPlaceholder` on the SECTION itself: true = no cover is mapped at all, so
// Task B marks the whole section (header + both columns) as mock content.
export interface CoverSectionModel {
  title: string
  subtitle: string
  columns: CoverColumnModel[]
  isPlaceholder: boolean
}

export function buildCoverSection(covers: readonly DashboardEntity[]): CoverSectionModel {
  const count = Math.max(COVER_COLUMN_SIZE, covers.length)
  const columns: CoverColumnModel[] = []
  for (let i = 0; i < count; i++) {
    const cover = covers[i]
    if (cover !== undefined) {
      columns.push({
        entityId: cover.entityId,
        label: cover.label,
        state: cover.state,
        isPlaceholder: false,
        positionPct: cover.positionPct,
      })
    } else {
      columns.push({
        entityId: null,
        label: COVER_PLACEHOLDER_LABELS[i % COVER_PLACEHOLDER_LABELS.length],
        state: null,
        isPlaceholder: true,
        positionPct: null,
      })
    }
  }
  return {
    title: COVER_SECTION_TITLE,
    subtitle: COVER_SECTION_SUBTITLE,
    columns,
    isPlaceholder: covers.length === 0,
  }
}
