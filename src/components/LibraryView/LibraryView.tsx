import styles from './LibraryView.module.scss'

const dummyPlaylists = [
  'Recently Played',
  'Liked Songs',
  'Your Episodes',
  'Discover Weekly',
  'Release Radar',
]

const dummyAlbums = [
  'Daily Mix 1',
  'Daily Mix 2',
  'Daily Mix 3',
  'Chill Vibes',
  'Workout Playlist',
]

export function LibraryView({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Library</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Playlists</h2>
        <ul className={styles.list}>
          {dummyPlaylists.map((name) => (
            <li
              key={name}
              className={styles.listItem}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('playlist')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onNavigate('playlist')
                }
              }}
            >
              <span className={styles.listItemIcon}>&#9835;</span>
              <span className={styles.listItemText}>{name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Albums</h2>
        <ul className={styles.list}>
          {dummyAlbums.map((name) => (
            <li
              key={name}
              className={styles.listItem}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('album')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onNavigate('album')
                }
              }}
            >
              <span className={styles.listItemIcon}>&#9889;</span>
              <span className={styles.listItemText}>{name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
