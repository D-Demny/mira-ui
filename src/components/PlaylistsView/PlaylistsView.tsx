import styles from './PlaylistsView.module.scss'

const dummyUserPlaylists = [
  'My Playlist #1',
  'Road Trip Mix',
  'Late Night Coding',
  'Workout Energy',
  'Focus Flow',
  'Sunday Brunch',
  'Indie Discoveries',
  'Jazz Classics',
]

export function PlaylistsView({ onNavigate, onPlay }: {
  onNavigate: (route: string) => void
  onPlay?: (uri: string) => void
}) {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Playlists</h1>

      <ul className={styles.list}>
        {dummyUserPlaylists.map((name, index) => (
          <li
            key={name}
            className={styles.listItem}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (onPlay) {
                onPlay(`spotify:playlist:${index + 1}`)
              }
              onNavigate('playlist-detail')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (onPlay) {
                  onPlay(`spotify:playlist:${index + 1}`)
                }
                onNavigate('playlist-detail')
              }
            }}
          >
            <span className={styles.listItemIcon}>&#9826;</span>
            <span className={styles.listItemText}>{name}</span>
            {onPlay && (
              <span className={styles.playIcon}>&#9654;</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
