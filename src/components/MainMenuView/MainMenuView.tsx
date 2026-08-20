import { useState } from 'react'
import type { CSSProperties } from 'react'
import { SidebarNav } from './SidebarNav'
import { ContentCarousel } from './ContentCarousel'
import { MENU_CATEGORIES } from './mockData'
import styles from './MainMenuView.module.scss'

// Nocturne-style main menu (tickets 8.4a1-8.4a3).
export function MainMenuView() {
  const [activeCategoryId, setActiveCategoryId] = useState('home')
  const activeCategory =
    MENU_CATEGORIES.find((category) => category.id === activeCategoryId) ?? MENU_CATEGORIES[0]
  const viewStyle = {
    '--menu-glow-a': activeCategory.accent.a,
    '--menu-glow-b': activeCategory.accent.b,
  } as CSSProperties

  return (
    <div className={styles.view} style={viewStyle}>
      <aside className={styles.sidebarPane} aria-label="Menü-Navigation">
        <SidebarNav
          categories={MENU_CATEGORIES}
          activeId={activeCategoryId}
          onSelect={setActiveCategoryId}
        />
      </aside>
      <main className={styles.contentPane} aria-label="Menü-Inhalt">
        <ContentCarousel cards={activeCategory.cards} />
      </main>
    </div>
  )
}
