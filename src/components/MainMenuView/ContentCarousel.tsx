import { AlbumArt } from '@/components/AlbumArt'
import type { MenuCard } from './mockData'
import styles from './ContentCarousel.module.scss'

interface ContentCarouselProps {
  cards: MenuCard[]
}

export function ContentCarousel({ cards }: ContentCarouselProps) {
  return (
    <div className={styles.carousel}>
      {cards.map((card) => (
        <article className={styles.card} key={card.id}>
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
