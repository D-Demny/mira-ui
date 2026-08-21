import { useEffect, useRef, useState } from 'react'
import styles from './AlbumArtBackground.module.scss'

// must match the .layer opacity transition (600ms, ticket 8.5)
const FADE_MS = 600

interface Props {
  // artwork URL of the focused carousel card; undefined → static category gradient
  art?: string
}

// Nocturne-style dynamic background (ticket 8.5): a blurred copy of the
// focused card's artwork behind the UI. Two layers crossfade on card change
// so dial rotation never causes a hard cut.
export function AlbumArtBackground({ art }: Props) {
  const [front, setFront] = useState<string | undefined>(art)
  const [back, setBack] = useState<string | undefined>(undefined)
  const [showFront, setShowFront] = useState(true)
  const lastRef = useRef<string | undefined>(art)
  const cleanupRef = useRef(0)

  useEffect(() => {
    if (art === lastRef.current) return
    lastRef.current = art

    if (showFront) {
      setBack(art)
      setShowFront(false)
    } else {
      setFront(art)
      setShowFront(true)
    }

    window.clearTimeout(cleanupRef.current)
    cleanupRef.current = window.setTimeout(() => {
      if (showFront) setFront(undefined)
      else setBack(undefined)
    }, FADE_MS + 60)
  }, [art, showFront])

  useEffect(() => () => window.clearTimeout(cleanupRef.current), [])

  return (
    <div className={styles.albumBg} aria-hidden="true">
      <div className={`${styles.layer} ${showFront ? styles.show : ''}`.trim()}>
        {front ? (
          <>
            <img
              className={styles.img}
              src={front}
              alt=""
              draggable={false}
              decoding="async"
            />
            <div className={styles.dim} />
          </>
        ) : null}
      </div>
      <div className={`${styles.layer} ${!showFront ? styles.show : ''}`.trim()}>
        {back ? (
          <>
            <img
              className={styles.img}
              src={back}
              alt=""
              draggable={false}
              decoding="async"
            />
            <div className={styles.dim} />
          </>
        ) : null}
      </div>
    </div>
  )
}
