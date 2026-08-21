import { MenuIcon } from './MenuIcon'
import type { MenuCategory } from './mockData'
import styles from './SidebarNav.module.scss'

interface SidebarNavProps {
  categories: MenuCategory[]
  activeId: string
  onSelect: (id: string) => void
  // index of the dial-focused item (rendered with a focus outline)
  focusedIndex?: number
}

export function SidebarNav({ categories, activeId, onSelect, focusedIndex }: SidebarNavProps) {
  return (
    <nav className={styles.sidebar} aria-label="Hauptmenü">
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
