import { memo } from 'react'
import { BRAND_NAME } from '@/brand'
import styles from './BootSplash.module.scss'

interface Props {
  caption?: string
  hint?: string // in case something takes too long
}

function BootSplashImpl({ caption, hint }: Props) {
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
        {hint ? <div className={styles.hint}>{hint}</div> : null}
      </div>
    </div>
  )
}

export const BootSplash = memo(BootSplashImpl)
