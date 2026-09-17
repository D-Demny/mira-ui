// ticket 9.6 (Task B): the Home dashboard grid — the replacement for the Home
// content carousel. Zones in fixed render order (top → bottom), each rendered
// ONLY when at least one real entity is configured for it (issue #48: an
// empty zone would otherwise show pure placeholder mock content):
//   Z1 scene row   — horizontal buttons, icon above label (hidden w/o scenes)
//   Z2 light grid  — 2-column CSS grid tiles: icon left, label, brightness
//                    bar with knob + % readout, An/Aus status. Always rendered
//                    (0 lights → the full placeholder tile set, by design)
//   Z3 cover section — header ("Wohnzimmer und Esszimmer" / "Rollo Steuerung
//                    EG") above one column per cover, each with ^ / v buttons
//                    (hidden w/o covers)
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
// Focus chain (dial navigation): one linear index over ALL RENDERED slots in
// order — scenes[0..sceneRow) → lights[0..lightGrid) → cover columns
// [0..coverColumns). Slot COUNTS drive the offsets (placeholders are focus
// stops too): offset 1 = sceneRow.length, offset 2 = sceneRow.length +
// lightGrid.length. issue #48: a suppressed zone has length 0, so its slots
// drop out of the chain and the remaining zones shift up automatically.
// focusedIndex undefined / out of range → nothing focused.
// ticket 9.6 W2-4 + issue #45: fine dial scrolling — the dashboard carries
// its OWN vertical scroll port (.scroller, the SettingsList idiom) because
// the hosting content pane is overflow:hidden: touch did nothing and dial
// had to nudge that hidden pane via scrollIntoView (reliable down, stuck up
// on CR69). A useLayoutEffect on focusedIndex scrolls the focused slot into
// view when it escapes the scroller's containment; zero-geometry fallback
// included.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import styles from './HomeDashboardView.module.scss'
import type { MenuIconName } from './mockData'
import { MenuIcon } from './MenuIcon'
import {
  buildCoverSection,
  buildLightGrid,
  buildSceneRow,
  classifyEntities,
  sceneMenuIcon,
} from './homeDashboard'
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
  // issue #57 T1: tap → dial focus handoff — a SHORT tap on any rendered slot
  // (placeholder included) reports that slot's LINEAR chain index (scene i;
  // light sceneRow.length + i; cover sceneRow.length + lightGrid.length + i),
  // so the parent can re-root the dial on it and the next turn continues from
  // the tapped slot. Optional — without it taps keep plain W2-2 behavior
  // (actuate only, no focus move).
  onSlotTapped?: (index: number) => void
  // issue #57 T1: touch-scroll → focus reset — a REAL finger scroll of the
  // scroller (content movement beyond ~10 px; a plain tap never triggers it)
  // fires this ONCE per touch, so the parent can clear the dial focus
  // (focusedIndex → undefined) until the next dial tick or slot tap. Optional
  // — without it the component's internal tracking still runs but is a no-op.
  onTouchScroll?: () => void
}

// auto-dismiss window for the placeholder toast (~2 s)
const PLACEHOLDER_TOAST_MS = 2000

// ticket 9.6 W2-3a: pointer movement beyond this distance cancels the hold —
// a drag/swipe is never a hold (same value as ContentCarousel's CARD_HOLD_SLOP_PX)
const HOLD_SLOP_PX = 10

// issue #57 T1: touch movement beyond this distance counts as a real scroll
// rather than a tap — same scale as HOLD_SLOP_PX. Two independent signals feed
// it: pointermove travel AND the scroller's scrollTop delta (measured against
// the pointerdown position). The second one matters because on CR69 mobile
// the browser takes over the pan early, fires pointercancel and stops
// delivering pointermove — but the scroll event keeps firing, so the scrollTop
// delta is the only reliable movement signal on that path.
const TOUCH_SCROLL_SLOP_PX = 10

// issue #57 T1: a touch session expires this long after the last scroll step
// — a pointercancel may not be followed by a pointerup for that pointer, so an
// abandoned session must die on its own (400 ms is well past a natural
// finger-lift and well before any deliberate dial-driven scroll follows)
const TOUCH_SCROLL_IDLE_MS = 400

// issue #57 T3: scene slots get their icon CONTEXTUALLY — sceneMenuIcon()
// (homeDashboard.ts) maps the slot's carried HA icon onto a tile icon, with a
// curated per-label fallback (HA scene icons are usually generic). The light
// grid keeps one fixed zone icon; covers deliberately get NO zone icon: their
// ^ / v buttons ARE the arrows in the mockup.
const LIGHT_ICON: MenuIconName = 'settings'

export function HomeDashboardView({
  entities,
  focusedIndex,
  onSceneTap,
  onLightTap,
  onCoverAction,
  onLightHold,
  onCoverHold,
  onSlotTapped,
  onTouchScroll,
}: HomeDashboardViewProps) {
  // the zone view models — issue #48: a zone renders ONLY when at least one
  // real entity is configured for it; with zero entities the builders'
  // placeholder fill would be pure mock content, so the whole zone (row /
  // section) is suppressed. Lights stay unconditional by design (the grid
  // always shows, filling with placeholder tiles). The same suppression must
  // be mirrored in MainMenuView's homeDashboard model (dial stop count +
  // confirm/hold routing), which runs the identical builders.
  const { sceneRow, lightGrid, coverSection } = useMemo(() => {
    const classified = classifyEntities(entities)
    return {
      // zero scenes → no row at all (no buttons, no space)
      sceneRow: classified.scenes.length === 0 ? [] : buildSceneRow(classified.scenes),
      lightGrid: buildLightGrid(classified.lights),
      // zero covers → no section at all (no header, no columns); the spread
      // keeps the CoverSectionModel shape for the (unrendered) fallback
      coverSection:
        classified.covers.length === 0
          ? { ...buildCoverSection(classified.covers), columns: [] }
          : buildCoverSection(classified.covers),
    }
  }, [entities])

  // linear focus chain over the RENDERED zones: scenes → lights → cover
  // columns (suppressed zones have length 0 and drop out, issue #48).
  // Out-of-range indices focus nothing (the chain is as long as the rendered
  // slots, which include placeholders)
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

  // keep the focused slot visible while the dial rotates across the dashboard —
  // issue #45: gridRef now points at .scroller, the dashboard's own vertical
  // scroll port (SettingsList idiom), so containment is checked against the
  // scroller ITSELF instead of the hosting container (the old hidden pane).
  // Same frame as the .focused class commit; instant 'auto' behavior for dial
  // ticks now works bidirectionally on CR69, because the scrolled element is a
  // real overflow:auto port (the hidden content pane stuck scrolling upward).
  // Zero-geometry environments (jsdom / first paint pending) fall back to the
  // native call exactly like the carousel's zero-viewport branch.
  useLayoutEffect(() => {
    if (focusedIndex === undefined) return
    const slot = slotEls.current.get(focusedIndex)
    const grid = gridRef.current
    if (!slot || !grid) return
    // issue #45: the scroller IS the scroll port — no parentElement indirection
    const container = grid
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

  // issue #57 T1: touch-scroll → focus-reset tracking. One session per touch
  // (pointerdown on the scroller → pointerup), with TWO independent movement
  // signals feeding TOUCH_SCROLL_SLOP_PX:
  //   (a) pointermove travel — works while the browser hasn't taken over the
  //       pan yet;
  //   (b) scroller scrollTop delta vs the pointerdown position — the ONLY
  //       signal left on CR69 mobile, where an early pointercancel stops
  //       pointermove but the scroll event keeps firing.
  // Exactly ONE onTouchScroll per session (`fired`). pointercancel does NOT end
  // the session deliberately (that is precisely when signal b takes over); an
  // idle-expiry timer kills abandoned sessions after TOUCH_SCROLL_IDLE_MS.
  const touchScrollRef = useRef<{
    originTop: number
    originX: number
    originY: number
    moved: boolean
    fired: boolean
    expireTimer: number | undefined
  } | null>(null)

  // end the current session (pointerup, expiry, or unmount): clear the idle
  // timer and mark it consumed so no later step of that touch can re-fire
  const endTouchScrollSession = useCallback(() => {
    const s = touchScrollRef.current
    if (!s) return
    if (s.expireTimer !== undefined) {
      window.clearTimeout(s.expireTimer)
      s.expireTimer = undefined
    }
    s.moved = false
    s.fired = true
  }, [])

  // an unmount mid-session must not leave the idle timer running
  useEffect(() => () => endTouchScrollSession(), [endTouchScrollSession])

  const handleScrollerPointerDown = (e: React.PointerEvent) => {
    const scroller = gridRef.current
    if (!scroller) return
    endTouchScrollSession() // a fresh press always starts a FRESH session
    touchScrollRef.current = {
      originTop: scroller.scrollTop,
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
      fired: false,
      expireTimer: undefined,
    }
  }

  const handleScrollerPointerMove = (e: React.PointerEvent) => {
    const s = touchScrollRef.current
    if (!s || s.moved) return
    // signal (a): finger travel beyond the slop counts as a scroll attempt
    if (
      Math.abs(e.clientX - s.originX) > TOUCH_SCROLL_SLOP_PX ||
      Math.abs(e.clientY - s.originY) > TOUCH_SCROLL_SLOP_PX
    ) {
      s.moved = true
    }
  }

  const handleScrollerScroll = () => {
    const s = touchScrollRef.current
    const scroller = gridRef.current
    if (!s || s.fired || !scroller) return
    // signal (b): the content itself moved beyond the slop. Only an ACTIVE
    // session qualifies — a dial-driven scrollIntoView has no pointerdown, so
    // it never resets the focus (that is exactly what we want: the dial must
    // keep its focus while it walks the chain).
    if (s.moved || Math.abs(scroller.scrollTop - s.originTop) > TOUCH_SCROLL_SLOP_PX) {
      s.fired = true
      onTouchScroll?.()
    } else {
      return // sub-slop drift (e.g. a tap jitter): stay silent
    }
    // refresh the idle expiry — every scroll step extends the session window,
    // and after TOUCH_SCROLL_IDLE_MS without further steps the session dies
    if (s.expireTimer !== undefined) window.clearTimeout(s.expireTimer)
    s.expireTimer = window.setTimeout(() => endTouchScrollSession(), TOUCH_SCROLL_IDLE_MS)
  }

  const handleScrollerPointerUp = () => {
    endTouchScrollSession()
  }

  // short-press routing: placeholder nodes toast FIRST, then the callback
  // fires for every press (the parent skips null entityIds); real nodes just
  // pass their model through unchanged. issue #57 T1: a SHORT tap also reports
  // the slot's LINEAR chain index via onSlotTapped so the parent can re-root
  // the dial there — the index is computed by the caller (each zone knows its
  // own offset in the chain).
  const handleSceneTap = (slot: SceneSlotModel, index: number) => {
    if (slot.isPlaceholder) showPlaceholderToast(slot.label)
    onSceneTap?.(slot)
    onSlotTapped?.(index)
  }
  const handleLightTap = (tile: LightTileModel, index: number) => {
    if (tile.isPlaceholder) showPlaceholderToast(tile.label)
    onLightTap?.(tile)
    onSlotTapped?.(index)
  }
  const handleCoverAction = (column: CoverColumnModel, direction: 'up' | 'down', index: number) => {
    if (column.isPlaceholder) showPlaceholderToast(column.label)
    onCoverAction?.(column, direction)
    onSlotTapped?.(index)
  }

  return (
    <div className={styles.root}>
      {/* ticket 9.6 W2: placeholder toast — absolute-positioned pill above the
          zones, a SIBLING of the scroller (pinned to .root), so showing/hiding
          it never reflows or scrolls with the content */}
      {toast !== null && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {/* issue #45: .scroller — the dashboard's own vertical scroll port.
          Wraps ONLY the three zones below; the toast stays pinned outside it */}
      {/* issue #57 T1: pointer+scroll tracking on the scroller itself — a real
          finger scroll (beyond slop, one of the two signals above) resets the
          dial focus via onTouchScroll; a tap and a dial scroll never do */}
      <div
        className={styles.scroller}
        data-home-scroller="true"
        ref={gridRef}
        onPointerDown={handleScrollerPointerDown}
        onPointerMove={handleScrollerPointerMove}
        onPointerUp={handleScrollerPointerUp}
        onScroll={handleScrollerScroll}
      >
        {/* Z1 — scene row (issue #48: rendered only when real scenes exist) */}
        {sceneRow.length > 0 && (
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
                // issue #57 T1: scene slots occupy chain indices 0..sceneRow
                onClick={() => handleSceneTap(slot, i)}
              >
                // issue #57 T3: per-slot icon (HA icon first, then label map)
                <MenuIcon name={sceneMenuIcon(slot.icon, slot.label)} size={20} />
                <span className={styles.sceneLabel}>{slot.label}</span>
              </div>
            ))}
          </div>
        )}

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
                // issue #57 T1: lights start after the scene row
                handleLightTap(tile, sceneRow.length + i)
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

        {/* Z3 — cover section (issue #48: rendered only when real covers exist) */}
        {coverSection.columns.length > 0 && (
          <section
            className={`${styles.coverSection}${coverSection.isPlaceholder ? ` ${styles.placeholder}` : ''}`}
            // section-level marker: the zero-cover case (isPlaceholder true) is
            // never rendered anymore (issue #48) — kept for model parity
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
                        // issue #57 T1: covers start after scenes + lights
                        handleCoverAction(col, 'up', sceneRow.length + lightGrid.length + i)
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
                        // issue #57 T1: covers start after scenes + lights
                        handleCoverAction(col, 'down', sceneRow.length + lightGrid.length + i)
                      }}
                    >
                      v
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
