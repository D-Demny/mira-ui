import { memo } from 'react'
import type { ConnectDevice, MaDevice } from '@/api/types'
import { DeviceTypeIcon } from '@/components/DeviceTypeIcon'
import styles from './DevicePicker.module.scss'

// issue #92: only the inline placement remains — it is embedded in the idle
// screen. The modal output picker now lives in OutputPicker (the "Ausgabegeräte"
// dialog opened by the player's speaker icon).

interface Props {
  devices: ConnectDevice[]
  onSelect?: (device: ConnectDevice) => void
  // issue #95: the idle dashboard's ~35% column — tighter, pill-shaped rows
  compact?: boolean
  // issue #134: 'ma' switches the picker to the Music Assistant player list
  // (maDevices, routed to onMaSelect) with its own header; the default
  // 'spotify' path is untouched — same props, same rows, same copy.
  source?: 'spotify' | 'ma'
  maDevices?: MaDevice[]
  onMaSelect?: (device: MaDevice) => void
}

function DeviceList({
  devices,
  onSelect,
  compact = false,
}: {
  devices: ConnectDevice[]
  onSelect?: (d: ConnectDevice) => void
  compact?: boolean
}) {
  return (
    <ul className={styles.list}>
      {devices.map((d) => {
        // issue #127: interactivity follows can_transfer only — the daemon's
        // merged list marks idle speakers (not in the live cluster) offline
        // yet transferable, and tapping one re-registers it with Spotify,
        // exactly like the official clients
        const interactive = Boolean(onSelect) && d.can_transfer
        return (
          <li key={d.id}>
            <div
              className={`${styles.row} ${compact ? styles.compactRow : ''} ${
                d.is_active ? styles.active : ''
              } ${interactive ? styles.interactive : ''}`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelect?.(d) : undefined}
            >
              <span className={styles.icon}>
                {/* issue #109: prominent left icon in the idle list;
                    issue #114: scaled up to 32px with the enlarged type */}
                <DeviceTypeIcon type={d.type} size={compact ? 32 : 22} />
              </span>
              <span className={styles.textBlock}>
                <span className={styles.name}>{d.name}</span>
              </span>
              {d.is_active ? <span className={styles.activeDot} aria-label="active" /> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// issue #134: the Music Assistant variant of DeviceList — the same row
// anatomy (left icon + name), interactivity gated on `available` exactly like
// `can_transfer` above; there is no active player to dot (tapping a player
// via onMaSelect is what decides playback)
function MaDeviceList({
  devices,
  onSelect,
  compact = false,
}: {
  devices: MaDevice[]
  onSelect?: (d: MaDevice) => void
  compact?: boolean
}) {
  return (
    <ul className={styles.list}>
      {devices.map((d) => {
        const interactive = Boolean(onSelect) && d.available
        return (
          <li key={d.id}>
            <div
              className={`${styles.row} ${compact ? styles.compactRow : ''} ${
                interactive ? styles.interactive : ''
              }`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelect?.(d) : undefined}
            >
              <span className={styles.icon}>
                {/* speakers are the default icon — MA players carry no Connect device type */}
                <DeviceTypeIcon type="" size={compact ? 32 : 22} />
              </span>
              <span className={styles.textBlock}>
                <span className={styles.name}>{d.name}</span>
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DevicePickerImpl({
  devices,
  onSelect,
  compact = false,
  source = 'spotify',
  maDevices,
  onMaSelect,
}: Props) {
  const empty = (
    <div className={styles.empty}>
      {source === 'ma'
        ? 'Keine verfügbaren Wiedergabegeräte'
        : 'No active devices to select from for playback'}
    </div>
  )

  // always render the box even if no items
  return (
    <div className={`${styles.cardInline}${compact ? ` ${styles.compact}` : ''}`}>
      {/* issue #98: the idle dashboard's device zone — titled by its purpose,
          read exactly as written (no CSS uppercasing) */}
      <div className={styles.header}>
        {source === 'ma' ? 'Music Assistant abspielen' : 'Spotify abspielen'}
      </div>
      {source === 'ma' ? (
        maDevices === undefined || maDevices.length === 0 ? (
          empty
        ) : (
          maDevices && <MaDeviceList devices={maDevices} onSelect={onMaSelect} compact={compact} />
        )
      ) : devices.length === 0 ? (
        empty
      ) : (
        <DeviceList devices={devices} onSelect={onSelect} compact={compact} />
      )}
    </div>
  )
}

export const DevicePicker = memo(DevicePickerImpl)
