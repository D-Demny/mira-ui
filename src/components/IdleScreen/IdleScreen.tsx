import { memo } from 'react'
import { MenuIcon } from '@/components/MainMenuView/MenuIcon'
import { sceneMenuIcon } from '@/components/MainMenuView/homeDashboard'
import { DevicePicker } from '@/components/DevicePicker'
import { useHomeSelectedEntities } from '@/hooks/useHomeEntities'
import type { ConnectDevice } from '@/api/types'
import styles from './IdleScreen.module.scss'

// issue #95: the idle dashboard replaces the old "Nothing playing" screen.
// issue #97: two zones, side by side — devices on the LEFT, HA scenes on the
// RIGHT. issue #102: the split is STRICT — exactly 1/3 of the content width
// for the device stack (under its "Spotify abspielen" header) and 2/3 for the
// scene zone, which now carries its own "Beleuchtung" section header above
// the tiles. The scenes come from the SAME selection store as the Home
// dashboard (a scene selected there appears here). With no scenes configured
// the scene zone is hidden ENTIRELY and the device column centers (spec AC
// "hidden when unconfigured").
// issue #99: behind the content sits the same blurred-ambient background as
// the screensaver — the last known track art (blurred + darkened); without any
// known art a plain radial gradient stands in. The cards keep their solid
// $surface-elev surface, so legibility on both backgrounds is unchanged.
// Scene tiles actuate via the shared entity store (scene/turn_on); no polling
// while idle (pollActive=false) — only the one initial read per tile.

interface Props {
  connected: boolean
  devices: ConnectDevice[]
  onSelectDevice?: (device: ConnectDevice) => void
  defaultDeviceId?: string | null
  // issue #99: last known track art for the blurred background (''/null = none)
  artUrl?: string | null
}

function IdleScreenImpl({ connected, devices, onSelectDevice, defaultDeviceId, artUrl }: Props) {
  const selectedEntities = useHomeSelectedEntities(false)
  // only scenes reach the idle dashboard — lights/covers/switches stay in the
  // Home dashboard's zone layout
  const scenes = selectedEntities.filter((e) => e.domain === 'scene')

  const filteredDevices =
    defaultDeviceId && defaultDeviceId !== ''
      ? devices.filter((d) => d.id === defaultDeviceId)
      : devices

  return (
    <div className={styles.idle}>
      {artUrl ? (
        <div className={styles.art} style={{ backgroundImage: `url(${artUrl})` }} aria-hidden />
      ) : (
        <div className={styles.plain} aria-hidden />
      )}
      <div className={styles.scrim} aria-hidden />
      <div className={`${styles.content}${scenes.length > 0 ? ` ${styles.split}` : ''}`}>
        <div className={styles.deviceCol}>
          <DevicePicker devices={filteredDevices} onSelect={onSelectDevice} compact />
          {!connected ? (
            <div className={styles.status}>
              <span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />
              <span>Reconnecting...</span>
            </div>
          ) : null}
        </div>
        {scenes.length > 0 ? (
          // issue #102: the scene zone as its own column — the "Beleuchtung"
          // section header on top, the grid filling the rest of the 2/3 cell
          <div className={styles.sceneCol}>
            <div className={styles.sectionHeader}>Beleuchtung</div>
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
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
