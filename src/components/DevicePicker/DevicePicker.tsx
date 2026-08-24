import { memo } from 'react'
import type { ConnectDevice } from '@/api/types'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import styles from './DevicePicker.module.scss'

interface Props {
  devices: ConnectDevice[]
  onSelect?: (device: ConnectDevice) => void
  placement?: 'inline' | 'modal'
  onClose?: () => void
}

const ICON_PATHS = {
  phone:
    'M5 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zm3-1a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM13.25 16.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  pc: 'M0 21a1 1 0 0 1 1-1h22a1 1 0 1 1 0 2H1a1 1 0 0 1-1-1M3 5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm3-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z',
  generic:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z',
} as const

function deviceIconKey(type: string): keyof typeof ICON_PATHS {
  switch (type) {
    case 'SMARTPHONE':
    case 'TABLET':
      return 'phone'
    case 'COMPUTER':
    case 'CHROMEBOOK':
      return 'pc'
    default:
      return 'generic'
  }
}

function DeviceTypeIcon({ type, size = 22 }: { type: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden
    >
      <path d={ICON_PATHS[deviceIconKey(type)]} />
    </svg>
  )
}

function DeviceList({
  devices,
  onSelect,
  focusedIndex,
  setFocusRef,
  onFocusRow,
}: {
  devices: ConnectDevice[]
  onSelect?: (d: ConnectDevice) => void
  // bug31: rotary dial focus (passed by the modal placement only)
  focusedIndex?: number
  setFocusRef?: (el: HTMLElement | null) => void
  onFocusRow?: (index: number) => void
}) {
  return (
    <ul className={styles.list}>
      {devices.map((d, index) => {
        const interactive = Boolean(onSelect) && d.can_transfer && !d.is_offline
        const focused = focusedIndex === index
        return (
          <li key={d.id}>
            <div
              className={`${styles.row} ${d.is_active ? styles.active : ''} ${
                interactive ? styles.interactive : ''
              } ${focused ? styles.focused : ''}`}
              ref={focused && setFocusRef ? setFocusRef : undefined}
              role={interactive || focused ? 'button' : undefined}
              tabIndex={interactive || focused ? 0 : undefined}
              onClick={
                interactive
                  ? () => {
                      onFocusRow?.(index)
                      onSelect?.(d)
                    }
                  : undefined
              }
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

// bug31: the modal placement registers a list focus entry so the dial/back
// buttons work inside the popup. It is a separate component because the hook
// must not run conditionally.
function DevicePickerModal({
  devices,
  onSelect,
  onClose,
}: {
  devices: ConnectDevice[]
  onSelect?: (device: ConnectDevice) => void
  onClose?: () => void
}) {
  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: devices.length,
    onConfirm: (index) => {
      const d = devices[index]
      // only the interactive rows (can transfer, online) select, like a tap
      if (d && d.can_transfer && !d.is_offline) onSelect?.(d)
    },
    onBack: () => onClose?.(),
    initialIndex: Math.max(0, devices.findIndex((d) => d.is_active)),
  })

  const empty = <div className={styles.empty}>No active devices to select from for playback</div>

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.cardModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>Devices</div>
        {devices.length === 0 ? (
          empty
        ) : (
          <DeviceList
            devices={devices}
            onSelect={onSelect}
            focusedIndex={focusedIndex}
            setFocusRef={setFocusRef}
            onFocusRow={tapItem}
          />
        )}
      </div>
    </div>
  )
}

function DevicePickerImpl({ devices, onSelect, placement = 'inline', onClose }: Props) {
  if (placement === 'modal') {
    return <DevicePickerModal devices={devices} onSelect={onSelect} onClose={onClose} />
  }

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
