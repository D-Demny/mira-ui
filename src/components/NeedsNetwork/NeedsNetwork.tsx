import { memo, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { BT_DEVICE_NAME } from '@/brand'
import { useKnownDevices } from '@/hooks/useKnownDevices'
import styles from './NeedsNetwork.module.scss'

const GUIDE_URL = 'https://github.com/mira-thing/mira-releases/tree/main#method-b-bluetooth'

interface Props {
  onMount?: () => void
  retryMs?: number
}

function GuideQR() {
  return (
    <div className={styles.qrCol}>
      <div className={styles.qrBox}>
        <QRCodeSVG
          value={GUIDE_URL}
          size={148}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
          marginSize={2}
        />
      </div>
      <div className={styles.qrHint}>
        Scan for the full
        <br />
        setup guide on GitHub
      </div>
    </div>
  )
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

        <div className={styles.guideRow}>
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

          <GuideQR />
        </div>

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

      <div className={styles.guideRow}>
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
              Enable <strong>Bluetooth tethering</strong> on the phone
            </span>
          </li>
        </ol>

        <GuideQR />
      </div>

      <div className={styles.hint}>Closes automatically when your phone provides internet</div>
    </div>
  )
}

export const NeedsNetwork = memo(NeedsNetworkImpl)
