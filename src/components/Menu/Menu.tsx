import { memo } from 'react'
import styles from './Menu.module.scss'

export type RepeatMode = 'off' | 'context' | 'track'

interface Props {
  open: boolean
  onClose: () => void

  showLyrics: boolean
  onToggleLyrics: () => void
}

// TODO: add some more setting toggles here (vol, brightness etc)
function MenuImpl({ open, onClose, showLyrics, onToggleLyrics }: Props) {
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
        <Row label="Show Lyrics" value={showLyrics ? 'On' : 'Off'} onClick={onToggleLyrics} />
      </div>
    </div>
  )
}

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </button>
  )
}

export const Menu = memo(MenuImpl)
