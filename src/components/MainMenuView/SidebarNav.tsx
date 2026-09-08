import { MenuIcon } from './MenuIcon'
import type { MenuCategory } from './mockData'
import styles from './SidebarNav.module.scss'

interface SidebarNavProps {
  categories: MenuCategory[]
  activeId: string
  onSelect: (id: string) => void
  // index of the dial-focused item (rendered with a focus outline)
  focusedIndex?: number
  // bug54: menu background variant — 'solid' (opaque, default), 'glass'
  // (semi-transparent panel — the app background shows through where no
  // card is) or 'clear' (100% transparent — no visible background at all,
  // only the menu entries). The carousel geometry is identical in all
  // three (cards clipped at the menu edge; 08.09 user change v2)
  background?: 'solid' | 'glass' | 'clear'
}

export function SidebarNav({
  categories,
  activeId,
  onSelect,
  focusedIndex,
  background = 'solid',
}: SidebarNavProps) {
  const navClass =
    background === 'solid'
      ? styles.sidebar
      : background === 'glass'
        ? `${styles.sidebar} ${styles.glass}`
        : `${styles.sidebar} ${styles.clear}`
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
