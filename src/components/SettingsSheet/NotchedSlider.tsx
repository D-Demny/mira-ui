import { memo, useRef } from 'react'
import styles from './NotchedSlider.module.scss'

interface Props {
  ariaLabel: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  disabled?: boolean
  defaultValue?: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function NotchedSliderImpl({
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
  defaultValue,
}: Props) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const count = Math.round((max - min) / step) + 1
  const ratio = max > min ? (value - min) / (max - min) : 0
  const defaultRatio = defaultValue != null && max > min ? (defaultValue - min) / (max - min) : null

  const setFromX = (clientX: number) => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const r = clamp((clientX - rect.left) / rect.width, 0, 1)
    const snapped = clamp(Math.round((min + r * (max - min)) / step) * step, min, max)
    if (snapped !== value) onChange(snapped)
  }

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (disabled) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromX(e.clientX)
  }
  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (dragging.current) setFromX(e.clientX)
  }
  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const stepBy = (dir: 1 | -1) => onChange(clamp(value + dir * step, min, max))

  return (
    <div className={`${styles.row} ${disabled ? styles.disabled : ''}`}>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => stepBy(-1)}
        disabled={disabled || value <= min}
        aria-label={`${ariaLabel} down`}
      >
        −
      </button>
      <div
        className={styles.bar}
        ref={barRef}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.notches} aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={styles.notch} />
          ))}
        </div>
        <div className={styles.fill} style={{ width: `${ratio * 100}%` }} />
        {defaultRatio != null ? (
          <div
            className={styles.defaultMark}
            style={{ left: `${defaultRatio * 100}%` }}
            aria-hidden
          />
        ) : null}
        <div className={styles.handle} style={{ left: `${ratio * 100}%` }} />
      </div>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => stepBy(1)}
        disabled={disabled || value >= max}
        aria-label={`${ariaLabel} up`}
      >
        +
      </button>
    </div>
  )
}

export const NotchedSlider = memo(NotchedSliderImpl)
