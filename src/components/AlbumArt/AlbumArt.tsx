import { memo, useEffect, useRef, useState } from 'react'
import { REMOTE_ART_TIMEOUT_MS, remoteArtUrl } from '@/api/miraImg'
import { useMiraServer } from '@/hooks/useMiraServer'
import styles from './AlbumArt.module.scss'

interface Props {
  src: string | undefined
  size?: number
  alt?: string
  // #90: delay before the src is handed to the layers (the styled
  // placeholder, bug27, shows until then). 0/undefined = immediate —
  // standalone and non-carousel callers are untouched
  loadDelayMs?: number
}

const FADE_MS = 220

// #50 F2: a saturated-burst cover failure is usually transient — retry one
// time after this delay before settling on the placeholder. Chrome does not
// cache failed loads, so blanking and re-setting the src forces a fresh
// fetch of the same URL.
export const RETRY_DELAY_MS = 1500

// epic10 task 2: the remoteBlur artwork loader. While the Pi feature is
// enabled the Pi's pre-processed 160x160 image loads first; on error OR
// timeout the img swaps to the direct (Spotify CDN) url — only AFTER the
// failed load, and the CDN url is warmed in parallel, so the swap usually
// finds an already-decoded bitmap (nahtlos, no placeholder flash). The
// music-note placeholder shows only if the CDN url fails too (bug15).
// With remoteBlur off (standalone — always, without a Pi) the given url is
// loaded directly: exactly the previous behavior.
function ArtImage({
  src,
  remote,
  alt,
  onFailed,
}: {
  src: string
  remote: boolean
  alt: string
  onFailed: () => void
}) {
  // the src the failed remote attempt belongs to ('' = none) — keyed by
  // value, so a src change (track switch) can never carry a stale failure
  // over and no state update is needed on src changes
  const [failedSrc, setFailedSrc] = useState('')
  const timeoutRef = useRef(0)
  // #50 F2: standalone retry bookkeeping — retrySrc: the src currently
  // blanked out awaiting its single re-set ('' = none); retriedRef: the src
  // whose one retry has already been used up. Both value-keyed, so a track
  // switch can never carry stale retry state over and the handler can never
  // fire more than once per (mount, src).
  const [retrySrc, setRetrySrc] = useState('')
  const retriedRef = useRef('')
  const retryTimerRef = useRef(0)

  useEffect(() => {
    if (!remote) return
    // warm the CDN url in parallel: if the Pi attempt fails, the fallback
    // swap below picks up the already-decoded bitmap
    const warm = new Image()
    warm.crossOrigin = 'anonymous'
    warm.referrerPolicy = 'no-referrer'
    warm.src = src
    // CR69: manual timeout (no AbortSignal.timeout)
    timeoutRef.current = window.setTimeout(() => setFailedSrc(src), REMOTE_ART_TIMEOUT_MS)
    return () => {
      window.clearTimeout(timeoutRef.current)
      warm.src = ''
    }
  }, [src, remote])

  // #50 F2: a pending re-set must never outlive the component (no timer leak)
  useEffect(() => () => window.clearTimeout(retryTimerRef.current), [])

  const failed = remote && failedSrc === src
  const loaded = remote && !failed ? remoteArtUrl(src) : src
  // #50 F2: while a standalone retry is pending the broken img is blanked
  // (the placeholder layer shows through); after RETRY_DELAY_MS the re-set
  // of the same url forces a fresh fetch
  const displaySrc = !remote && retrySrc === src ? '' : loaded

  return (
    <img
      src={displaySrc}
      alt={alt}
      decoding="async"
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      draggable={false}
      onLoad={() => window.clearTimeout(timeoutRef.current)}
      onError={() => {
        if (remote && !failed) {
          // the Pi image failed (or timed out): swap to the CDN url
          setFailedSrc(src)
        } else if (!remote && retrySrc !== src && retriedRef.current !== src) {
          // #50 F2: first standalone failure — blank the broken img
          // (placeholder shows through) and re-set the same src after
          // RETRY_DELAY_MS to force a single refetch; only the second
          // failure marks the layer failed
          retriedRef.current = src
          setRetrySrc(src)
          window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = window.setTimeout(() => setRetrySrc(''), RETRY_DELAY_MS)
        } else {
          // standalone image failure after the single retry, or the CDN
          // fallback failed too: permanent placeholder
          onFailed()
        }
      }}
    />
  )
}

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
// #90: the cover-load gate for the entry burst (see artLoadDelay.ts) —
// holds the src back until the delay has passed, then releases it for good.
// Re-arms when the src or the delay change; a delay of 0 at any point
// (e.g. the dial landing on a still-pending card) reveals immediately.
function useDelayedSrc(src: string | undefined, delayMs: number): string | undefined {
  const [revealed, setRevealed] = useState(delayMs <= 0)
  useEffect(() => {
    if (delayMs <= 0) {
      setRevealed(true)
      return undefined
    }
    const t = window.setTimeout(() => setRevealed(true), delayMs)
    return () => window.clearTimeout(t)
  }, [src, delayMs])
  return revealed ? src : undefined
}

function AlbumArtImpl({ src, size = 200, alt = '', loadDelayMs = 0 }: Props) {
  // #90: everything below works on the REVEALED value — while it is still
  // hidden the layers render the placeholder (no <img>, bug27), so the
  // gated src swaps in exactly like a regular late src change
  const effectiveSrc = useDelayedSrc(src, loadDelayMs)
  // epic10 task 2: the remoteBlur feature flips the <img> to the Pi's
  // pre-processed artwork (see ArtImage) — standalone stays untouched
  const { features } = useMiraServer()
  const [front, setFront] = useState<string | undefined>(effectiveSrc)
  const [back, setBack] = useState<string | undefined>(undefined)
  const [showFront, setShowFront] = useState(true)
  const [frontFailed, setFrontFailed] = useState(false)
  const [backFailed, setBackFailed] = useState(false)
  const lastRef = useRef<string | undefined>(effectiveSrc)
  const cleanupRef = useRef(0)

  useEffect(() => {
    if (effectiveSrc === lastRef.current) return
    lastRef.current = effectiveSrc

    if (showFront) {
      setBack(effectiveSrc)
      setBackFailed(false)
      setShowFront(false)
    } else {
      setFront(effectiveSrc)
      setFrontFailed(false)
      setShowFront(true)
    }

    window.clearTimeout(cleanupRef.current)
    cleanupRef.current = window.setTimeout(() => {
      if (showFront) setFront(undefined)
      else setBack(undefined)
    }, FADE_MS + 60)
  }, [effectiveSrc, showFront])

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
        <ArtImage src={image} remote={features.remoteBlur} alt={alt} onFailed={onErr} />
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
