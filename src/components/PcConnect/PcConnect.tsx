import { memo } from 'react'
import styles from './PcConnect.module.scss'

// TODO: move some instructions from the readme to here as well, maybe a qr code?
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

      <div className={styles.hint}>
        Full setup guide is on the discord
        <br />
        Screen closes automatically once you're online.
      </div>
    </div>
  )
}

export const PcConnect = memo(PcConnectImpl)
