import { memo } from 'react'
import type { ConnectDevice } from '@/api/types'
import { DeviceTypeIcon } from '@/components/DeviceTypeIcon'
import styles from './DevicePicker.module.scss'

// issue #92: only the inline placement remains — it is embedded in the idle
// screen. The modal output picker now lives in OutputPicker (the "Ausgabegeräte"
// dialog opened by the player's speaker icon).

interface Props {
  devices: ConnectDevice[]
  onSelect?: (device: ConnectDevice) => void
}

function DeviceList({
  devices,
  onSelect,
}: {
  devices: ConnectDevice[]
  onSelect?: (d: ConnectDevice) => void
}) {
  return (
    <ul className={styles.list}>
      {devices.map((d) => {
        const interactive = Boolean(onSelect) && d.can_transfer && !d.is_offline
        return (
          <li key={d.id}>
            <div
              className={`${styles.row} ${d.is_active ? styles.active : ''} ${
                interactive ? styles.interactive : ''
              }`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelect?.(d) : undefined}
            >
              <span className={styles.icon}>
                <DeviceTypeIcon type={d.type} />
              </span>
              <span className={styles.name}>{d.name}</span>
              {d.is_active ? <span className={styles.activeDot} aria-label="active" /> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DevicePickerImpl({ devices, onSelect }: Props) {
  const empty = <div className={styles.empty}>No active devices to select from for playback</div>

  // always render the box even if no items
  return (
    <div className={styles.cardInline}>
      <div className={styles.header}>Devices</div>
      {devices.length === 0 ? empty : <DeviceList devices={devices} onSelect={onSelect} />}
    </div>
  )
}

export const DevicePicker = memo(DevicePickerImpl)
