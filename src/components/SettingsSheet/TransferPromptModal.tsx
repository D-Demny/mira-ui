import { memo, useMemo } from 'react'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import styles from './TransferPromptModal.module.scss'

interface Props {
  /** the default device playback would move to */
  deviceName: string
  onAccept: () => void
  onDecline: () => void
  onCancel: () => void
}

// issue #79: the notification popup that asks whether an interaction (play /
// pause / next / previous / new song) should also move playback to the
// configured default device. Focus starts on 'Yes' — the switch is what the
// user asked for, so one dial press confirms it; dial down for 'No'.
function TransferPromptModalImpl({ deviceName, onAccept, onDecline, onCancel }: Props) {
  const options = useMemo(
    () => [
      { label: 'Yes', run: onAccept },
      { label: 'No', run: onDecline },
    ],
    [onAccept, onDecline],
  )

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: options.length,
    onConfirm: (index) => options[index]?.run(),
    onBack: onCancel,
    initialIndex: 0,
  })

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Default Device</span>
          <button type="button" className={styles.closeBtn} onClick={onCancel} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className={styles.message}>Continue playing on {deviceName}?</p>

        <div className={styles.options}>
          {options.map((option, index) => (
            <div
              key={option.label}
              role="button"
              tabIndex={0}
              className={[styles.option, focusedIndex === index ? styles.focused : '']
                .filter(Boolean)
                .join(' ')}
              ref={focusedIndex === index ? setFocusRef : undefined}
              onClick={() => {
                tapItem(index)
                option.run()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  option.run()
                }
              }}
            >
              <span className={styles.optionName}>{option.label}</span>
            </div>
          ))}
        </div>

        <p className={styles.hint}>With “No” you won’t be asked again for 10 minutes.</p>
      </div>
    </div>
  )
}

export const TransferPromptModal = memo(TransferPromptModalImpl)
