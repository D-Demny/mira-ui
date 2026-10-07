import { memo } from 'react'
import { MenuIcon } from '@/components/MainMenuView/MenuIcon'
import { sceneMenuIcon } from '@/components/MainMenuView/homeDashboard'
import { DevicePicker } from '@/components/DevicePicker'
import { useHomeSelectedEntities } from '@/hooks/useHomeEntities'
import type { ConnectDevice } from '@/api/types'
import styles from './IdleScreen.module.scss'

// issue #95: the idle dashboard replaces the old "Nothing playing" screen.
// Two zones, side by side: ~65% left = the HA scenes the user configured in
// the entity picker (the SAME selection store as the Home dashboard — a
// scene selected there appears here), ~35% right = the audio devices as a
// compact vertical stack. With no scenes configured the scene zone is hidden
// ENTIRELY and the device column centers (spec AC "hidden when unconfigured").
// Scene tiles actuate via the shared entity store (scene/turn_on); no polling
// while idle (pollActive=false) — only the one initial read per tile.

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
  defaultDeviceId?: string | null
}

function IdleScreenImpl({ connected, devices, onSelectDevice, defaultDeviceId }: Props) {
  const selectedEntities = useHomeSelectedEntities(false)
  // only scenes reach the idle dashboard — lights/covers/switches stay in the
  // Home dashboard's zone layout
  const scenes = selectedEntities.filter((e) => e.domain === 'scene')

  const filteredDevices =
    defaultDeviceId && defaultDeviceId !== ''
      ? devices.filter((d) => d.id === defaultDeviceId)
      : devices

  return (
    <div className={`${styles.idle}${scenes.length > 0 ? ` ${styles.split}` : ''}`}>
      {scenes.length > 0 ? (
        <div className={styles.sceneGrid} aria-label="Scenes">
          {scenes.map((scene) => (
            <div
              key={scene.entityId}
              className={styles.sceneTile}
              role="button"
              tabIndex={0}
              onClick={() => scene.actuate()}
            >
              <span className={styles.sceneIcon} aria-hidden>
                <MenuIcon name={sceneMenuIcon(scene.icon ?? null, scene.label)} size={32} />
              </span>
              <span className={styles.sceneLabel}>{scene.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.deviceCol}>
        <DevicePicker devices={filteredDevices} onSelect={onSelectDevice} compact />
        {!connected ? (
          <div className={styles.status}>
            <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />
            <span>Reconnecting...</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
