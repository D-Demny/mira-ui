import { memo } from 'react'
import {
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  SeekBack15Icon,
  SeekForward15Icon,
  ShuffleIcon,
} from './icons'
import styles from './Controls.module.scss'

import type { RepeatMode } from '@/components/Menu'

interface Props {
  isPaused: boolean
  shuffle: boolean
  repeat: RepeatMode
  disallowPrev?: boolean
  disallowNext?: boolean
  // podcast mode: shuffle/repeat become rewind/forward 15s
  isPodcast?: boolean
  onPrev?: () => void
  onPlayPause?: () => void
  onNext?: () => void
  onMore?: () => void
  onToggleShuffle?: () => void
  onCycleRepeat?: () => void
  onRewind15?: () => void
  onForward15?: () => void
}

function ControlsImpl({
  isPaused,
  shuffle,
  repeat,
  disallowPrev = false,
  disallowNext = false,
  isPodcast = false,
  onPrev,
  onPlayPause,
  onNext,
  onMore,
  onToggleShuffle,
  onCycleRepeat,
  onRewind15,
  onForward15,
}: Props) {
  const repeatActive = repeat !== 'off'

  return (
    <div className={styles.row}>
      <div className={styles.spacer} aria-hidden />

      <div className={styles.center}>
        {isPodcast ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnXs}`}
            aria-label="Rewind 15 seconds"
            onClick={onRewind15}
          >
            <SeekBack15Icon size={24} />
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnXs} ${shuffle ? styles.toggleOn : ''}`}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            onClick={onToggleShuffle}
          >
            <ShuffleIcon size={24} />
          </button>
        )}

        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${disallowPrev ? styles.btnDisabled : ''}`}
          aria-label="Previous"
          aria-disabled={disallowPrev}
          disabled={disallowPrev}
          onClick={disallowPrev ? undefined : onPrev}
        >
          <PrevIcon size={32} />
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnLg}`}
          aria-label={isPaused ? 'Play' : 'Pause'}
          onClick={onPlayPause}
        >
          {isPaused ? <PlayIcon size={32} /> : <PauseIcon size={32} />}
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${disallowNext ? styles.btnDisabled : ''}`}
          aria-label="Next"
          aria-disabled={disallowNext}
          disabled={disallowNext}
          onClick={disallowNext ? undefined : onNext}
        >
          <NextIcon size={32} />
        </button>

        {isPodcast ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnXs}`}
            aria-label="Forward 15 seconds"
            onClick={onForward15}
          >
            <SeekForward15Icon size={24} />
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnXs} ${repeatActive ? styles.toggleOn : ''}`}
            aria-label={`Repeat ${repeat}`}
            aria-pressed={repeatActive}
            onClick={onCycleRepeat}
          >
            {repeat === 'track' ? <RepeatOneIcon size={24} /> : <RepeatIcon size={24} />}
          </button>
        )}
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnXs}`}
          aria-label="More"
          onClick={onMore}
        >
          <MoreIcon size={24} />
        </button>
      </div>
    </div>
  )
}

export const Controls = memo(ControlsImpl)
