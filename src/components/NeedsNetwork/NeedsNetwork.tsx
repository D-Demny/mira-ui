import { memo, useEffect } from 'react'
import { BT_DEVICE_NAME } from '@/brand'
import styles from './NeedsNetwork.module.scss'

interface Props {
  onMount?: () => void
  retryMs?: number
}

function NeedsNetworkImpl({ onMount, retryMs = 3000 }: Props) {
  useEffect(() => {
    if (!onMount) return
    onMount()
    const id = window.setInterval(onMount, retryMs)
    return () => window.clearInterval(id)
  }, [onMount, retryMs])

  return (
    <div className={styles.container}>
      <div className={styles.headline}>
        <span className={styles.pulseDot} aria-hidden />
        <span className={styles.title}>Connect a phone</span>
      </div>

      <ol className={styles.steps}>
        <li>
          <span className={styles.stepNum}>1</span>
          <span className={styles.stepBody}>
            On your phone, open <strong>Bluetooth settings</strong>
          </span>
        </li>
        <li>
          <span className={styles.stepNum}>2</span>
          <span className={styles.stepBody}>
            Pair with <strong className={styles.devName}>{BT_DEVICE_NAME}</strong>
          </span>
        </li>
        <li>
          <span className={styles.stepNum}>3</span>
          <span className={styles.stepBody}>
            Enable <strong>Bluetooth tethering</strong> on the phone (detailed instructions for this
            step are in the discord)
          </span>
        </li>
      </ol>

      <div className={styles.hint}>Closes automatically when your phone provides internet</div>
    </div>
  )
}

export const NeedsNetwork = memo(NeedsNetworkImpl)
