import { memo, useEffect, useRef } from 'react'
import styles from './TransferPrompt.module.scss'

interface Props {
  active: boolean
  deviceName: string
  onTransfer: () => void
  onDismiss: () => void
}

function TransferPromptImpl({ active, deviceName, onTransfer, onDismiss }: Props) {
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!active) {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      return
    }

    timerRef.current = window.setTimeout(() => {
      onDismiss()
    }, 10000)

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [active, onDismiss])

  return (
    <div
      className={`${styles.overlay} ${active ? styles.visible : ''}`}
      onClick={onDismiss}
      aria-hidden={!active}
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Wiedergabe auf {deviceName}?</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.transferBtn} ${styles.primary}`}
            onClick={() => {
              onTransfer()
              onDismiss()
            }}
          >
            Auf {deviceName} abspielen
          </button>
          <button
            type="button"
            className={`${styles.transferBtn} ${styles.secondary}`}
            onClick={onDismiss}
          >
            Nein
          </button>
        </div>
      </div>
    </div>
  )
}

export const TransferPrompt = memo(TransferPromptImpl)
