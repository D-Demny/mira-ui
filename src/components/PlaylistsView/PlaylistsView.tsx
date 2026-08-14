import { memo } from 'react'
import styles from './PlaylistsView.module.scss'
import { usePlaylists } from '@/hooks/usePlaylists'

interface Props {
  onNavigate: (route: string) => void
  onPlay?: (uri: string) => void
}

function PlaylistsViewImpl({ onNavigate, onPlay }: Props) {
  const { items: playlists, loading, error, refetch } = usePlaylists()

  if (loading && playlists.length === 0) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Playlists</h1>
        <div className={styles.loading}>Loading...</div>
      </div>
    )
  }

  if (error && playlists.length === 0) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Playlists</h1>
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
      <h1 className={styles.title}>Playlists</h1>

      {playlists.length === 0 ? (
        <p className={styles.empty}>No playlists found</p>
      ) : (
        <ul className={styles.list}>
          {playlists.map((playlist) => (
            <li
              key={playlist.id ?? Math.random().toString(36)}
              className={styles.listItem}
              role="button"
              tabIndex={0}
              onClick={() => {
                onNavigate('playlist-detail')
                if (onPlay && playlist.uri) {
                  onPlay(playlist.uri)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onNavigate('playlist-detail')
                  if (onPlay && playlist.uri) {
                    onPlay(playlist.uri)
                  }
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
              <div className={styles.listItemInfo}>
                <span className={styles.listItemText}>{playlist.name ?? 'Untitled'}</span>
                <span className={styles.meta}>
                  {playlist.owner?.display_name ?? ''}
                  {' · '}
                  {playlist.tracks?.total ?? 0} tracks
                </span>
              </div>
              {onPlay && (
                <span className={styles.playIcon} aria-hidden>&#9654;</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const PlaylistsView = memo(PlaylistsViewImpl)
