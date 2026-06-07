import { memo } from 'react'
import { PlayIcon } from '@/components/Controls/icons'
import { DevicePicker } from '@/components/DevicePicker'
import type { ConnectDevice } from '@/api/types'
import styles from './IdleScreen.module.scss'

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
}

function IdleScreenImpl({ connected, devices, onSelectDevice }: Props) {
  const subtitle =
    devices.length > 0
      ? 'No remote device is currently playing. \n Select one below'
      : 'No remote device is currently playing'

  return (
    <div className={styles.idle}>
      <div className={styles.icon} aria-hidden>
        <PlayIcon size={64} />
      </div>
      <div className={styles.title}>Nothing playing</div>
      <div className={styles.hint}>{subtitle}</div>
      <DevicePicker devices={devices} onSelect={onSelectDevice} placement="inline" />
      {/* TODO: figure this out a little more, the connected/reconnecting signals our connection to the backend daemon.
          Theoretically with testing and error handling it shouldn't ever crash.. but it can be misleading to mean internet*/}
      {!connected ? (
        <div className={styles.status}>
          <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />
          <span>Reconnecting...</span>
        </div>
      ) : null}
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
