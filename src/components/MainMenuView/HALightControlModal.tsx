import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { setHaLightBrightness, setHaLightColorTemp } from '@/api/homeassistant'
import { useHomeLight } from '@/hooks/useHomeLight'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { getUiScaleFor } from '@/uiScale'
import styles from './HALightControlModal.module.scss'

// bug46: dial focus model — item 0 is the brightness slider row, items 1–4
// are the color temperature preset circles in cool → warmest order.
//
// Interaction (documented decision):
// - Dial rotation on the slider row adjusts brightness by ±5 % (clamped
//   0–100, the tick is consumed). At the boundary the tick falls through to
//   the default focus movement (bug25/35 boundary convention): turning past
//   100 % lands on the first preset, turning back from a preset returns to
//   the slider row.
// - Dial rotation on a preset moves between the four circles (clamped).
// - Dial press on a preset confirms it (sends color_temp_kelvin).
// - Dial press on the slider row commits the current value to HA (sends
//   brightness_pct). The ticket's "toggles row focus" is implemented as
//   "commits the focused slider row's value": rotation already continuously
//   adjusts the row (ticket text), so there is no adjust mode to toggle —
//   the bug25-style adjust mode was deliberately NOT used (stateless stays
//   closer to the ticket than an extra mode switch).
// - Back/Esc: flushes a pending brightness write, closes, and the parent
//   (main menu) focus entry is restored by the hook's cleanup — the menu's
//   carousel focus stays on the tapped light card.
//
// Optimistic UI: slider/preset changes update the local display immediately;
// HA writes are throttled to ≥250 ms apart with a final write when the focus
// leaves the slider row or the modal closes. A failed write reverts the
// display to the last value HA accepted and shows the error. The useHomeLight
// 5 s poll re-syncs the underlying store regardless.
const BRIGHTNESS_STEP = 5
const COLOR_TEMP_PRESETS = [5600, 4500, 3500, 2200]
const WRITE_THROTTLE_MS = 250
const PRESET_COLORS: Record<number, string> = {
  5600: '#dfe9ff',
  4500: '#fdf3e0',
  3500: '#ffd9a0',
  2200: '#ffab66',
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export interface HALightControlModalProps {
  entityId: string
  label: string
  onClose: () => void
}

// thick rounded brightness bar (0–100 %) with pointer drag, the same gesture
// contract as NotchedSlider (onChange while dragging, onCommit on release)
function BrightnessSlider({
  value,
  onChange,
  onCommit,
}: {
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)
  const latest = useRef(value)

  const ratio = clamp(value / 100, 0, 1)

  const setFromX = (clientX: number) => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // the modal lives in the fixed-100% overlay layer (bug38), but resolve
    // the scale against the bar itself, same as NotchedSlider
    const r = clamp((clientX / getUiScaleFor(el) - rect.left) / rect.width, 0, 1)
    const snapped = clamp(Math.round((r * 100) / BRIGHTNESS_STEP) * BRIGHTNESS_STEP, 0, 100)
    latest.current = snapped
    if (snapped !== value) onChange(snapped)
  }

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    dragging.current = true
    latest.current = value
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromX(e.clientX)
  }
  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (dragging.current) setFromX(e.clientX)
  }
  const releaseCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  // an aborted drag settles on the last position (no separate preview state
  // to discard — the display IS the optimistic state)
  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasDragging = dragging.current
    dragging.current = false
    releaseCapture(e)
    if (wasDragging) onCommit(latest.current)
  }

  return (
    <div
      className={styles.bar}
      ref={barRef}
      role="slider"
      aria-label="Brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value}%`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => {
        dragging.current = false
      }}
    >
      <div className={styles.fill} style={{ width: `${ratio * 100}%` }} />
      <div className={styles.handle} style={{ left: `${ratio * 100}%` }} />
    </div>
  )
}

export function HALightControlModal({ entityId, label, onClose }: HALightControlModalProps) {
  // the shared per-entity store (the main menu's useHomeLights keeps it
  // fresh with its 5 s poll) seeds the header + slider and mirrors the
  // light's real state until the user touches the controls
  const store = useHomeLight(entityId)

  const [brightness, setBrightnessState] = useState(() => store.brightnessPct ?? 0)
  const [selectedKelvin, setSelectedKelvin] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const brightnessRef = useRef(brightness)
  const touchedRef = useRef(false)
  // the last values HA actually accepted — the revert targets
  const confirmedBrightnessRef = useRef(store.brightnessPct ?? 0)
  const confirmedKelvinRef = useRef<number | null>(null)
  // write throttle (see the interaction notes above)
  const lastWriteAtRef = useRef(0)
  const pendingBrightnessRef = useRef<number | null>(null)
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWrittenRef = useRef<number | null>(null)

  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // while the user has not touched the slider, mirror store updates (the 5 s
  // poll re-syncing external changes) into the display
  useEffect(() => {
    if (touchedRef.current) return
    const pct = store.brightnessPct
    if (pct != null && pct !== brightnessRef.current) {
      brightnessRef.current = pct
      confirmedBrightnessRef.current = pct
      setBrightnessState(pct)
    }
  }, [store.brightnessPct])

  const doWrite = useCallback(
    (value: number) => {
      pendingBrightnessRef.current = null
      lastWriteAtRef.current = Date.now()
      lastWrittenRef.current = value
      void setHaLightBrightness(entityId, value)
        .then(() => {
          confirmedBrightnessRef.current = value
          setError(null)
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Home Assistant nicht erreichbar'
          console.warn('HALightControlModal: brightness write failed:', message)
          setError(message)
          // optimistic revert — back to the last value HA accepted
          brightnessRef.current = confirmedBrightnessRef.current
          setBrightnessState(confirmedBrightnessRef.current)
        })
    },
    [entityId],
  )

  const scheduleWrite = useCallback(
    (value: number) => {
      pendingBrightnessRef.current = value
      const wait = WRITE_THROTTLE_MS - (Date.now() - lastWriteAtRef.current)
      if (wait <= 0) {
        if (writeTimerRef.current !== null) {
          clearTimeout(writeTimerRef.current)
          writeTimerRef.current = null
        }
        doWrite(value)
      } else {
        if (writeTimerRef.current !== null) clearTimeout(writeTimerRef.current)
        writeTimerRef.current = setTimeout(() => {
          writeTimerRef.current = null
          if (pendingBrightnessRef.current !== null) doWrite(pendingBrightnessRef.current)
        }, wait)
      }
    },
    [doWrite],
  )

  const flushWrite = useCallback(() => {
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
    }
    if (pendingBrightnessRef.current !== null) {
      doWrite(pendingBrightnessRef.current)
    }
  }, [doWrite])

  // dial press / touch on the slider row: commit the current value
  const commitBrightness = useCallback(
    (value?: number) => {
      const target = value ?? brightnessRef.current
      if (target === lastWrittenRef.current) return // identical write in flight
      flushWrite()
      doWrite(target)
    },
    [doWrite, flushWrite],
  )

  const selectPreset = useCallback(
    (kelvin: number) => {
      setSelectedKelvin(kelvin)
      void setHaLightColorTemp(entityId, kelvin)
        .then(() => {
          confirmedKelvinRef.current = kelvin
          setError(null)
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Home Assistant nicht erreichbar'
          console.warn('HALightControlModal: color-temp write failed:', message)
          setError(message)
          // optimistic revert of the selection highlight
          setSelectedKelvin(confirmedKelvinRef.current)
        })
    },
    [entityId],
  )

  const handleClose = useCallback(() => {
    flushWrite() // final brightness write on close
    onCloseRef.current()
  }, [flushWrite])

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: 1 + COLOR_TEMP_PRESETS.length,
    initialIndex: 0,
    onConfirm: (index) => {
      if (index === 0) commitBrightness()
      else selectPreset(COLOR_TEMP_PRESETS[index - 1])
    },
    onBack: handleClose,
    onWheel: (dir, index) => {
      // item 0: adjust the slider value; at the boundary fall through to the
      // default focus movement (bug25/35 convention)
      if (index !== 0) return false
      const next = clamp(brightnessRef.current + dir * BRIGHTNESS_STEP, 0, 100)
      if (next === brightnessRef.current) return false
      touchedRef.current = true
      brightnessRef.current = next
      setBrightnessState(next)
      scheduleWrite(next)
      return true
    },
  })

  // final brightness write when the dial focus leaves the slider row
  const prevFocusRef = useRef(focusedIndex)
  useEffect(() => {
    if (prevFocusRef.current === 0 && focusedIndex !== 0) {
      flushWrite()
    }
    prevFocusRef.current = focusedIndex
  }, [focusedIndex, flushWrite])

  // a pending timer must never fire after the modal is gone (all close paths
  // flush through handleClose first; this is the safety net)
  useEffect(() => {
    return () => {
      if (writeTimerRef.current !== null) clearTimeout(writeTimerRef.current)
    }
  }, [])

  const brightnessText = brightness > 0 || store.state === 'on' ? `${brightness}%` : '—'

  return (
    <div className={styles.backdrop} onClick={handleClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{label}</span>
            <span className={styles.brightnessValue}>{brightnessText}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleClose}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div
          className={`${styles.sliderRow} ${focusedIndex === 0 ? styles.focused : ''}`}
          ref={focusedIndex === 0 ? setFocusRef : undefined}
          role="button"
          tabIndex={0}
          aria-label="Brightness"
          onClick={() => {
            tapItem(0)
            commitBrightness()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              tapItem(0)
              commitBrightness()
            }
          }}
        >
          <BrightnessSlider
            value={brightness}
            onChange={(v) => {
              touchedRef.current = true
              brightnessRef.current = v
              setBrightnessState(v)
              scheduleWrite(v)
            }}
            onCommit={(v) => {
              touchedRef.current = true
              commitBrightness(v)
            }}
          />
        </div>

        <div className={styles.presets} role="group" aria-label="Color temperature">
          {COLOR_TEMP_PRESETS.map((kelvin, i) => {
            const index = i + 1
            const focused = focusedIndex === index
            return (
              <button
                key={kelvin}
                type="button"
                className={`${styles.preset} ${
                  selectedKelvin === kelvin ? styles.presetSelected : ''
                } ${focused ? styles.focused : ''}`}
                ref={focused ? setFocusRef : undefined}
                tabIndex={focused ? 0 : -1}
                aria-pressed={selectedKelvin === kelvin}
                onClick={() => {
                  tapItem(index)
                  selectPreset(kelvin)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    tapItem(index)
                    selectPreset(kelvin)
                  }
                }}
              >
                <span
                  className={styles.presetDot}
                  style={{ background: PRESET_COLORS[kelvin] }}
                  aria-hidden
                />
                <span className={styles.presetLabel}>{kelvin} K</span>
              </button>
            )
          })}
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
