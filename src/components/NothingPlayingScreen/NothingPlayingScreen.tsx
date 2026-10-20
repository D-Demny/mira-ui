import { memo, useEffect } from 'react'
import { PlayIcon } from '@/components/Controls/icons'
import { DevicePicker } from '@/components/DevicePicker'
import { refreshConnectDevices } from '@/api/client'
import type { ConnectDevice, MaDevice } from '@/api/types'
import { useMaDevices } from '@/hooks/useConnectDevices'
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
  // issue #134: 'ma' switches the picker to the Music Assistant list (fetched
  // by this component via useMaDevices; taps route to onSelectMaDevice). The
  // default 'spotify' path is untouched.
  source?: 'spotify' | 'ma'
  onSelectMaDevice?: (device: MaDevice) => void
}

function NothingPlayingScreenImpl({
  connected,
  devices,
  onSelectDevice,
  defaultDeviceId,
  source = 'spotify',
  onSelectMaDevice,
}: Props) {
  // issue #134: fetch the MA list only while the MA source is selected (no
  // request at all on the Spotify path); the hook also refetches after
  // websocket reconnect.
  const maMode = source === 'ma'
  const maDevices = useMaDevices(maMode)
  // issue #127: the live cluster only lists currently registered devices, so
  // ask the daemon for a fresh account-wide list when this screen shows up
  // (fire-and-forget; the daemon also polls periodically). The MA source
  // skips it — its list comes from useMaDevices above.
  useEffect(() => {
    if (!maMode) void refreshConnectDevices().catch(() => {})
  }, [maMode])
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
      <DevicePicker
        devices={filteredDevices}
        onSelect={onSelectDevice}
        source={source}
        maDevices={maDevices}
        onMaSelect={onSelectMaDevice}
      />
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
