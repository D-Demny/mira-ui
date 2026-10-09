import { memo } from 'react'
import type { ConnectDevice } from '@/api/types'
import { DeviceTypeIcon } from '@/components/DeviceTypeIcon'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import styles from './OutputPicker.module.scss'

// mdi:speaker-wireless is the player button (Controls); these are the row
// stars — filled = current Standard-Gerät, outline = not yet.
const STAR_FILLED_PATH =
  'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z'
const STAR_OUTLINE_PATH =
  'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'

function Star({ filled, size = 20 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={filled ? STAR_FILLED_PATH : STAR_OUTLINE_PATH} />
    </svg>
  )
}

// issue #92: the "Ausgabegeräte" modal opened by the speaker icon on the
// player screen. Vertically stacked list of all available audio outputs —
// individual speakers (Spotify Connect devices) with their configured names,
// the active one highlighted. Row tap routes playback there; the star sets
// this speaker as the Standard-Gerät (persisted as settings.defaultDeviceId,
// same value the issue #79 prompt transfers to). Multiroom groups are not
// listed yet: no group data source exists in the stack today (documented on
// issue #92).

export interface OutputPickerProps {
  devices: ConnectDevice[]
  currentDefaultId: string | null
  // tapping a row transfers playback there; the caller closes on success
  onSelect: (device: ConnectDevice) => void
  // tapping a star only persists the Standard-Gerät, no transfer
  onSetDefault: (deviceId: string) => void
  onClose: () => void
}

function OutputPickerImpl({
  devices,
  currentDefaultId,
  onSelect,
  onSetDefault,
  onClose,
}: OutputPickerProps) {
  // bug31 pattern: while the modal is open, the hardware dial and back are
  // routed to its list; confirm selects the focused row.
  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: devices.length,
    onConfirm: (index) => {
      const device = devices[index]
      // issue #127: offline-but-transferable rows (idle speakers from the
      // merged account-wide list) transfer like any other row
      if (device && device.can_transfer) onSelect(device)
    },
    onBack: onClose,
    // start where the playback currently is, like the old device picker did
    initialIndex: Math.max(
      0,
      devices.findIndex((d) => d.is_active),
    ),
  })

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="Ausgabegeräte"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.title}>Ausgabegeräte</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {devices.length === 0 ? (
          <p className={styles.empty}>Keine Audioausgaben verfügbar</p>
        ) : (
          <ul className={styles.list}>
            {devices.map((device, index) => {
              const isDefault = currentDefaultId !== null && device.id === currentDefaultId
              // issue #127: tappable whenever the daemon says a transfer is
              // possible — is_offline only drives the dimmed "offline" look,
              // not interactivity (tapping re-registers the device)
              const interactive = device.can_transfer
              const focused = focusedIndex === index
              return (
                <li key={device.id}>
                  <div
                    className={[
                      styles.row,
                      device.is_active ? styles.activeRow : '',
                      device.is_offline ? styles.offline : '',
                      interactive ? styles.interactive : '',
                      focused ? styles.focused : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    ref={focused ? setFocusRef : undefined}
                    role={interactive || focused ? 'button' : undefined}
                    tabIndex={interactive || focused ? 0 : undefined}
                    onClick={
                      interactive
                        ? () => {
                            tapItem(index)
                            onSelect(device)
                          }
                        : undefined
                    }
                  >
                    <span className={styles.icon}>
                      <DeviceTypeIcon type={device.type} />
                    </span>
                    <span className={styles.texts}>
                      <span className={styles.name}>{device.name}</span>
                      {(device.is_active || device.is_offline) && (
                        <span className={styles.sub}>{device.is_active ? 'Aktiv' : 'offline'}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`${styles.star} ${isDefault ? styles.starFilled : ''}`}
                      aria-label={
                        isDefault
                          ? `Standard-Gerät: ${device.name}`
                          : `${device.name} als Standard-Gerät festlegen`
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        onSetDefault(device.id)
                      }}
                    >
                      <Star filled={isDefault} />
                      {isDefault && <span className={styles.starLabel}>Standard-Gerät</span>}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export const OutputPicker = memo(OutputPickerImpl)
