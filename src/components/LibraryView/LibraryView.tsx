import styles from './LibraryView.module.scss'
import { usePlaylists } from '@/hooks/usePlaylists'
import { useListFocus } from '@/hooks/useListFocus'

interface Props {
  onNavigate: (route: string) => void
  onPlay?: (uri: string) => void
}

function LibraryViewImpl({ onNavigate, onPlay }: Props) {
  const { items: playlists, loading, error, refetch } = usePlaylists()

  // single focus list: "Home" entry first, then the playlists
  const itemCount = 1 + playlists.length

  const { focusedIndex, handleWheel, tapItem, setFocusRef } = useListFocus({
    itemCount,
    onSelect: (index) => {
      if (index === 0) {
        onNavigate('home')
        return
      }
      const playlist = playlists[index - 1]
      if (!playlist) return
      onNavigate('playlist')
      if (onPlay && playlist.uri) {
        onPlay(playlist.uri)
      }
    },
    allowTapSelect: true,
  })

  const homeFocused = focusedIndex === 0

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Library</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Menu</h2>
        <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
          <li
            className={`${styles.listItem} ${homeFocused ? styles.focused : ''}`}
            role="button"
            tabIndex={0}
            ref={homeFocused ? setFocusRef : undefined}
            onClick={() => tapItem(0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                tapItem(0)
              }
            }}
          >
            <span className={styles.listItemText}>
              <span>Home</span>
              <span className={styles.meta}>Home Assistant</span>
            </span>
            <span className={styles.chevron} aria-hidden>&#8250;</span>
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Playlists</h2>
        {loading && playlists.length === 0 ? (
          <div className={styles.loading}>Loading...</div>
        ) : error && playlists.length === 0 ? (
          <div className={styles.error}>
            <span>{error}</span>
            <button type="button" className={styles.retryBtn} onClick={refetch}>
              Retry
            </button>
          </div>
        ) : playlists.length === 0 ? (
          <p className={styles.empty}>No playlists found</p>
        ) : (
          <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
            {playlists.map((playlist, i) => {
              const index = i + 1
              return (
                <li
                  key={playlist.id ?? Math.random().toString(36)}
                  className={`${styles.listItem} ${index === focusedIndex ? styles.focused : ''}`}
                  role="button"
                  tabIndex={0}
                  ref={index === focusedIndex ? setFocusRef : undefined}
                  onClick={() => tapItem(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      tapItem(index)
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
                    <span>{playlist.name ?? 'Untitled'}</span>
                    <span className={styles.meta}>
                      {playlist.tracks?.total ?? 0} tracks
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export const LibraryView = LibraryViewImpl
