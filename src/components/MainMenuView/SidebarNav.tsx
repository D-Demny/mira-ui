import { MenuIcon } from './MenuIcon'
import type { MenuCategory } from './mockData'
import styles from './SidebarNav.module.scss'

interface SidebarNavProps {
  categories: MenuCategory[]
  activeId: string
  onSelect: (id: string) => void
}

export function SidebarNav({ categories, activeId, onSelect }: SidebarNavProps) {
  return (
    <nav className={styles.sidebar} aria-label="Hauptmenü">
      {categories.map((category) => {
        const active = category.id === activeId
        return (
          <button
            key={category.id}
            type="button"
            className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(category.id)}
          >
            {active && <span className={styles.pill} />}
            <span className={styles.iconCircle}>
              <MenuIcon name={category.icon} size={22} />
            </span>
            <span className={styles.label}>{category.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
