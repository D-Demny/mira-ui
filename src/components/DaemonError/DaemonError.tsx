import { memo } from 'react'
import styles from './DaemonError.module.scss'

// in case daemon crashes we want to surfance some error
// not currently working
// TODO get working obv but also a restart prompt for the device
function DaemonErrorImpl() {
  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.title}>Daemon isn't running</div>
        <div className={styles.body}>Restart the device and report the error in the Discord.</div>
      </div>
    </div>
  )
}

export const DaemonError = memo(DaemonErrorImpl)
