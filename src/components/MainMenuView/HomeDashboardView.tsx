// ticket 9.6 (Task B): the Home dashboard grid — the replacement for the Home
// content carousel. Three zones in fixed render order (top → bottom):
//   Z1 scene row   — horizontal buttons, icon above label
//   Z2 light grid  — 2-column CSS grid tiles: icon left, label, brightness
//                    bar with knob + % readout, An/Aus status
//   Z3 cover section — header ("Wohnzimmer und Esszimmer" / "Rollo Steuerung
//                    EG") above one column per cover, each with ^ / v buttons
//
// Rendering on top of the view models from ./homeDashboard (Task A). No
// store access — all actuation flows through the optional short-press
// callbacks (ticket 9.6 W2: onSceneTap / onLightTap / onCoverAction). Every
// interactive-looking node carries `data-entity-id` for REAL entities only
// (null → attribute omitted), and every placeholder node is marked
// `data-dashboard-placeholder="true"` + the .placeholder class; pressing a
// placeholder node still calls its callback (the parent ignores null
// entityIds) and shows this component's local inline toast.
//
// Focus chain (dial navigation): one linear index over ALL slots in render
// order — scenes[0..sceneRow) → lights[0..lightGrid) → cover columns
// [0..coverColumns). Slot COUNTS drive the offsets (placeholders are focus
// stops too): offset 1 = sceneRow.length, offset 2 = sceneRow.length +
// lightGrid.length. focusedIndex undefined / out of range → nothing focused.
// Fine dial scrolling behavior is W2/C — this task only applies the focus class.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './HomeDashboardView.module.scss'
import type { MenuIconName } from './mockData'
import { MenuIcon } from './MenuIcon'
import { buildCoverSection, buildLightGrid, buildSceneRow, classifyEntities } from './homeDashboard'
import type { CoverColumnModel, DashboardEntity, LightTileModel, SceneSlotModel } from './homeDashboard'

export interface HomeDashboardViewProps {
  // structurally satisfied by HomeEntityView (useHomeSelectedEntities, 9.3)
  entities: readonly DashboardEntity[]
  // linear index across the focus chain (scenes → lights → cover columns);
  // undefined = nothing focused
  focusedIndex?: number
  // ticket 9.6 W2: short-press callbacks (tap / dial confirm). Placeholder
  // models (entityId === null) are passed through too — the parent routes
  // them away (MainMenuView ignores null entityIds), while THIS component
  // shows its own inline toast for every placeholder press, independently of
  // the callbacks. All three are optional so the component stays renderable
  // without any interaction wiring
  onSceneTap?: (slot: SceneSlotModel) => void
  onLightTap?: (tile: LightTileModel) => void
  onCoverAction?: (column: CoverColumnModel, direction: 'up' | 'down') => void
}

// auto-dismiss window for the placeholder toast (~2 s)
const PLACEHOLDER_TOAST_MS = 2000

// fixed icon per zone — the entity data carries no icon attribute, so each
// zone uses one existing MenuIcon name (placeholders reuse the same icon).
// Covers deliberately get NO zone icon: their ^ / v buttons ARE the arrows in
// the mockup. MenuIconName has no light/arrow names, these are the closest
// existing fits (kept dumb + consistent — W2 may refine per entity later).
const SCENE_ICON: MenuIconName = 'home'
const LIGHT_ICON: MenuIconName = 'settings'

export function HomeDashboardView({
  entities,
  focusedIndex,
  onSceneTap,
  onLightTap,
  onCoverAction,
}: HomeDashboardViewProps) {
  // the three zone view models — the builders fill placeholder slots for
  // unmapped entities (see homeDashboard.ts), so the zones below always render
  const { sceneRow, lightGrid, coverSection } = useMemo(() => {
    const classified = classifyEntities(entities)
    return {
      sceneRow: buildSceneRow(classified.scenes),
      lightGrid: buildLightGrid(classified.lights),
      coverSection: buildCoverSection(classified.covers),
    }
  }, [entities])

  // linear focus chain: scenes → lights → cover columns. Out-of-range indices
  // focus nothing (the chain is as long as the rendered slots, which include
  // placeholders)
  let sceneFocus = -1
  let lightFocus = -1
  let coverFocus = -1
  if (focusedIndex !== undefined && focusedIndex >= 0) {
    if (focusedIndex < sceneRow.length) {
      sceneFocus = focusedIndex
    } else if (focusedIndex < sceneRow.length + lightGrid.length) {
      lightFocus = focusedIndex - sceneRow.length
    } else {
      coverFocus = focusedIndex - sceneRow.length - lightGrid.length
    }
  }

  // ticket 9.6 W2: placeholder-press feedback — a transient inline pill in
  // the dashboard root (one message at a time, auto-dismiss after ~2 s).
  // Component-local on purpose: no prop from MainMenuView is needed, because
  // the parent's callbacks ignore null entityIds and the toast fires here.
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const showPlaceholderToast = useCallback((label: string) => {
    setToast(`„${label}" ist noch nicht zugewiesen`)
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), PLACEHOLDER_TOAST_MS)
  }, [])
  useEffect(
    () => () => {
      if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  // short-press routing: placeholder nodes toast FIRST, then the callback
  // fires for every press (the parent skips null entityIds); real nodes just
  // pass their model through unchanged
  const handleSceneTap = (slot: SceneSlotModel) => {
    if (slot.isPlaceholder) showPlaceholderToast(slot.label)
    onSceneTap?.(slot)
  }
  const handleLightTap = (tile: LightTileModel) => {
    if (tile.isPlaceholder) showPlaceholderToast(tile.label)
    onLightTap?.(tile)
  }
  const handleCoverAction = (column: CoverColumnModel, direction: 'up' | 'down') => {
    if (column.isPlaceholder) showPlaceholderToast(column.label)
    onCoverAction?.(column, direction)
  }

  return (
    <div className={styles.root}>
      {/* ticket 9.6 W2: placeholder toast — absolute-positioned pill above the
          grid, so showing/hiding it never reflows the zones */}
      {toast !== null && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {/* Z1 — scene row */}
      <div className={styles.sceneRow}>
        {sceneRow.map((slot, i) => (
          <div
            key={slot.entityId ?? `scene-placeholder-${i}`}
            className={`${styles.sceneBtn}${slot.isPlaceholder ? ` ${styles.placeholder}` : ''}${
              i === sceneFocus ? ` ${styles.focused}` : ''
            }`}
            // real entities only — placeholders keep entityId null and the
            // attribute is omitted (a press toasts instead, see above)
            data-entity-id={slot.entityId}
            data-dashboard-placeholder={slot.isPlaceholder ? 'true' : undefined}
            onClick={() => handleSceneTap(slot)}
          >
            <MenuIcon name={SCENE_ICON} size={20} />
            <span className={styles.sceneLabel}>{slot.label}</span>
          </div>
        ))}
      </div>

      {/* Z2 — light grid (2-column CSS grid, flat slot list from Task A) */}
      <div className={styles.lightGrid}>
        {lightGrid.map((tile, i) => (
          <div
            key={tile.entityId ?? `light-placeholder-${i}`}
            className={`${styles.lightTile}${tile.isPlaceholder ? ` ${styles.placeholder}` : ''}${
              i === lightFocus ? ` ${styles.focused}` : ''
            }`}
            data-entity-id={tile.entityId}
            data-dashboard-placeholder={tile.isPlaceholder ? 'true' : undefined}
            onClick={() => handleLightTap(tile)}
          >
            <span className={styles.tileIcon}>
              <MenuIcon name={LIGHT_ICON} size={20} />
            </span>
            <div className={styles.tileBody}>
              <span className={styles.tileLabel}>{tile.label}</span>
              <div className={styles.tileReadout}>
                <span className={styles.brightnessBar}>
                  {tile.brightnessPct !== null && (
                    <>
                      <span
                        className={styles.brightnessFill}
                        style={{ width: `${tile.brightnessPct}%` }}
                      />
                      <span className={styles.knob} style={{ left: `${tile.brightnessPct}%` }} />
                    </>
                  )}
                </span>
                <span className={styles.stateCol}>
                  {tile.brightnessPct !== null && (
                    <span className={styles.pct}>{tile.brightnessPct}%</span>
                  )}
                  <span className={styles.state}>{tile.isOn ? 'An' : 'Aus'}</span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Z3 — cover section (header + one column per cover) */}
      <section
        className={`${styles.coverSection}${coverSection.isPlaceholder ? ` ${styles.placeholder}` : ''}`}
        // section-level marker: NO cover is mapped at all → the whole section
        // (header + columns) is mock content
        data-dashboard-placeholder={coverSection.isPlaceholder ? 'true' : undefined}
      >
        <div className={styles.coverHeader}>
          <span className={styles.coverTitle}>{coverSection.title}</span>
          <span className={styles.coverSubtitle}>{coverSection.subtitle}</span>
        </div>
        <div className={styles.coverColumns}>
          {coverSection.columns.map((col, i) => (
            <div
              key={col.entityId ?? `cover-placeholder-${i}`}
              className={`${styles.coverColumn}${col.isPlaceholder ? ` ${styles.placeholder}` : ''}${
                i === coverFocus ? ` ${styles.focused}` : ''
              }`}
              data-entity-id={col.entityId}
              data-dashboard-placeholder={col.isPlaceholder ? 'true' : undefined}
            >
              <span className={styles.coverLabel}>{col.label}</span>
              <span className={styles.coverBtns}>
                <span
                  className={styles.coverBtn}
                  data-cover-action="up"
                  onClick={() => handleCoverAction(col, 'up')}
                >
                  ^
                </span>
                <span
                  className={styles.coverBtn}
                  data-cover-action="down"
                  onClick={() => handleCoverAction(col, 'down')}
                >
                  v
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
