import { memo, useCallback, useEffect, useRef } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import { carouselCardAreEqual } from './carouselCardCompare'
import type { CarouselCardProps } from './carouselCardCompare'
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
  onCardTap?: (card: MenuCard, index: number) => void
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
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

  return (
    <div className={styles.carousel} ref={carouselRef}>
      {cards.map((card, index) => (
        <CarouselCard
          key={card.id}
          card={card}
          index={index}
          isFocused={focusedIndex === index}
          interactive={onCardTap != null}
          onCardTap={onCardTap}
          registerRef={registerFocusedRef}
        />
      ))}
    </div>
  )
}
