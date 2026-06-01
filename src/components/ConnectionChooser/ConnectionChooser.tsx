import { memo } from 'react'
import styles from './ConnectionChooser.module.scss'

interface Props {
  onPickPc: () => void
  onPickBluetooth: () => void
}

function BluetoothIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.5 6.5l11 11-5.5 5.5V1l5.5 5.5-11 11" />
    </svg>
  )
}

function PcIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

// when no internet is present we show these options
// TODO: bluetooth descoverablilty should only be set when the bluetooth screen is shown
function ConnectionChooserImpl({ onPickPc, onPickBluetooth }: Props) {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Choose a connection method</h1>

      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={onPickPc} aria-label="Connect to PC">
          <span className={styles.iconWrap} aria-hidden>
            <PcIcon />
          </span>
          <span className={styles.cardLabel}>Connect to PC</span>
        </button>

        <button
          type="button"
          className={styles.card}
          onClick={onPickBluetooth}
          aria-label="Connect with Bluetooth"
        >
          <span className={styles.iconWrap} aria-hidden>
            <BluetoothIcon />
          </span>
          <span className={styles.cardLabel}>Connect with Bluetooth</span>
        </button>
      </div>
    </div>
  )
}

export const ConnectionChooser = memo(ConnectionChooserImpl)
