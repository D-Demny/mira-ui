import { useState } from 'react'
import { SidebarNav } from './SidebarNav'
import { MENU_CATEGORIES } from './mockData'
import styles from './MainMenuView.module.scss'

// Nocturne-style main menu (tickets 8.4a1/8.4a2).
// The content pane is filled by ContentCarousel (ticket 8.4a3).
export function MainMenuView() {
  const [activeCategoryId, setActiveCategoryId] = useState('home')

  return (
    <div className={styles.view}>
      <aside className={styles.sidebarPane} aria-label="Menü-Navigation">
        <SidebarNav
          categories={MENU_CATEGORIES}
          activeId={activeCategoryId}
          onSelect={setActiveCategoryId}
        />
      </aside>
      <main className={styles.contentPane} aria-label="Menü-Inhalt" />
    </div>
  )
}
