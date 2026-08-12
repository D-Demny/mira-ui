import { memo } from 'react'
import type { ConnectDevice } from '@/api/types'
import styles from './DefaultDeviceModal.module.scss'

interface Props {
  devices: ConnectDevice[]
  currentDefaultId: string | null
  isActiveDevice: boolean
  onTransfer: () => Promise<void>
  onChange: (deviceId: string | null) => void
  onClose: () => void
}

function DeviceIcon({ type }: { type: string }) {
  if (type === 'SMARTPHONE' || type === 'TABLET') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13.25 16.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z" fill="currentColor" />
      </svg>
    )
  }
  if (type === 'COMPUTER' || type === 'CHROMEBOOK') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M3 5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1 17h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DefaultDeviceModalImpl({
  devices,
  currentDefaultId,
  isActiveDevice,
  onTransfer,
  onChange,
  onClose,
}: Props) {
  const activeDevice = devices.find((d) => d.is_active)
  const currentDefault = devices.find((d) => d.id === currentDefaultId)

  const handleSelect = (deviceId: string) => {
    onChange(deviceId)
    if (isActiveDevice && activeDevice && activeDevice.id !== deviceId) {
      void onTransfer()
    }
  }

  const handleClear = () => {
    onChange(null)
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Default Device</span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {currentDefault && (
            <div className={styles.currentPreview}>
              <span className={styles.currentName}>
                {currentDefault.name}
                {currentDefault.is_offline && <span className={styles.offline}> (offline)</span>}
              </span>
              {currentDefault.is_active && <span className={styles.activeTag}>active</span>}
            </div>
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
            onClick={() => void onTransfer()}
          >
            Play on {currentDefault.name}
          </button>
        )}
      </div>
    </div>
  )
}

export const DefaultDeviceModal = memo(DefaultDeviceModalImpl)
