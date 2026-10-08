import { memo, type CSSProperties } from 'react'
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
// issue #103: the scene grid template scales with its count so tiles fill the
// panel evenly. issue #122: the grid + "Beleuchtung" header are wrapped in a
// content-sized glass panel (scenePanel) that is vertically centered in the
// 2/3 column, mirroring the device card on the left — never breaking out of
// the right column.
//   1 scene        -> one large tile filling the whole cell (1x1)
//   2 scenes       -> two tiles side by side (2 x 1)
//   3 scenes       -> a 2-top / 1-wide-bottom podium: the third tile spans the
//                     full width of the row below the first two (2 cols, 2 rows)
//   4+ scenes      -> a denser 2-wide grid, one row per pair (2 x ceil(n/2))
function sceneLayout(count: number): CSSProperties {
  if (count <= 1)
    return { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }
  if (count === 2)
    return { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'minmax(0, 1fr)' }
  if (count === 3) {
    // the third tile spans both columns as the wide bottom row — its span is
    // applied per tile in the render below
    return {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    }
  }
  return {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridTemplateRows: `repeat(${Math.ceil(count / 2)}, minmax(0, 1fr))`,
  }
}

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
          // issue #102: the scene zone as its own column — and issues #113/#122:
          // the "Beleuchtung" header + grid live TOGETHER inside a translucent
          // glass panel (scenePanel), the same block styling as the device
          // card on the left. The header therefore flows directly above the
          // grid in one DOM unit and the whole group is vertically centered —
          // no detached title at the top edge of the screen.
          <div className={styles.sceneCol}>
            <div className={styles.scenePanel}>
              <div className={styles.sectionHeader}>Beleuchtung</div>
              <div
                className={styles.sceneGrid}
                style={sceneLayout(scenes.length)}
                aria-label="Scenes"
              >
                {scenes.map((scene, index) => (
                  <div
                    key={scene.entityId}
                    className={styles.sceneTile}
                    role="button"
                    tabIndex={0}
                    style={
                      scenes.length === 3 && index === 2 ? { gridColumn: '1 / -1' } : undefined
                    }
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
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const IdleScreen = memo(IdleScreenImpl)
