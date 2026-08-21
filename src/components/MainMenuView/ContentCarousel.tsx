import { useEffect, useRef } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import styles from './ContentCarousel.module.scss'

// cover art size for carousel cards (bug2: was 200, reduced for breathing room)
const CARD_ART_SIZE = 170

interface ContentCarouselProps {
  cards: MenuCard[]
  onCardTap?: (card: MenuCard, index: number) => void
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
}

export function ContentCarousel({ cards, onCardTap, focusedIndex }: ContentCarouselProps) {
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const carouselRef = useRef<HTMLDivElement | null>(null)

  // a different category (or refreshed data) always starts at the first card (bug1)
  useEffect(() => {
    if (carouselRef.current) carouselRef.current.scrollLeft = 0
  }, [cards])

  // keep the focused card visible while the dial rotates through the carousel
  useEffect(() => {
    if (focusedIndex == null) return
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }, [focusedIndex, cards])

  return (
    <div className={styles.carousel} ref={carouselRef}>
      {cards.map((card, index) => {
        const interactive = onCardTap != null
        return (
          <article
            key={card.id}
            ref={
              focusedIndex === index
                ? (el) => {
                    focusedCardRef.current = el
                  }
                : undefined
            }
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? card.title : undefined}
            className={
              focusedIndex === index ? `${styles.card} ${styles.cardFocused}` : styles.card
            }
            onClick={interactive ? () => onCardTap(card, index) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onCardTap(card, index)
                    }
                  }
                : undefined
            }
          >
            <AlbumArt src={card.art} alt={card.title} size={CARD_ART_SIZE} />
            <div className={styles.meta}>
              <h3 className={styles.title}>{card.title}</h3>
              <p className={styles.subtitle}>{card.subtitle}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}
