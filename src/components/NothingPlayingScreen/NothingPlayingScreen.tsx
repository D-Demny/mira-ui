import { memo, useEffect } from 'react'
import { PlayIcon } from '@/components/Controls/icons'
import { DevicePicker } from '@/components/DevicePicker'
import { refreshConnectDevices } from '@/api/client'
import type { ConnectDevice } from '@/api/types'
import styles from './NothingPlayingScreen.module.scss'

// issue #100: the pre-#95 idle screen, restored for the 'Idle Screen
// aktivieren' OFF state — plain "Nothing playing" with a full-width device
// picker (no scene zone). Markup and copy are unchanged from the old
// IdleScreen (commit 8cb42d2^), so turning the toggle off brings back exactly
// the original behavior.

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
  defaultDeviceId?: string | null
}

function NothingPlayingScreenImpl({ connected, devices, onSelectDevice, defaultDeviceId }: Props) {
  // issue #127: the live cluster only lists currently registered devices, so
  // ask the daemon for a fresh account-wide list when this screen shows up
  // (fire-and-forget; the daemon also polls periodically).
  useEffect(() => {
    void refreshConnectDevices().catch(() => {})
  }, [])
  const filteredDevices =
    defaultDeviceId && defaultDeviceId !== ''
      ? devices.filter((d) => d.id === defaultDeviceId)
      : devices

  const subtitle =
    devices.length > 0
      ? 'No remote device is currently playing. \n Select one below'
      : 'No remote device is currently playing. \n Open Spotify on your phone to control it here'

  return (
    <div className={styles.idle}>
      <div className={styles.icon} aria-hidden>
        <PlayIcon size={64} />
      </div>
      <div className={styles.title}>Nothing playing</div>
      <div className={styles.hint}>{subtitle}</div>
      <DevicePicker devices={filteredDevices} onSelect={onSelectDevice} />
      {!connected ? (
        <div className={styles.status}>
          <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />
          <span>Reconnecting...</span>
        </div>
      ) : null}
    </div>
  )
}

export const NothingPlayingScreen = memo(NothingPlayingScreenImpl)
