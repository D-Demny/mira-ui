import { MenuIcon } from './MenuIcon'
import type { MenuCategory } from './mockData'
import styles from './SidebarNav.module.scss'

interface SidebarNavProps {
  categories: MenuCategory[]
  activeId: string
  onSelect: (id: string) => void
  // index of the dial-focused item (rendered with a brighter background —
  // issue #59: no outline stroke on focus)
  focusedIndex?: number
  // bug54: menu background variant — 'solid' (opaque, default), 'glass'
  // (semi-transparent panel — the app background shows through where no
  // card is) or 'clear' (100% transparent — no visible background at all,
  // only the menu entries). The carousel geometry is identical in all
  // three (cards clipped at the menu edge; 08.09 user change v2)
  background?: 'solid' | 'glass' | 'clear'
  // ticket8.1: collapsed (auto-collapse) mode — icon-only narrow state:
  // labels hidden, icon tiles centered. Purely visual (a .collapsed class
  // on the <nav>); the pane width itself lives on .sidebarPane
  // (MainMenuView.module.scss). Markup stays identical in both states so
  // the width transition animates without DOM churn.
  collapsed?: boolean
}

export function SidebarNav({
  categories,
  activeId,
  onSelect,
  focusedIndex,
  background = 'solid',
  collapsed = false,
}: SidebarNavProps) {
  const navClass = [
    styles.sidebar,
    background === 'glass' ? styles.glass : '',
    background === 'clear' ? styles.clear : '',
    collapsed ? styles.collapsed : '',
  ]
    .filter(Boolean)
    .join(' ')
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
