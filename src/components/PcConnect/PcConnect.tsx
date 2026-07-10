import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import styles from './PcConnect.module.scss'

// deep link to the USB setup steps in the releases README
const GUIDE_URL =
  'https://github.com/mira-thing/mira-releases#method-a-usb-tethering-windows-only-untested-on-linux'
  // TODO prob update this link after updating the release readme

function PcConnectImpl() {
  return (
    <div className={styles.container}>
      <div className={styles.headline}>
        <span className={styles.pulseDot} aria-hidden />
        <span className={styles.title}>Connect to PC</span>
      </div>

      <div className={styles.body}>Plug the Car Thing into a device that has internet.</div>

      <div className={styles.caution}>
        Use a <strong>data-capable USB cable</strong>.
      </div>

      <div className={styles.qrBox}>
        <QRCodeSVG
          value={GUIDE_URL}
          size={124}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
          marginSize={2}
        />
      </div>

      <div className={styles.hint}>
        Scan for the full setup guide on GitHub
        <br />
        Screen closes automatically once you&apos;re online.
      </div>
    </div>
  )
}

export const PcConnect = memo(PcConnectImpl)
