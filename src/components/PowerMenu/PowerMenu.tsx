import { memo, useEffect, useState } from 'react'
import { resetDevice, restartDevice, suspendDevice } from '@/api/system'
import { BRAND_NAME } from '@/brand'
import styles from './PowerMenu.module.scss'

interface Props {
  open: boolean
  onClose: () => void
  onSupport?: () => void
}

// power menu
function PowerMenuImpl({ open, onClose, onSupport }: Props) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState<'sleep' | 'restart' | 'reset' | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmReset(false)
      setBusy(null)
    }
  }, [open])

  const onSleep = () => {
    if (busy) return
    setBusy('sleep')
    void suspendDevice().catch(() => {})
    // screen goes dark
    onClose()
  }

  const onRestart = () => {
    if (busy) return
    setBusy('restart')
    void restartDevice().catch(() => setBusy(null))
    // leave busy true on success
  }

  const onConfirmReset = () => {
    if (busy) return
    setBusy('reset')
    try {
      window.localStorage.clear()
    } catch {
      // ignore
    }
    void resetDevice().catch(() => setBusy(null))
  }

  return (
    <div
      className={`${styles.root} ${open ? styles.open : ''}`}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmReset ? (
          <div className={styles.confirm}>
            <div className={styles.confirmTitle}>Reset device?</div>
            <div className={styles.confirmBody}>
              This forgets your Spotify sign-in and all paired phones, then restarts. You'll need to
              pair and sign in again.
            </div>
            <div className={styles.confirmButtons}>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.secondary}`}
                onClick={() => setConfirmReset(false)}
                disabled={busy === 'reset'}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.confirmDanger}`}
                onClick={onConfirmReset}
                disabled={busy === 'reset'}
              >
                {busy === 'reset' ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className={styles.action} onClick={onSleep} disabled={!!busy}>
              <MoonIcon />
              <span>Sleep</span>
            </button>
            <button type="button" className={styles.action} onClick={onRestart} disabled={!!busy}>
              <RestartIcon />
              <span>{busy === 'restart' ? 'Restarting...' : 'Restart'}</span>
            </button>
            {onSupport ? (
              <button
                type="button"
                className={`${styles.action} ${styles.support}`}
                onClick={onSupport}
                disabled={!!busy}
              >
                <HeartIcon />
                <span>Support {BRAND_NAME}</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              onClick={() => setConfirmReset(true)}
              disabled={!!busy}
            >
              <ResetIcon />
              <span>Reset</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function HeartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" />
    </svg>
  )
}

function RestartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M19 12a7 7 0 1 1-2.05-4.95"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M19 4v4h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 7h12M9 7V5h6v2M7 7l1 12h8l1-12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const PowerMenu = memo(PowerMenuImpl)
