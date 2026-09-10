import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import type { MenuCard } from './mockData'
import { carouselCardAreEqual } from './carouselCardCompare'
import type { CarouselCardProps } from './carouselCardCompare'
import {
  ANIM_SETTLE_MS,
  CAROUSEL_EDGE_PADDING,
  dialScrollLeft,
  leadingSpacerWidth,
  sidebarOverlap,
  sidebarOverlapAt,
  trailingSpacerWidth,
  windowRange,
  type CarouselGeometry,
  type ScrollMetrics,
} from './carouselWindow'
import styles from './ContentCarousel.module.scss'

// cover art size for carousel cards (bug2: was 200, reduced for breathing room)
const CARD_ART_SIZE = 170

// bug58 T3: no card blurred — the shared empty set when underflowPx is 0
// (the three legacy menu backgrounds) or no focus/viewport is available yet
const NO_BLUR = new Set<number>()

// bug53: pointer movement beyond this distance cancels the hold — a
// drag/swipe (useSwipeGestures territory) is never a hold and must not open
// the dim view
const CARD_HOLD_SLOP_PX = 10

function CarouselCardImpl({
  card,
  index,
  isFocused,
  blurred = false,
  interactive,
  onCardTap,
  onCardHold,
  registerRef,
  registerCardEl,
}: CarouselCardProps) {
  // bug59: the article element serves two ref owners — the focused-card ref
  // (scrollIntoView, focus only) and the parent's per-index registry (the
  // live-blur rAF loop). One stable callback instead of an inline arrow so
  // React does NOT detach/reattach on every card re-render (a changing ref
  // identity fires null+el on each commit — pure churn for the registry).
  // registerCardEl is ONE stable parent callback (empty deps, never compared
  // by the memo comparator) — `index` is this card's own prop, so no
  // per-index closure cache lives in the parent; isFocused flips at most
  // twice per dial tick.
  const attachRef = useCallback(
    (el: HTMLElement | null) => {
      if (isFocused) registerRef?.(el)
      registerCardEl?.(index, el)
    },
    [isFocused, index, registerRef, registerCardEl],
  )
  // bug53: touch hold detection — pointerdown arms the CARD_HOLD_MS timer,
  // pointerup/cancel before the deadline leaves it a tap, movement beyond
  // the slop cancels it. The heldRef flag suppresses the browser `click`
  // that follows a long press (CR69 note: PointerEvents are fine on Chrome
  // 55+ — the codebase already uses them; pointer capture is NOT needed
  // here)
  const holdTimerRef = useRef<number | undefined>(undefined)
  const holdOriginRef = useRef<{ x: number; y: number } | null>(null)
  const heldRef = useRef(false)

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = undefined
    }
  }

  // an unmount with the timer still armed must not fire the hold later
  useEffect(() => clearHoldTimer, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    // a fresh press clears any stale suppression flag (a hold whose follow-up
    // click never arrived, e.g. the pointer left the element)
    heldRef.current = false
    clearHoldTimer()
    holdOriginRef.current = { x: e.clientX, y: e.clientY }
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = undefined
      heldRef.current = true
      onCardHold?.(card, index)
    }, CARD_HOLD_MS)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (holdTimerRef.current == null) return
    const origin = holdOriginRef.current
    if (
      origin &&
      (Math.abs(e.clientX - origin.x) > CARD_HOLD_SLOP_PX ||
        Math.abs(e.clientY - origin.y) > CARD_HOLD_SLOP_PX)
    ) {
      clearHoldTimer()
      holdOriginRef.current = null
    }
  }

  const handlePointerRelease = () => {
    clearHoldTimer()
    holdOriginRef.current = null
  }

  const handleTap = () => {
    if (heldRef.current) {
      // the browser click that follows a long press — suppress it
      heldRef.current = false
      return
    }
    onCardTap?.(card, index)
  }

  return (
    <article
      ref={attachRef}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? card.title : undefined}
      className={[styles.card, isFocused ? styles.cardFocused : '', blurred ? styles.blurred : '']
        .filter(Boolean)
        .join(' ')}
      onClick={interactive ? handleTap : undefined}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerRelease : undefined}
      onPointerCancel={interactive ? handlePointerRelease : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onCardTap?.(card, index)
              }
            }
          : undefined
      }
    >
      <AlbumArt src={card.art} alt={card.title} size={CARD_ART_SIZE} />
      <div className={styles.meta}>
        <h3 className={styles.title}>{card.title}</h3>
        {card.subtitle ? <p className={styles.subtitle}>{card.subtitle}</p> : null}
      </div>
    </article>
  )
}

// bug8.2: a card re-renders only when its focus state or its data changes, so a
// dial tick re-renders exactly the previously and the newly focused card
const CarouselCard = memo(CarouselCardImpl, carouselCardAreEqual)

interface ContentCarouselProps {
  cards: MenuCard[]
  // identity of the category the cards belong to; the scroll reset (bug8.1)
  // runs only when this changes, never on plain card-list re-renders
  categoryId: string
  // bug41: identity of the currently playing track (the 'Läuft gerade' first
  // card). When it changes WHILE the categoryId stays the same (a queue skip
  // or a natural track advance), the card list re-orders in place — the
  // categoryId-keyed purge (bug39) never sees that case, so the viewport is
  // reset to the new first card here instead
  activeTrackKey?: string
  onCardTap?: (card: MenuCard, index: number) => void
  // bug53: touch hold (≥ CARD_HOLD_MS) on a card — the parent routes it
  // (dimmable light → dim view, everything else like a tap). Must be STABLE:
  // the memoized cards keep the first closure they receive
  onCardHold?: (card: MenuCard, index: number) => void
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
  // bug58 T4: the index the BLUR set is derived from — deliberately decoupled
  // from focusedIndex. In MainMenuView the UI focus can sit in the SIDEBAR
  // pane (dialing the menu rows) while the carousel keeps its last position:
  // there focusedIndex is undefined, but the cards under the glass must keep
  // their blur — the blur state must not depend on the active pane (device
  // report Build #110/#111). MainMenuView always passes the content index;
  // it stays put during sidebar dialing (a preview switch resets it to 0,
  // which matches the carousel's card-0 remount), so the set is stable.
  // Standalone usage without this prop falls back to focusedIndex — exactly
  // like before T4.
  blurIndex?: number
  // bug47: how the last focus change arrived — 'dial' (wheel tick) scrolls
  // the focus in instantly (a smooth animation would restart on every 35 ms
  // tick and keep the scroll 50+ cards behind the focus), 'jump' (tap,
  // confirm, category switch) keeps the smooth scroll. Defaults to 'smooth'
  // so standalone usage (tests, other views) is unchanged.
  focusScrollBehavior?: 'auto' | 'smooth'
  // bug54: by how many px the carousel viewport extends UNDERNEATH a fixed
  // overlay (the sidebar). 0 (default) keeps the solid layout exactly as
  // before; a positive value shifts the dial centering geometry (full-screen
  // viewport, first card's rest position and the left boundary at the
  // overlay's right edge, centering target in the visible zone) and applies
  // the .underflow padding so the scroll port starts under the overlay.
  // bug54 (08.09.2026 user change) / bug58: only the 'blur' mode passes a
  // positive value (SIDEBAR_WIDTH — the cards pass under the menu and get
  // blurred there); 'solid', 'translucent' and 'clear' keep the solid layout
  // (cards clipped at the menu edge, never visible under it).
  underflowPx?: number
}

export function ContentCarousel({
  cards,
  categoryId,
  activeTrackKey,
  onCardTap,
  onCardHold,
  focusedIndex,
  blurIndex,
  focusScrollBehavior = 'smooth',
  underflowPx = 0,
}: ContentCarouselProps) {
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const lastCategoryIdRef = useRef(categoryId)
  const lastActiveTrackKeyRef = useRef(activeTrackKey)
  // bug18: measured physical scroll position, feeding the viewport safety
  // guard (smooth path only — the dial path bypasses the guard, see below)
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics | null>(null)
  // bug47 R2 (F2): the carousel's viewport width, measured ONCE. The device
  // viewport is fixed (800x480, constant content-pane width), so the dial
  // centering target is pure arithmetic and the tick path never reads layout
  // again. The mount-time read rides on the first (unavoidable) layout pass;
  // the lazy re-measure in the dial branch below only covers a zero width at
  // mount (jsdom).
  const viewportWidthRef = useRef(0)
  // bug54: re-measure when the underflow changes — the measured clientWidth
  // is the FULL-screen viewport in translucent mode, the content-pane width
  // in solid mode (the runtime setting toggle must re-center from the new
  // geometry)
  useLayoutEffect(() => {
    viewportWidthRef.current = carouselRef.current?.clientWidth ?? 0
  }, [underflowPx])

  const registerFocusedRef = useCallback((el: HTMLElement | null) => {
    focusedCardRef.current = el
  }, [])

  // ── bug59: live-blur tracking (blur menu background, underflow mode) ─────
  // The .blurred classes used to follow the LOGICAL dial target index in the
  // render (sidebarOverlap), but the scroll port animates with
  // `scroll-behavior: smooth` (.animCarousel) — during fast dialing the
  // physical scrollLeft trails the target by ~200 ms, so viewport cards got
  // blurred and cards under the glass stayed sharp (Bug59). While an
  // animation is in flight, a rAF loop below owns the classes exclusively:
  // it follows the PHYSICAL scrollLeft every frame (sidebarOverlapAt) and,
  // once the offset settles, removes all of its classes and flips liveBlur
  // off — React's render-derived target set (sidebarOverlap, identical at
  // the settled offset) takes over in that very commit: invisible handoff.
  // cardElsRef: the per-index registry the loop blurs/deblurs by index
  // (single Map — no per-index closure cache; see registerCardElBase)
  const cardElsRef = useRef(new Map<number, HTMLElement>())
  // bug59: performance.now() of the last scroll write that starts/updates an
  // animation — the loop's settle check is relative to THIS tick, not to the
  // first arm (a fast dial keeps re-arming on every tick)
  const lastTickRef = useRef(0)
  // bug59: target offset of the running animation — settle requires the
  // physical scrollLeft to be within 1px of it AND past ANIM_SETTLE_MS
  const targetOffsetRef = useRef(0)
  // bug59: the set the loop wrote in the LAST frame (diff base for removals
  // — removals must not assume a card is still mounted/registered)
  const liveSetRef = useRef(new Set<number>())
  // bug59: mirror of liveBlur for the arm checks INSIDE effects. The
  // `liveBlur` state itself must NOT join the dial/purge effect dependency
  // lists — adding it would ping-pong: the effect rewrites scrollLeft and
  // restarts the animation on every liveBlur flip, which flips it again ...
  const liveBlurRef = useRef(false)
  const [liveBlur, setLiveBlur] = useState(false)

  // bug59: ONE stable registry callback (empty deps — never re-created). The
  // card's own `index` prop identifies the slot, so there is no per-index
  // closure factory to call during render. Ref access happens ONLY when React
  // invokes the callback at commit time (attach/detach), never during render
  // (react-hooks/refs); the null call on unmount deregisters the element.
  const registerCardElBase = useCallback(
    (index: number, el: HTMLElement | null) => {
      if (el) cardElsRef.current.set(index, el)
      else cardElsRef.current.delete(index)
    },
    [],
  )

  // bug39: a category change fully purges the carousel's per-view state. The
  // measured scroll offset is the bug18 guard's baseline and belongs to the
  // PREVIOUS category's list — keeping it would seed the new list's window
  // from a dead offset (stale cards and spacer widths lingering in the
  // mounted buffer). Runs as a layout effect, so the purge lands before the
  // browser paints the switch frame AND before the passive metrics sampler
  // below: the new category is always painted from card 0 with a pure
  // index-0 window, never from the old category's scroll position.
  // (bug8.1: keyed on categoryId, not on the cards array identity — the
  // parent rebuilds it on every re-render, which reset the scroll on each
  // dial tick)
  useLayoutEffect(() => {
    if (lastCategoryIdRef.current === categoryId) return
    lastCategoryIdRef.current = categoryId
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
    // reset the window state to the pure index window; the guard stays
    // disabled until the fresh (zeroed) position is sampled below
    setScrollMetrics(null)
    // bug59: this reset is ANOTHER smooth move (scroll-behavior on the port
    // — deliberate extension beyond the original Bug59 brief, noted in the
    // ticket): without arming here a category switch would leave stale
    // lastTick/target values behind because the dial effect does not re-run
    // (focusedIndex may be undefined during the sidebar-pane focus). The
    // loop tracks the physical offset back to 0 and settles from there.
    lastTickRef.current = performance.now()
    targetOffsetRef.current = 0
    if (underflowPx > 0 && !liveBlurRef.current) {
      liveBlurRef.current = true
      setLiveBlur(true)
    }
  }, [categoryId, underflowPx])

  // bug41: an active-track change inside the same category (queue skip in
  // 'Läuft gerade') re-orders the card list around the new current track
  // without a categoryId change, so the purge above never fires. Reset the
  // viewport to the new first card (the new current track) and drop the stale
  // scroll metrics — the measured offset belongs to the OLD list and would
  // seed the new window from a dead offset (the bug39 failure mode). Same
  // shape as the purge: a layout effect, pre-paint and ahead of the passive
  // metrics sampler below. Keyed on the track identity scalar, so observer
  // re-projections that keep the same track (and a plain focus move, bug8.1)
  // never re-trigger it.
  useLayoutEffect(() => {
    if (lastActiveTrackKeyRef.current === activeTrackKey) return
    lastActiveTrackKeyRef.current = activeTrackKey
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
    setScrollMetrics(null)
    // bug59: same arm as the category purge — the track-key reset is a
    // smooth move too (deliberate extension, see the category purge above)
    lastTickRef.current = performance.now()
    targetOffsetRef.current = 0
    if (underflowPx > 0 && !liveBlurRef.current) {
      liveBlurRef.current = true
      setLiveBlur(true)
    }
  }, [activeTrackKey, underflowPx])

  // bug18: read the carousel's physical scroll position after each render that
  // can change the window (focus / list / view). A lagging smooth scroll then
  // keeps the still-visible cards mounted instead of unmounting them early.
  // Runs after the purge above, so a category switch always samples the fresh
  // (zeroed) offset — never the previous category's (bug39).
  // bug47 R2 (F1): SKIPPED in the dial path (behavior 'auto'). Dial ticks
  // scroll instantly, so the lag the bug18 guard compensates is at most one
  // card (194 px) — far inside the 16-card window buffer. Sampling on every
  // tick was pure overhead: the read (scrollLeft + clientWidth) lands right
  // after the commit's spacer-width/card mutations and forces the tick's
  // reflow (3137 ms of UpdateLayoutTree inside the task in the W4 trace),
  // and the state update triggers a third render pass on every tick (the
  // dial scroll moves 194 px/tick, so the identity check never hits). While
  // dialing, the guard is bypassed at window computation below instead (the
  // dial target centers the focus, so no widening is possible); sampling
  // resumes on the next smooth move (a mode change re-runs this effect and
  // re-measures).
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    if (focusScrollBehavior === 'auto') return
    const next: ScrollMetrics = { scrollLeft: carousel.scrollLeft, width: carousel.clientWidth }
    setScrollMetrics((prev) =>
      prev && prev.scrollLeft === next.scrollLeft && prev.width === next.width ? prev : next,
    )
  }, [cards.length, focusedIndex, categoryId, focusScrollBehavior])

  // keep the focused card visible while the dial rotates through the carousel
  // bug47: wheel ticks scroll instantly (behavior 'auto') — restarting a
  // smooth animation on every 35 ms tick both janks the UI (Bug47) and keeps
  // the measured scroll far behind the focus so the bug18 guard widens the
  // window toward the full list (Bug48). Taps, confirms and category switches
  // keep the smooth scroll (visual convention)
  // bug47 R2 (F2): the dial branch writes scrollLeft arithmetically instead of
  // calling scrollIntoView — the native call measures the focus card's
  // geometry internally, which (once F1 removed the sampler's read) would be
  // the tick's new forced reflow. The target is dialScrollLeft(): card index
  // + the fixed card/gap/padding constants + the once-measured viewport
  // width, clamped to the ends exactly like inline:'center' (same centering,
  // no drift — Bug15/18/41 windowing stays intact). Without a measurable
  // viewport (jsdom) it falls back to the native call. The write itself stays
  // read-free: it is a plain arithmetic assignment (bug47's reflow worry was
  // scrollIntoView's internal geometry measurement, not this).
  // bug58 T4: the dial branch is a LAYOUT effect — it runs after the DOM
  // commit and BEFORE the browser paints, so the .blurred classes (committed
  // in this same render) and the scrollLeft write land in the SAME frame. As
  // a passive useEffect it ran after the paint: exactly one planned frame per
  // tick in which the blur set and the scroll position were a card (194 px)
  // apart — the visible edge flicker of the device report (Build #110/#111).
  useLayoutEffect(() => {
    if (focusScrollBehavior !== 'auto') return
    if (focusedIndex == null) return
    const card = focusedCardRef.current
    if (!card) return
    const carousel = carouselRef.current
    if (!carousel) return
    if (viewportWidthRef.current <= 0) {
      // zero at mount (jsdom / first paint pending): measure once now — a
      // single layout read, never again (the width is constant afterwards)
      viewportWidthRef.current = carousel.clientWidth
    }
    if (viewportWidthRef.current <= 0) {
      card.scrollIntoView({ behavior: 'auto', inline: 'center' })
      return
    }
    const viewportW = viewportWidthRef.current
    // bug54/bug58: blur mode — the viewport spans the full screen
    // (underflowPx under the sidebar), so the centering geometry shifts:
    // the first card's rest position sits at sidebar width + edge padding,
    // the focused card's left edge may never cross the sidebar's right
    // edge (the Bug50 boundary), and the centering target is the middle of
    // the visible zone. underflowPx 0 passes no geometry — today's exact
    // arithmetic.
    const geo: CarouselGeometry | undefined =
      underflowPx > 0
        ? {
            leftInset: CAROUSEL_EDGE_PADDING + underflowPx,
            minVisibleX: underflowPx,
            centerTarget: underflowPx + (viewportW - underflowPx) / 2,
          }
        : undefined
    const target = dialScrollLeft(cards.length, focusedIndex, viewportW, geo)
    carousel.scrollLeft = target
    // bug59: arm/refresh the live-blur loop. The scroll write above starts a
    // NATIVE smooth animation (scroll-behavior on the port) — from this frame
    // on, the rAF loop below follows the physical scrollLeft (sidebarOverlapAt)
    // instead of the render-derived target set. Pure ref writes + one setState
    // (guarded by liveBlurRef), no new layout reads, no dependency change:
    // liveBlur itself must never join this effect's deps (ping-pong — see
    // liveBlurRef above).
    lastTickRef.current = performance.now()
    targetOffsetRef.current = target
    if (underflowPx > 0 && !liveBlurRef.current) {
      liveBlurRef.current = true
      setLiveBlur(true)
    }
  }, [focusedIndex, categoryId, focusScrollBehavior, cards.length, underflowPx])

  // bug47: the SMOOTH branch (taps, confirms, category switches) stays a
  // passive effect — its animation runs after the paint anyway, so there is
  // no same-frame requirement with the blur classes (bug58 T4 moved only the
  // dial branch to a layout effect). Same dependency list as before the split.
  useEffect(() => {
    if (focusScrollBehavior !== 'auto') {
      const card = focusedCardRef.current
      if (focusedIndex != null && card) {
        // bug59: arm BEFORE the native smooth call — target = where THIS call
        // lands. Solid geometry: the same arithmetic as the dial branch (the
        // native inline:'center' centers on the port's visible width). In
        // underflow mode the port spans the FULL screen, so the native
        // centering happens at the PORT CENTER (viewportW / 2) with the
        // underflow leftInset — NOT the dial's visible-zone target (that one
        // compensates for the sidebar the port slides under; scrollIntoView
        // has no knowledge of it). The loop then tracks the physical offset
        // from here until settle. Target write only when the viewport was
        // measured (jsdom stays at 0 and settles immediately on frame one).
        const viewportW = viewportWidthRef.current
        if (viewportW > 0) {
          const geo: CarouselGeometry | undefined =
            underflowPx > 0
              ? {
                  leftInset: CAROUSEL_EDGE_PADDING + underflowPx,
                  minVisibleX: CAROUSEL_EDGE_PADDING + underflowPx,
                  centerTarget: viewportW / 2,
                }
              : undefined
          targetOffsetRef.current = dialScrollLeft(cards.length, focusedIndex, viewportW, geo)
        }
        lastTickRef.current = performance.now()
        if (underflowPx > 0 && !liveBlurRef.current) {
          liveBlurRef.current = true
          setLiveBlur(true)
        }
        card.scrollIntoView({ behavior: 'smooth', inline: 'center' })
      }
    }
  }, [focusedIndex, categoryId, focusScrollBehavior, cards.length, underflowPx])

  // bug59: the live-blur loop — OWNER of the .blurred classes while a smooth
  // animation is in flight (liveBlur true). Every rAF frame it reads the
  // PHYSICAL scrollLeft (the one read this feature performs per frame — on
  // the dial tick path itself, bug47/48's read-free invariant, untouched)
  // and writes exactly the classes sidebarOverlapAt() derives from it. This
  // is what keeps the blur glued to the glass while the native animation
  // lags the dial target (Bug59). Settle: once ANIM_SETTLE_MS passed since
  // the LAST scroll write AND the physical offset sits within 1px of the
  // target, the loop removes ALL its classes and flips liveBlur off — no
  // next frame. The flip re-renders with the render-derived sidebarOverlap
  // set (identical at this offset: same constants/candidate window/T4 rule),
  // so the handoff back to React is invisible. Deps: only what the frame
  // closure reads; liveBlur is the on/off switch, cards.length and
  // underflowPx parameter sidebarOverlapAt. (performance.now / rAF / refs —
  // stable, no deps.)
  useEffect(() => {
    if (!liveBlur) return
    let rafId: number | undefined
    const cleanup = () => {
      if (rafId != null) cancelAnimationFrame(rafId)
    }
    if (underflowPx <= 0) {
      // mode switched to solid mid-animation: hand off — solid renders
      // NO_BLUR in this very commit, so the loop never needs a frame of its
      // own. The class removal + liveBlur flip is deferred one rAF tick
      // instead of running synchronously in the effect body: a synchronous
      // setLiveBlur(false) here trips react-hooks/set-state-in-effect (state
      // update as part of commit work). The deferral is invisible — no frame
      // can paint a stale blurred class, because solid's NO_BLUR render owns
      // every card in the same commit. The cleanup below cancels the pending
      // tick if the effect re-runs (e.g. a dial tick) before it fires.
      rafId = requestAnimationFrame(() => {
        for (const el of cardElsRef.current.values()) el.classList.remove(styles.blurred)
        liveSetRef.current = new Set<number>()
        liveBlurRef.current = false
        setLiveBlur(false)
      })
      return cleanup
    }
    const frame = () => {
      const carousel = carouselRef.current
      if (!carousel) return
      const physical = carousel.scrollLeft
      const settled =
        performance.now() - lastTickRef.current > ANIM_SETTLE_MS &&
        Math.abs(physical - targetOffsetRef.current) < 1
      if (settled) {
        for (const el of cardElsRef.current.values()) el.classList.remove(styles.blurred)
        liveSetRef.current = new Set<number>()
        liveBlurRef.current = false
        setLiveBlur(false)
        return // no next frame — the liveBlur flip's cleanup cancels the
        // consumed rafId (no-op, safe); React now owns the classes again
      }
      const prev = liveSetRef.current
      const next = sidebarOverlapAt(physical, cards.length, underflowPx)
      // NOTE: ADDs are unconditional (idempotent) — CRITICAL stomp self-heal:
      // while liveBlur is on, every React commit (a dial tick re-rendered two
      // cards with NO_BLUR) stomps the classes the loop set in its last
      // frame. Only an unconditional add per frame heals that within one
      // frame; Removals run diff-based (only what left the set).
      for (const i of next) cardElsRef.current.get(i)?.classList.add(styles.blurred)
      for (const i of prev) if (!next.has(i)) cardElsRef.current.get(i)?.classList.remove(styles.blurred)
      liveSetRef.current = next
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return cleanup
  }, [liveBlur, cards.length, underflowPx])

  // bug59: unmount cleanup — drop the element registry (the card unmount
  // ref-nulls already deregistered every live element; this covers anything
  // left, e.g. an abrupt unmount that skipped some ref nulls)
  useEffect(
    () => () => {
      cardElsRef.current.clear()
    },
    [],
  )

  // bug5/bug6/bug18: mount only [start, end) plus invisible width spacers for
  // the off-screen cards so scroll metrics and index math stay correct
  // bug47 R2 (F1): the dial path bypasses the measured guard. The dial target
  // (F2) centers the focused card by construction, so the guard could never
  // widen the window — the pure index window is exact. The measured
  // scrollMetrics would be stale smooth-path state here anyway (the sampler
  // skips dialing, above), and re-measuring is the forced reflow bug47 removes.
  const { start, end } = windowRange(
    cards.length,
    focusedIndex,
    focusScrollBehavior === 'auto' ? null : scrollMetrics,
  )
  const leadingWidth = leadingSpacerWidth(start)
  const trailingWidth = trailingSpacerWidth(cards.length - end)

  // bug58 T3/T4: in the 'blur' menu background exactly the cards that are
  // MORE THAN HALF under the translucent glass (the card's center has crossed
  // the sidebar's right edge — sidebarOverlap's T4 center rule) get the strong
  // per-card blur (.blurred); the filter is REMOVED as soon as a card leaves
  // that zone (`filter` creates a compositing layer per card — a permanently
  // blurred card is not acceptable on the weak S905D2). The set is derived
  // arithmetically from the DIAL state — sidebarOverlap() reuses the same
  // constants and the index's TARGET offset as dialScrollLeft(), so neither
  // this render nor the dial tick reads layout (bug47/bug48: per-frame layout
  // reads are a no-go). viewportWidthRef holds the once-measured width (the
  // device pane is fixed); while it is still 0 (jsdom first paint) no card is
  // blurred for that one frame. The smooth-scroll path (scrollIntoView,
  // taps/jumps) only updates the blur state with the next dial tick —
  // deliberate v1 behavior, the dial ticks are the scrolling case.
  // bug58 T4: the set follows blurIndex ?? focusedIndex, NOT focusedIndex
  // alone — in MainMenuView the UI focus can sit in the sidebar pane while
  // the carousel keeps its position (focusedIndex undefined), and the cards
  // under the glass must stay blurred; the dial scroll below stays keyed on
  // focusedIndex exactly as before. Reading the ref in the render body is
  // intentional (the accepted react-hooks/refs false positive for this
  // established pattern, cf. cardHoldRoutingRef in MainMenuView.tsx): the
  // value is written only in mount/layout and one-shot effects — never per
  // frame — and the dial target on every tick is computed from this same
  // width, so a render that skipped the blur set would desync the blur state
  // from the dial scroll.
  // eslint-disable-next-line react-hooks/refs
  const measuredViewportW = viewportWidthRef.current
  // bug58 T4: the blur index — always the content focus in MainMenuView (even
  // while the UI focus sits in the sidebar pane), focusedIndex for standalone
  // usage without the prop
  const blurTarget = blurIndex ?? focusedIndex
  // bug59: render gate. While liveBlur is active the rAF loop below is the
  // SOLE owner of the .blurred classes (it follows the physical scrollLeft,
  // which trails this render-derived target set during a running animation —
  // the desync of Bug59). React must render NO_BLUR in that window: any
  // committed class would be stomped by the loop on the next frame anyway
  // (every dial tick re-renders the two focused cards), and fighting over the
  // classes per commit is exactly what this fix removes. On settle the loop
  // clears its classes in the same turn that flips liveBlur off, so the
  // target set below lands in that very commit — invisible handoff (the two
  // sets are identical at the settled offset: same constants, same candidate
  // window, same T4 center rule).
  const blurredCards =
    liveBlur || !(underflowPx > 0 && blurTarget != null && measuredViewportW > 0)
      ? NO_BLUR
      : sidebarOverlap(cards.length, blurTarget, measuredViewportW, underflowPx)

  // bug58 (PERMANENT — shipped after on-device A/B, SCN run ~35 fps on
  // S905D2 vs ~14 base): two always-on classes on the scroll port.
  // - compScroll = compositing hint for the scroll port (.compScroll in
  //   ContentCarousel.module.scss: translateZ + will-change).
  // - animCarousel = .animCarousel sets `scroll-behavior: smooth` on the SAME
  //   scroll port, so the dial branch's arithmetic
  //   `carousel.scrollLeft = dialScrollLeft(...)` write is natively
  //   interpolated by Chromium (browser-side animation, no JS loop, read-free).
  //   CR69 note: scroll-behavior is supported since Chrome 61, no modern CSS
  //   needed.
  // WARNING: calling scrollIntoView({ behavior: 'smooth' }) inside the dial
  // branch again on every tick must NOT be revived (bug47, commits de4d3f5 /
  // 2516c47): scrollIntoView measures the focus card's geometry internally,
  // i.e. a forced reflow per 35 ms tick — exactly what bug47 removed from the
  // dial path.
  const carouselClass = [
    styles.carousel,
    underflowPx > 0 ? styles.underflow : '',
    styles.compScroll,
    styles.animCarousel,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={carouselClass} ref={carouselRef}>
      {leadingWidth > 0 && (
        <div
          key={`lead-${start}`}
          className={styles.spacer}
          style={{ width: leadingWidth }}
          aria-hidden="true"
        />
      )}
      {cards.slice(start, end).map((card, i) => {
        const index = start + i
        // key includes the view identity (category / track sub-menu) so a view
        // switch always mounts fresh cards and never reuses a stale one (bug15)
        return (
          <CarouselCard
            key={`${categoryId}:${card.id}`}
            card={card}
            index={index}
            isFocused={focusedIndex === index}
            blurred={blurredCards.has(index)}
            interactive={onCardTap != null}
            onCardTap={onCardTap}
            onCardHold={onCardHold}
            registerRef={registerFocusedRef}
            // bug59: per-index registry entry for the live-blur loop — one
            // stable callback (see registerCardElBase), the card's own index
            // prop identifies the slot; ignored by the memo comparator
            registerCardEl={registerCardElBase}
          />
        )
      })}
      {trailingWidth > 0 && (
        <div
          key={`trail-${end}`}
          className={styles.spacer}
          style={{ width: trailingWidth }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
