import { MenuIcon } from './MenuIcon'
import type { MenuCategory } from './mockData'
import styles from './SidebarNav.module.scss'

interface SidebarNavProps {
  categories: MenuCategory[]
  activeId: string
  onSelect: (id: string) => void
  // index of the dial-focused item (rendered with a focus outline)
  focusedIndex?: number
  // bug54: translucent menu background — the nav switches to the semi-
  // transparent glass overlay (cards slide underneath), instead of the
  // opaque solid mask
  glass?: boolean
}

export function SidebarNav({
  categories,
  activeId,
  onSelect,
  focusedIndex,
  glass = false,
}: SidebarNavProps) {
  const navClass = glass ? `${styles.sidebar} ${styles.glass}` : styles.sidebar
  return (
    <nav className={navClass} aria-label="Hauptmenü">
      {categories.map((category, index) => {
        const active = category.id === activeId
        const focused = index === focusedIndex
        return (
          <button
            key={category.id}
            type="button"
            className={[
              styles.item,
              active ? styles.itemActive : '',
              focused ? styles.itemFocused : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(category.id)}
          >
            {active && <span className={styles.pill} />}
            <span className={styles.iconTile}>
              <MenuIcon name={category.icon} size={24} />
            </span>
            <span className={styles.label}>{category.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
