import { memo } from 'react'
import { PlayIcon } from '@/components/Controls/icons'
import styles from './IdleScreen.module.scss'

interface Props {
  message?: string
  connected: boolean
}

function IdleScreenImpl({ message, connected }: Props) {
  return (
    <div className={styles.idle}>
      <div className={styles.icon} aria-hidden>
        <PlayIcon size={64} />
      </div>
      <div className={styles.title}>Nothing playing</div>
      <div className={styles.hint}>{message ?? 'Play something on Spotify to get started'}</div>
      <div className={styles.status}>
        <span className={`${styles.dot} ${connected ? styles.dotOk : styles.dotOff}`} aria-hidden />
        <span>{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
