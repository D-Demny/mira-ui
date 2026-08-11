import { memo } from 'react'
import type { ConnectDevice } from '@/api/types'
import styles from './DefaultDeviceRow.module.scss'

interface Props {
  devices: ConnectDevice[]
  currentDefaultId: string | null
  isActiveDevice: boolean
  onTransfer: () => Promise<void>
  onChange: (deviceId: string | null) => void
}

function DeviceIcon({ type }: { type: string }) {
  if (type === 'SMARTPHONE' || type === 'TABLET') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13.25 16.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z" fill="currentColor" />
      </svg>
    )
  }
  if (type === 'COMPUTER' || type === 'CHROMEBOOK') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M3 5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 17h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DefaultDeviceRowImpl({
  devices,
  currentDefaultId,
  isActiveDevice,
  onTransfer,
  onChange,
}: Props) {
  const activeDevice = devices.find((d) => d.is_active)
  const currentDefault = devices.find((d) => d.id === currentDefaultId)

  const handleSelect = (deviceId: string) => {
    onChange(deviceId)
    // transfer if music is playing on a different device
    if (isActiveDevice && activeDevice && activeDevice.id !== deviceId) {
      void onTransfer()
    }
  }

  const handleClear = () => {
    onChange(null)
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>Default Device</span>
        {currentDefault && (
          <span className={styles.current}>
            {currentDefault.name}
            {currentDefault.is_offline && <span className={styles.offline}> (offline)</span>}
          </span>
        )}
      </div>

      <ul className={styles.list}>
        <li
          className={`${styles.option} ${currentDefaultId === null ? styles.selected : ''}`}
          role="button"
          tabIndex={0}
          onClick={handleClear}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleClear()
            }
          }}
        >
          <span className={styles.radio} />
          <span className={styles.optionName}>None</span>
        </li>
        {devices.map((d) => {
          const isSelected = d.id === currentDefaultId
          return (
            <li
              key={d.id}
              className={`${styles.option} ${isSelected ? styles.selected : ''} ${
                d.is_offline ? styles.offline : ''
              }`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleSelect(d.id)
                }
              }}
            >
              <span className={styles.radio} />
              <span className={styles.icon}>
                <DeviceIcon type={d.type} />
              </span>
              <span className={styles.optionName}>{d.name}</span>
              {d.is_active && <span className={styles.activeDot} />}
              {d.is_offline && <span className={styles.offlineLabel}>offline</span>}
            </li>
          )
        })}
      </ul>

      {isActiveDevice && currentDefaultId && currentDefault && !currentDefault.is_active && (
        <button
          type="button"
          className={styles.transferBtn}
          onClick={onTransfer}
        >
          Play on {currentDefault.name}
        </button>
      )}
    </div>
  )
}

export const DefaultDeviceRow = memo(DefaultDeviceRowImpl)
