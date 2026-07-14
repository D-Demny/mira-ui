import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import styles from './PcConnect.module.scss'

// deep link to the USB setup steps in the releases README
const GUIDE_URL =
  'https://github.com/mira-thing/mira-releases/tree/main#method-a-usb-tethering-windowsmaclinux'

function PcConnectImpl() {
  return (
    <div className={styles.container}>
      <div className={styles.headline}>
        <span className={styles.pulseDot} aria-hidden />
        <span className={styles.title}>Connect to PC</span>
      </div>

      <div className={styles.guideRow}>
        <div className={styles.info}>
          <div className={styles.body}>Plug the Car Thing into a device that has internet.</div>

          <div className={styles.caution}>
            Use a <strong>data-capable USB cable</strong>.
          </div>
        </div>

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
      </div>

      <div className={styles.hint}>Screen closes automatically once you&apos;re online.</div>
    </div>
  )
}

export const PcConnect = memo(PcConnectImpl)
