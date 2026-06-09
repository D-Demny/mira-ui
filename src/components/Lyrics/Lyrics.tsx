import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { rgba, useColorExtract, type RGB } from '@/hooks/useColorExtract'
import { useActiveLine } from '@/hooks/useActiveLine'
import { useLyricStarts, useLyrics } from '@/hooks/useLyrics'
import type { ObserverStatusActive } from '@/api/types'
import styles from './Lyrics.module.scss'

// TODO: fix a bug around the tap to lyric function, it will go to that timestamp but the ui will scroll back until it moves on the next lyric

interface Props {
  status: ObserverStatusActive
  onSeek?: (positionMs: number) => void
}

type LineVariant = 'active' | 'adjacent' | 'far' | 'unsynced'

function isInstrumental(lines: { words: string }[]): boolean {
  if (lines.length !== 1) return false
  const w = lines[0].words.trim()
  return /instrumental/i.test(w)
}

const ACTIVE_Y_RATIO = 0.33
const TALL_LINE_TOP_RATIO = 0.12
const SNAP_BACK_MS = 4000

const TINT_ALPHA = 0.18
const BG_R = 0x12
const BG_G = 0x12
const BG_B = 0x12

function compositeBg([r, g, b]: RGB): string {
  const cr = Math.round(TINT_ALPHA * r + (1 - TINT_ALPHA) * BG_R)
  const cg = Math.round(TINT_ALPHA * g + (1 - TINT_ALPHA) * BG_G)
  const cb = Math.round(TINT_ALPHA * b + (1 - TINT_ALPHA) * BG_B)
  return `rgb(${cr}, ${cg}, ${cb})`
}

const LyricLine = memo(function LyricLine({
  text,
  variant,
  onClick,
}: {
  text: string
  variant: LineVariant
  onClick?: () => void
}) {
  const cls =
    variant === 'active'
      ? `${styles.line} ${styles.lineActive}`
      : variant === 'adjacent'
        ? `${styles.line} ${styles.lineAdjacent}`
        : variant === 'far'
          ? `${styles.line} ${styles.lineFar}`
          : `${styles.line} ${styles.lineUnsynced}`
  if (!onClick) {
    return <div className={cls}>{text}</div>
  }
  return (
    <div className={`${cls} ${styles.lineClickable}`} role="button" tabIndex={0} onClick={onClick}>
      {text}
    </div>
  )
})

function LyricsImpl({ status, onSeek }: Props) {
  const isPodcast = status.track_uri.startsWith('spotify:episode:')
  const { lyrics, loading, error } = useLyrics({
    trackId: status.track_id || null,
    trackName: status.track_name,
    artist: status.track_artist,
    album: status.track_album,
    durationMs: status.duration,
    episode: isPodcast,
  })

  const color: RGB = useColorExtract(status.track_image)
  const starts = useLyricStarts(lyrics)
  const synced = lyrics?.syncType === 'LINE_SYNCED'
  const activeIdx = useActiveLine(status, synced ? starts : [])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const lineMetrics = useRef<{ top: number; height: number }[]>([])
  const listHeight = useRef(0)

  const offset = useRef(0)
  const userActiveAt = useRef(0)
  const snapBackTimer = useRef(0)
  const dragStartY = useRef(0)
  const dragStartOffset = useRef(0)

  const bgStyle = useMemo(
    () =>
      ({
        '--lyrics-tint': rgba(color, TINT_ALPHA),
        '--lyrics-bg-solid': compositeBg(color),
      }) as React.CSSProperties,
    [color],
  )

  const applyOffset = (instant = false) => {
    const list = listRef.current
    if (!list) return
    const viewport = viewportRef.current
    const maxOffset = viewport ? Math.max(0, listHeight.current - viewport.clientHeight) : 0
    if (offset.current < 0) offset.current = 0
    else if (offset.current > maxOffset) offset.current = maxOffset

    if (instant) {
      list.style.transition = 'none'
      list.style.transform = `translate3d(0, ${-offset.current}px, 0)`
      void list.offsetHeight
      list.style.transition = ''
    } else {
      list.style.transform = `translate3d(0, ${-offset.current}px, 0)`
    }
  }

  const computeAutoTarget = (): number => {
    const viewport = viewportRef.current
    if (!viewport || lineMetrics.current.length === 0) return 0
    const idx = activeIdx < 0 ? 0 : activeIdx
    const line = lineMetrics.current[idx]
    if (!line) return 0
    const centered = line.top - viewport.clientHeight * ACTIVE_Y_RATIO + line.height / 2
    const topAnchored = line.top - viewport.clientHeight * TALL_LINE_TOP_RATIO
    const desired = Math.min(centered, topAnchored)
    const maxOffset = Math.max(0, listHeight.current - viewport.clientHeight)
    return Math.max(0, Math.min(desired, maxOffset))
  }

  const snapBack = () => {
    userActiveAt.current = 0
    offset.current = computeAutoTarget()
    applyOffset()
  }

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      lineMetrics.current = []
      listHeight.current = 0
      return
    }
    const lineNodes = list.querySelectorAll<HTMLElement>(`.${styles.line}`)
    const metrics: { top: number; height: number }[] = []
    for (let i = 0; i < lineNodes.length; i++) {
      const el = lineNodes[i]
      metrics.push({ top: el.offsetTop, height: el.offsetHeight })
    }
    lineMetrics.current = metrics
    listHeight.current = list.scrollHeight
  }, [lyrics])

  useLayoutEffect(() => {
    if (Date.now() - userActiveAt.current < SNAP_BACK_MS) return
    offset.current = computeAutoTarget()
    applyOffset()
  }, [activeIdx, lyrics, status.track_id])

  useEffect(() => {
    window.clearTimeout(snapBackTimer.current)
    userActiveAt.current = 0
    offset.current = 0
    applyOffset(true)
  }, [status.track_id])

  useEffect(
    () => () => {
      window.clearTimeout(snapBackTimer.current)
    },
    [],
  )

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    dragStartY.current = e.touches[0].clientY
    dragStartOffset.current = offset.current
    window.clearTimeout(snapBackTimer.current)
  }

  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const dy = dragStartY.current - e.touches[0].clientY
    offset.current = dragStartOffset.current + dy
    applyOffset(true)
    userActiveAt.current = Date.now()
  }

  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => {
    snapBackTimer.current = window.setTimeout(snapBack, SNAP_BACK_MS)
  }

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    offset.current += e.deltaY
    applyOffset(true)
    userActiveAt.current = Date.now()
    window.clearTimeout(snapBackTimer.current)
    snapBackTimer.current = window.setTimeout(snapBack, SNAP_BACK_MS)
  }

  if (loading) {
    return (
      <div className={`${styles.lyrics} ${styles.state}`} style={bgStyle} ref={containerRef}>
        <div className={styles.stateText}>
          {isPodcast ? 'Loading transcript...' : 'Loading lyrics...'}
        </div>
      </div>
    )
  }

  if (error || !lyrics || lyrics.lines.length === 0) {
    return (
      <div className={`${styles.lyrics} ${styles.state}`} style={bgStyle} ref={containerRef}>
        <div className={styles.stateText}>
          {isPodcast ? 'No transcript available' : 'No lyrics available'}
        </div>
      </div>
    )
  }

  if (isInstrumental(lyrics.lines)) {
    return (
      <div className={`${styles.lyrics} ${styles.state}`} style={bgStyle} ref={containerRef}>
        <div className={styles.stateText}>♪ Instrumental</div>
      </div>
    )
  }

  return (
    <div className={styles.lyrics} style={bgStyle} ref={containerRef}>
      {!synced ? (
        <div className={styles.unsyncedPill} aria-label="lyrics are not time-synced">
          unsynced
        </div>
      ) : null}
      <div
        className={styles.viewport}
        ref={viewportRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onWheel={onWheel}
      >
        <div className={`${styles.list} ${synced ? styles.synced : styles.unsynced}`} ref={listRef}>
          <div className={styles.padTop} aria-hidden />
          {lyrics.lines.map((line, i) => {
            const variant: LineVariant = !synced
              ? 'unsynced'
              : i === activeIdx
                ? 'active'
                : Math.abs(i - activeIdx) === 1 && activeIdx >= 0
                  ? 'adjacent'
                  : 'far'
            const startMs = synced ? starts[i] : undefined
            const onClick =
              !status.disallow_seek && onSeek && typeof startMs === 'number' && startMs >= 0
                ? () => onSeek(startMs)
                : undefined
            return (
              <LyricLine key={i} text={line.words || '♪'} variant={variant} onClick={onClick} />
            )
          })}
          <div className={styles.padBottom} aria-hidden />
        </div>
      </div>
    </div>
  )
}

export const Lyrics = memo(LyricsImpl)
