import { memo, useEffect, useState } from 'react'
import { resetDevice, restartDevice, suspendDevice } from '@/api/system'
import styles from './PowerMenu.module.scss'

interface Props {
  open: boolean
  onClose: () => void
}

// power menu
function PowerMenuImpl({ open, onClose }: Props) {
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
