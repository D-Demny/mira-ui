import { memo } from 'react'
import { BRAND_NAME } from '@/brand'
import styles from './BootSplash.module.scss'

interface Props {
  caption?: string
  hint?: string // in case something takes too long
  progress?: number | null
}

function BootSplashImpl({ caption, hint, progress }: Props) {
  const hasProgress = typeof progress === 'number'
  const pct = hasProgress ? Math.max(0, Math.min(100, progress)) : 0
  return (
    <div className={styles.splash}>
      <div className={styles.center}>
        <div className={styles.wordmark} aria-label={BRAND_NAME}>
          {BRAND_NAME.toLowerCase()}
        </div>
        <div className={styles.bars} aria-hidden>
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </div>
        {caption ? <div className={styles.caption}>{caption}</div> : null}
        {hasProgress ? (
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {hint ? <div className={styles.hint}>{hint}</div> : null}
      </div>
    </div>
  )
}

export const BootSplash = memo(BootSplashImpl)
