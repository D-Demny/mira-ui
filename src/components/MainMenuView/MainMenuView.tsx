import styles from './MainMenuView.module.scss'

// Nocturne-style main menu layout shell (ticket 8.4a1).
// The sidebar pane is filled by SidebarNav (ticket 8.4a2) and the content pane
// by ContentCarousel (ticket 8.4a3).
export function MainMenuView() {
  return (
    <div className={styles.view}>
      <aside className={styles.sidebarPane} aria-label="Menü-Navigation" />
      <main className={styles.contentPane} aria-label="Menü-Inhalt" />
    </div>
  )
}
