import { memo } from 'react'
import styles from './LibraryView.module.scss'
import { usePlaylists } from '@/hooks/usePlaylists'

interface Props {
  onNavigate: (route: string) => void
  onPlay?: (uri: string) => void
}

function LibraryViewImpl({ onNavigate, onPlay }: Props) {
  const { items: playlists, loading, error, refetch } = usePlaylists()

  if (loading && playlists.length === 0) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Library</h1>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  if (error && playlists.length === 0) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Library</h1>
        <div className={styles.error}>
          <span>{error}</span>
          <button type="button" className={styles.retryBtn} onClick={refetch}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Library</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Playlists</h2>
        {playlists.length === 0 ? (
          <p className={styles.empty}>No playlists found</p>
        ) : (
          <ul className={styles.list}>
            {playlists.map((playlist) => (
              <li
                key={playlist.id}
                className={styles.listItem}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (onPlay) {
                    onPlay(playlist.uri)
                  }
                  onNavigate('playlist')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (onPlay) {
                      onPlay(playlist.uri)
                    }
                    onNavigate('playlist')
                  }
                }}
              >
                {playlist.images?.[0]?.url && (
                  <img
                    src={playlist.images[0].url}
                    alt=""
                    className={styles.thumbnail}
                    aria-hidden
                  />
                )}
                <span className={styles.listItemText}>
                  {playlist.name}
                  <span className={styles.meta}>
                    {playlist.tracks.total} tracks
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export const LibraryView = memo(LibraryViewImpl)
