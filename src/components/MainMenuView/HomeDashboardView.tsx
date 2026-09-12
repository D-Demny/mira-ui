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
// ticket 9.6 W2-4: fine dial scrolling — a useLayoutEffect on focusedIndex
// scrolls the focused slot into view when the grid overflows its container
// (the ContentCarousel house pattern, zero-geometry fallback included).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import styles from './HomeDashboardView.module.scss'
import type { MenuIconName } from './mockData'
import { MenuIcon } from './MenuIcon'
import { buildCoverSection, buildLightGrid, buildSceneRow, classifyEntities } from './homeDashboard'
import type {
  CoverColumnModel,
  DashboardEntity,
  LightTileModel,
  SceneSlotModel,
} from './homeDashboard'

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
  // ticket 9.6 W2-3a: touch hold (pointer held ≥ CARD_HOLD_MS, pattern ported
  // from ContentCarousel). A light tile is holdable ONLY when dimmable
  // (placeholders are dimmable by design); BOTH ^ and v buttons of a cover
  // column trigger the column hold. A fired hold suppresses the short-press
  // callback for that same press. Both optional — without them the component
  // keeps plain W2-2 tap behavior.
  onLightHold?: (tile: LightTileModel) => void
  onCoverHold?: (column: CoverColumnModel) => void
}

// auto-dismiss window for the placeholder toast (~2 s)
const PLACEHOLDER_TOAST_MS = 2000

// ticket 9.6 W2-3a: pointer movement beyond this distance cancels the hold —
// a drag/swipe is never a hold (same value as ContentCarousel's CARD_HOLD_SLOP_PX)
const HOLD_SLOP_PX = 10

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
  onLightHold,
  onCoverHold,
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

  // ticket 9.6 W2-4: fine dial navigation — per-slot DOM node registry, keyed
  // by the LINEAR focus-chain index (scene i → i; light i → sceneRow.length + i;
  // cover i → sceneRow.length + lightGrid.length + i). Refs attach in the same
  // .map() render paths as the zones below.
  const gridRef = useRef<HTMLDivElement>(null)
  const slotEls = useRef(new Map<number, HTMLElement>())
  const setSlotEl = (index: number, el: HTMLElement | null) => {
    if (el) {
      slotEls.current.set(index, el)
    } else {
      slotEls.current.delete(index)
    }
  }

  // keep the focused slot visible while the dial rotates across the grid —
  // mirrors the ContentCarousel house pattern (useLayoutEffect on focusedIndex:
  // same frame as the .focused class commit; instant 'auto' behavior for dial
  // ticks). The grid itself never scrolls (.root is a plain column, the app
  // shell clips), so containment is checked against the hosting container —
  // MainMenuView's content pane in production, the test wrapper in jsdom.
  // Zero-geometry environments (jsdom / first paint pending) fall back to the
  // native call exactly like the carousel's zero-viewport branch.
  useLayoutEffect(() => {
    if (focusedIndex === undefined) return
    const slot = slotEls.current.get(focusedIndex)
    const grid = gridRef.current
    if (!slot || !grid) return
    const container = grid.parentElement ?? grid
    if (container.clientWidth <= 0 || container.clientHeight <= 0) {
      slot.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
      return
    }
    const cRect = container.getBoundingClientRect()
    const sRect = slot.getBoundingClientRect()
    const inside =
      sRect.top >= cRect.top &&
      sRect.bottom <= cRect.bottom &&
      sRect.left >= cRect.left &&
      sRect.right <= cRect.right
    if (!inside) {
      slot.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
    }
  }, [focusedIndex, sceneRow, lightGrid, coverSection])

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

  // ticket 9.6 W2-3a: touch hold — the pointer-hold pattern ported from
  // ContentCarousel (CARD_HOLD_MS from @/hooks/useHardwareButtons):
  // pointerdown arms the timer, pointerup/cancel before the deadline leaves it
  // a short press, movement beyond HOLD_SLOP_PX cancels it (a swipe is never a
  // hold). A fired hold sets `held`, which suppresses the browser click that
  // follows the long press for THAT SAME press (every fresh press resets the
  // flag on its pointerdown). The tiles/buttons are inline .map() nodes
  // without their own hooks, so the per-slot state lives in one ref map keyed
  // by slot. Lights hold only when dimmable (placeholders included — they are
  // dimmable by design); both ^/v cover buttons hold their column. When the
  // matching callback prop is absent (or the tile is not dimmable) no pointer
  // handlers attach and W2-2 short-press behavior stays untouched.
  const holdStateRef = useRef<
    Map<
      string,
      { timer: number | undefined; origin: { x: number; y: number } | null; held: boolean }
    >
  >(new Map())

  // an unmount with a timer still armed must not fire the hold later
  useEffect(() => {
    const states = holdStateRef.current
    return () => {
      for (const s of states.values()) {
        if (s.timer !== undefined) window.clearTimeout(s.timer)
      }
    }
  }, [])

  const getHoldState = (key: string) => {
    let s = holdStateRef.current.get(key)
    if (!s) {
      s = { timer: undefined, origin: null, held: false }
      holdStateRef.current.set(key, s)
    }
    return s
  }

  const startHold = (key: string, e: React.PointerEvent, onHold: () => void) => {
    const s = getHoldState(key)
    // a fresh press clears any stale suppression flag and re-arms the timer
    s.held = false
    if (s.timer !== undefined) {
      window.clearTimeout(s.timer)
      s.timer = undefined
    }
    s.origin = { x: e.clientX, y: e.clientY }
    s.timer = window.setTimeout(() => {
      s.timer = undefined
      s.held = true
      onHold()
    }, CARD_HOLD_MS)
  }

  const moveHold = (key: string, e: React.PointerEvent) => {
    const s = holdStateRef.current.get(key)
    if (!s || s.timer === undefined) return
    const origin = s.origin
    if (
      origin &&
      (Math.abs(e.clientX - origin.x) > HOLD_SLOP_PX ||
        Math.abs(e.clientY - origin.y) > HOLD_SLOP_PX)
    ) {
      window.clearTimeout(s.timer)
      s.timer = undefined
      s.origin = null
    }
  }

  const releaseHold = (key: string) => {
    const s = holdStateRef.current.get(key)
    if (!s) return
    if (s.timer !== undefined) {
      window.clearTimeout(s.timer)
      s.timer = undefined
    }
    s.origin = null
  }

  // true → this click is the follow-up of a just-fired hold: suppress it
  const isHeldClick = (key: string): boolean => {
    const s = holdStateRef.current.get(key)
    if (s?.held) {
      s.held = false
      return true
    }
    return false
  }

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
    <div className={styles.root} ref={gridRef}>
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
            // W2-4: focus-chain registry (scene slots occupy chain indices 0..sceneRow)
            ref={(el) => setSlotEl(i, el)}
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
            // W2-4: focus-chain registry (lights start after the scene row)
            ref={(el) => setSlotEl(sceneRow.length + i, el)}
            className={`${styles.lightTile}${tile.isPlaceholder ? ` ${styles.placeholder}` : ''}${
              i === lightFocus ? ` ${styles.focused}` : ''
            }`}
            data-entity-id={tile.entityId}
            data-dashboard-placeholder={tile.isPlaceholder ? 'true' : undefined}
            // W2-3a: holdable ONLY when dimmable — placeholders are dimmable by
            // design, so they hold too (the parent routes the null-entity model)
            onPointerDown={
              tile.dimmable
                ? (e) => startHold(`light-${i}`, e, () => onLightHold?.(tile))
                : undefined
            }
            onPointerMove={tile.dimmable ? (e) => moveHold(`light-${i}`, e) : undefined}
            onPointerUp={tile.dimmable ? () => releaseHold(`light-${i}`) : undefined}
            onPointerCancel={tile.dimmable ? () => releaseHold(`light-${i}`) : undefined}
            onClick={() => {
              if (isHeldClick(`light-${i}`)) return // the hold already handled it
              handleLightTap(tile)
            }}
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
              // W2-4: focus-chain registry (covers start after scenes + lights)
              ref={(el) => setSlotEl(sceneRow.length + lightGrid.length + i, el)}
              className={`${styles.coverColumn}${col.isPlaceholder ? ` ${styles.placeholder}` : ''}${
                i === coverFocus ? ` ${styles.focused}` : ''
              }`}
              data-entity-id={col.entityId}
              data-dashboard-placeholder={col.isPlaceholder ? 'true' : undefined}
            >
              <span className={styles.coverLabel}>{col.label}</span>
              <span className={styles.coverBtns}>
                {/* W2-3a: BOTH ^ and v trigger the COLUMN hold (same key) — the
                    hold is per cover, not per button; a fired hold suppresses
                    the short-press of that same press on either button */}
                <span
                  className={styles.coverBtn}
                  data-cover-action="up"
                  onPointerDown={(e) =>
                    startHold(`cover-${i}`, e, () => {
                      // W2-3: a placeholder column hold reuses the W2-2 toast
                      // (the parent's onCoverHold is a no-op for these columns)
                      if (col.isPlaceholder) showPlaceholderToast(col.label)
                      onCoverHold?.(col)
                    })
                  }
                  onPointerMove={(e) => moveHold(`cover-${i}`, e)}
                  onPointerUp={() => releaseHold(`cover-${i}`)}
                  onPointerCancel={() => releaseHold(`cover-${i}`)}
                  onClick={() => {
                    if (isHeldClick(`cover-${i}`)) return // the hold already handled it
                    handleCoverAction(col, 'up')
                  }}
                >
                  ^
                </span>
                <span
                  className={styles.coverBtn}
                  data-cover-action="down"
                  onPointerDown={(e) =>
                    startHold(`cover-${i}`, e, () => {
                      // W2-3: a placeholder column hold reuses the W2-2 toast
                      // (the parent's onCoverHold is a no-op for these columns)
                      if (col.isPlaceholder) showPlaceholderToast(col.label)
                      onCoverHold?.(col)
                    })
                  }
                  onPointerMove={(e) => moveHold(`cover-${i}`, e)}
                  onPointerUp={() => releaseHold(`cover-${i}`)}
                  onPointerCancel={() => releaseHold(`cover-${i}`)}
                  onClick={() => {
                    if (isHeldClick(`cover-${i}`)) return // the hold already handled it
                    handleCoverAction(col, 'down')
                  }}
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
