import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import { carouselCardAreEqual } from './carouselCardCompare'
import type { CarouselCardProps } from './carouselCardCompare'
import {
  leadingSpacerWidth,
  trailingSpacerWidth,
  windowRange,
  type ScrollMetrics,
} from './carouselWindow'
import styles from './ContentCarousel.module.scss'

// cover art size for carousel cards (bug2: was 200, reduced for breathing room)
const CARD_ART_SIZE = 170

function CarouselCardImpl({
  card,
  index,
  isFocused,
  interactive,
  onCardTap,
  registerRef,
}: CarouselCardProps) {
  return (
    <article
      ref={isFocused ? registerRef : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? card.title : undefined}
      className={isFocused ? `${styles.card} ${styles.cardFocused}` : styles.card}
      onClick={interactive ? () => onCardTap?.(card, index) : undefined}
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
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
}

export function ContentCarousel({
  cards,
  categoryId,
  activeTrackKey,
  onCardTap,
  focusedIndex,
}: ContentCarouselProps) {
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const lastCategoryIdRef = useRef(categoryId)
  const lastActiveTrackKeyRef = useRef(activeTrackKey)
  // bug18: measured physical scroll position, feeding the viewport safety guard
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics | null>(null)

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
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    const next: ScrollMetrics = { scrollLeft: carousel.scrollLeft, width: carousel.clientWidth }
    setScrollMetrics((prev) =>
      prev && prev.scrollLeft === next.scrollLeft && prev.width === next.width ? prev : next,
    )
  }, [cards.length, focusedIndex, categoryId])

  // keep the focused card visible while the dial rotates through the carousel
  useEffect(() => {
    if (focusedIndex == null) return
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }, [focusedIndex, categoryId])

  // bug5/bug6/bug18: mount only [start, end) plus invisible width spacers for
  // the off-screen cards so scroll metrics and index math stay correct
  const { start, end } = windowRange(cards.length, focusedIndex, scrollMetrics)
  const leadingWidth = leadingSpacerWidth(start)
  const trailingWidth = trailingSpacerWidth(cards.length - end)

  return (
    <div className={styles.carousel} ref={carouselRef}>
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
