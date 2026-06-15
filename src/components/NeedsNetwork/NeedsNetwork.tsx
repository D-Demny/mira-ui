import { memo, useEffect } from 'react'
import { BT_DEVICE_NAME } from '@/brand'
import { useKnownDevices } from '@/hooks/useKnownDevices'
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

  const { devices } = useKnownDevices(true)
  const connectedDevice = devices?.find((d) => d.connected)

  if (connectedDevice) {
    const name = connectedDevice.name || connectedDevice.address
    return (
      <div className={styles.container}>
        <div className={styles.headline}>
          <span className={styles.pulseDot} aria-hidden />
          <span className={styles.title}>Connected, no internet yet</span>
        </div>

        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNum}>1</span>
            <span className={styles.stepBody}>
              <strong className={styles.devName}>{name}</strong> is connected, but isn't sharing
              internet
            </span>
          </li>
          <li>
            <span className={styles.stepNum}>2</span>
            <span className={styles.stepBody}>
              On the phone, enable <strong>Bluetooth tethering</strong> (iPhone:{' '}
              <strong>Personal Hotspot</strong> with "Allow Others to Join")
            </span>
          </li>
        </ol>

        <div className={styles.hint}>Closes automatically when internet is available</div>
      </div>
    )
  }

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
