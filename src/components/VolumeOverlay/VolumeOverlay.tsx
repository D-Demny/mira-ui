import type { VolumeOverlayState } from '@/hooks/useHardwareButtons'
import styles from './VolumeOverlay.module.scss'

function SpeakerIcon({ level }: { level: number }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h3.5L13 19V5L7.5 9H4z" fill="currentColor" />
      {level > 0.02 && (
        <path
          d="M16 9a3.5 3.5 0 0 1 0 6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
      {level > 0.5 && (
        <path
          d="M18.5 6.5a7 7 0 0 1 0 11"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="9" rx="2" fill="currentColor" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export function VolumeOverlay({ state }: { state: VolumeOverlayState }) {
  const clamped = Math.max(0, Math.min(1, state.value))

  return (
    <div
      className={`${styles.overlay} ${state.visible ? styles.visible : ''} ${
        state.disabled ? styles.disabled : ''
      }`}
      aria-hidden={!state.visible}
    >
      <span className={styles.icon}>
        {state.disabled ? <LockIcon /> : <SpeakerIcon level={clamped} />}
      </span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ transform: `scaleX(${clamped})` }} />
      </div>
      {state.disabled && <span className={styles.label}>On device</span>}
    </div>
  )
}
