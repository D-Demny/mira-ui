import { memo, useCallback, useEffect, useRef } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import { carouselCardAreEqual } from './carouselCardCompare'
import type { CarouselCardProps } from './carouselCardCompare'
import styles from './ContentCarousel.module.scss'

// cover art size for carousel cards (bug2: was 200, reduced for breathing room)
const CARD_ART_SIZE = 170

// bug5/bug6: windowed rendering — only the cards around the focused one are
// mounted in the DOM, invisible spacers keep the scroll width intact
const WINDOW_BEFORE = 3
const WINDOW_AFTER = 8
// keep in sync with $card-art-size / $s-6 in ContentCarousel.module.scss
const CARD_WIDTH = 170
const CARD_GAP = 24

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
  onCardTap?: (card: MenuCard, index: number) => void
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
}

// bug5/bug6: which slice of the card list is mounted; short lists render in
// full so the window logic never kicks in for menu panes with a few cards
function windowRange(count: number, focusedIndex: number | undefined): { start: number; end: number } {
  const full = WINDOW_BEFORE + 1 + WINDOW_AFTER
  if (count <= full) return { start: 0, end: count }
  const center = focusedIndex ?? 0
  const start = Math.max(0, center - WINDOW_BEFORE)
  const end = Math.min(count, center + 1 + WINDOW_AFTER)
  return { start, end }
}

// spacer widths that exactly match the space the missing cards would occupy
// (the carousel is a flex row with a CARD_GAP gap between every child)
function leadingSpacerWidth(start: number): number {
  return start > 0 ? start * (CARD_WIDTH + CARD_GAP) - CARD_GAP : 0
}

function trailingSpacerWidth(missing: number): number {
  return missing > 0 ? missing * CARD_WIDTH + (missing - 1) * CARD_GAP : 0
}

export function ContentCarousel({
  cards,
  categoryId,
  onCardTap,
  focusedIndex,
}: ContentCarouselProps) {
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const lastCategoryIdRef = useRef(categoryId)

  const registerFocusedRef = useCallback((el: HTMLElement | null) => {
    focusedCardRef.current = el
  }, [])

  // a category change always starts at the first card (bug8.1: keyed on
  // categoryId, not on the cards array identity — the parent rebuilds it on
  // every re-render, which reset the scroll on each dial tick)
  useEffect(() => {
    if (lastCategoryIdRef.current === categoryId) return
    lastCategoryIdRef.current = categoryId
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
  }, [categoryId])

  // keep the focused card visible while the dial rotates through the carousel
  useEffect(() => {
    if (focusedIndex == null) return
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }, [focusedIndex, categoryId])

  // bug5/bug6: mount only [start, end) plus invisible width spacers for the
  // off-screen cards so scroll metrics and index math stay correct
  const { start, end } = windowRange(cards.length, focusedIndex)
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
