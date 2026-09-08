import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import type { MenuCard } from './mockData'
import { carouselCardAreEqual } from './carouselCardCompare'
import type { CarouselCardProps } from './carouselCardCompare'
import {
  CAROUSEL_EDGE_PADDING,
  dialScrollLeft,
  leadingSpacerWidth,
  trailingSpacerWidth,
  windowRange,
  type CarouselGeometry,
  type ScrollMetrics,
} from './carouselWindow'
import styles from './ContentCarousel.module.scss'

// cover art size for carousel cards (bug2: was 200, reduced for breathing room)
const CARD_ART_SIZE = 170

// bug53: pointer movement beyond this distance cancels the hold — a
// drag/swipe (useSwipeGestures territory) is never a hold and must not open
// the dim view
const CARD_HOLD_SLOP_PX = 10

function CarouselCardImpl({
  card,
  index,
  isFocused,
  interactive,
  onCardTap,
  onCardHold,
  registerRef,
}: CarouselCardProps) {
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
      ref={isFocused ? registerRef : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? card.title : undefined}
      className={isFocused ? `${styles.card} ${styles.cardFocused}` : styles.card}
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
  // bug54 (08.09.2026 user change): currently no menu background mode passes
  // a positive value — 'translucent' was changed to the solid layout (cards
  // clipped at the menu edge, never visible under it). The mechanism stays
  // GATED for the upcoming 'blur' mode (Bug58), which needs the cards to
  // pass under the menu.
  underflowPx?: number
}

export function ContentCarousel({
  cards,
  categoryId,
  activeTrackKey,
  onCardTap,
  onCardHold,
  focusedIndex,
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
  }, [categoryId])

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
  }, [activeTrackKey])

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
  // viewport (jsdom) it falls back to the native call.
  useEffect(() => {
    if (focusedIndex == null) return
    const card = focusedCardRef.current
    if (!card) return
    if (focusScrollBehavior === 'auto') {
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
      // bug54: translucent mode — the viewport spans the full screen
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
      carousel.scrollLeft = dialScrollLeft(cards.length, focusedIndex, viewportW, geo)
      return
    }
    card.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }, [focusedIndex, categoryId, focusScrollBehavior, cards.length, underflowPx])

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

  return (
    <div
      className={underflowPx > 0 ? `${styles.carousel} ${styles.underflow}` : styles.carousel}
      ref={carouselRef}
    >
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
            interactive={onCardTap != null}
            onCardTap={onCardTap}
            onCardHold={onCardHold}
            registerRef={registerFocusedRef}
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
