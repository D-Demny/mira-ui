import { useEffect, useRef } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import styles from './ContentCarousel.module.scss'

interface ContentCarouselProps {
  cards: MenuCard[]
  onCardTap?: (card: MenuCard, index: number) => void
  // index of the dial-focused card (rendered with a focus outline + centered)
  focusedIndex?: number
}

export function ContentCarousel({ cards, onCardTap, focusedIndex }: ContentCarouselProps) {
  const focusedCardRef = useRef<HTMLElement | null>(null)

  // keep the focused card visible while the dial rotates through the carousel
  useEffect(() => {
    if (focusedIndex == null) return
    focusedCardRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center' })
  }, [focusedIndex, cards])

  return (
    <div className={styles.carousel}>
      {cards.map((card, index) => (
        <article
          key={card.id}
          ref={
            focusedIndex === index
              ? (el) => {
                  focusedCardRef.current = el
                }
              : undefined
          }
          className={
            focusedIndex === index ? `${styles.card} ${styles.cardFocused}` : styles.card
          }
          onClick={onCardTap ? () => onCardTap(card, index) : undefined}
        >
          <AlbumArt src={card.art} alt={card.title} />
          <div className={styles.meta}>
            <h3 className={styles.title}>{card.title}</h3>
            <p className={styles.subtitle}>{card.subtitle}</p>
          </div>
        </article>
      ))}
    </div>
  )
}
