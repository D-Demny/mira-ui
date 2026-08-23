import { memo, useEffect, useRef, useState } from 'react'
import styles from './AlbumArt.module.scss'

interface Props {
  src: string | undefined
  size?: number
  alt?: string
}

const FADE_MS = 220

// a generic music-note glyph shown when a cover is missing or fails to load
// (bug15: previously a failed image left a pure black box)
function MusicNoteIcon() {
  return (
    <svg className={styles.fallbackIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"
      />
    </svg>
  )
}

function AlbumArtImpl({ src, size = 200, alt = '' }: Props) {
  const [front, setFront] = useState<string | undefined>(src)
  const [back, setBack] = useState<string | undefined>(undefined)
  const [showFront, setShowFront] = useState(true)
  const [frontFailed, setFrontFailed] = useState(false)
  const [backFailed, setBackFailed] = useState(false)
  const lastRef = useRef<string | undefined>(src)
  const cleanupRef = useRef(0)

  useEffect(() => {
    if (src === lastRef.current) return
    lastRef.current = src

    if (showFront) {
      setBack(src)
      setBackFailed(false)
      setShowFront(false)
    } else {
      setFront(src)
      setFrontFailed(false)
      setShowFront(true)
    }

    window.clearTimeout(cleanupRef.current)
    cleanupRef.current = window.setTimeout(() => {
      if (showFront) setFront(undefined)
      else setBack(undefined)
    }, FADE_MS + 60)
  }, [src, showFront])

  useEffect(() => () => window.clearTimeout(cleanupRef.current), [])

  const sizePx: React.CSSProperties = { width: size, height: size }

  // bug27: the styled placeholder (music note on the card background) is the
  // base of every layer — it shows while the image is missing (src not set
  // or empty), while it is still loading (the img is transparent until it
  // loads, so no black box), and when it fails (onError). A loaded image
  // simply covers the placeholder.
  const renderLayer = (image: string | undefined, failed: boolean, onErr: () => void) => (
    <div className={styles.placeholder}>
      <MusicNoteIcon />
      {image && !failed ? (
        <img
          src={image}
          alt={alt}
          decoding="async"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={onErr}
        />
      ) : null}
    </div>
  )

  return (
    <div className={styles.art} style={sizePx}>
      <div
        className={`${styles.layer} ${showFront ? styles.show : styles.hide}`}
        aria-hidden={!showFront}
      >
        {renderLayer(front, frontFailed, () => setFrontFailed(true))}
      </div>
      <div
        className={`${styles.layer} ${!showFront ? styles.show : styles.hide}`}
        aria-hidden={showFront}
      >
        {renderLayer(back, backFailed, () => setBackFailed(true))}
      </div>
    </div>
  )
}

export const AlbumArt = memo(AlbumArtImpl)
