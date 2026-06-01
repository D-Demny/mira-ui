import { memo, useEffect, useState } from 'react'
import { resetDevice } from '@/api/system'
import styles from './Menu.module.scss'

export type RepeatMode = 'off' | 'context' | 'track'

interface Props {
  open: boolean
  onClose: () => void

  showLyrics: boolean
  onToggleLyrics: () => void
}

function MenuImpl({ open, onClose, showLyrics, onToggleLyrics }: Props) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmResetOpen) setConfirmResetOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, confirmResetOpen])

  useEffect(() => {
    if (!open) {
      setConfirmResetOpen(false)
      setResetting(false)
    }
  }, [open])

  const onConfirmReset = async () => {
    if (resetting) return
    setResetting(true)
    try {
      window.localStorage.clear()
    } catch {
      // ignore
    }
    try {
      await resetDevice()
    } catch {
      // daemon may drop the connection mid-reboot
    }
    // leave resetting=true so the button stays disabled until chromium dies
  }

  return (
    <div
      className={`${styles.root} ${open ? styles.open : styles.closed}`}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden />

        {confirmResetOpen ? (
          <div className={styles.confirmGroup}>
            <div className={styles.confirmTitle}>Reset device?</div>
            <div className={styles.confirmBody}>
              This forgets your Spotify sign-in and all paired phones, then restarts the device.
              You'll need to pair and sign in again.
            </div>
            <div className={styles.confirmButtons}>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.confirmBtnSecondary}`}
                onClick={() => setConfirmResetOpen(false)}
                disabled={resetting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.confirmBtnDanger}`}
                onClick={() => {
                  void onConfirmReset()
                }}
                disabled={resetting}
              >
                {resetting ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <Row label="Show Lyrics" value={showLyrics ? 'On' : 'Off'} onClick={onToggleLyrics} />
            <Row
              label="Reset device"
              value=""
              onClick={() => setConfirmResetOpen(true)}
              destructive
            />
          </>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  onClick,
  destructive,
}: {
  label: string
  value: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      className={`${styles.row} ${destructive ? styles.rowDestructive : ''}`}
      onClick={onClick}
    >
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </button>
  )
}

export const Menu = memo(MenuImpl)
