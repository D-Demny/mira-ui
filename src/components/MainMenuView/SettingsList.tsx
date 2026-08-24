import { memo, useEffect, useRef } from 'react'
import { NotchedSlider } from '@/components/SettingsSheet/NotchedSlider'
import styles from './SettingsList.module.scss'

// bug25: the 'Einstellungen' pane is a vertical list, not a card carousel.
// Row kinds: 'open-settings' descends into the sub-level, 'toggle' flips a
// boolean setting, 'open-link' opens an App-level panel, 'slider' rows show
// a NotchedSlider (drag for touch, dial wheel for the rotary).
export type SettingsRowKind = 'open-settings' | 'toggle' | 'open-link' | 'slider'

export interface SettingsSlider {
  ariaLabel: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  disabled?: boolean
  defaultValue?: number
}

export interface SettingsRow {
  id: string
  title: string
  // right-aligned value text (On/Off, %, offset, device name)
  value: string
  kind: SettingsRowKind
  slider?: SettingsSlider
  // brightness row: a switch chip + dial-confirm toggles auto brightness
  autoToggle?: boolean
  autoOn?: boolean
}

interface Props {
  rows: SettingsRow[]
  // index of the dial-focused row; undefined while the sidebar is focused
  // (the list then previews without interactive rows)
  focusedIndex?: number
  // the row whose slider is in dial adjust mode (bug25)
  adjustingRowId?: string | null
  onRowTap: (index: number) => void
  onSliderChange: (rowId: string, value: number) => void
  onToggleAuto: () => void
}

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SettingsListImpl({
  rows,
  focusedIndex,
  adjustingRowId,
  onRowTap,
  onSliderChange,
  onToggleAuto,
}: Props) {
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  // scroll only on an actual focus change, not on rows re-rendering with new
  // values (a settings update would otherwise re-center the list)
  const lastFocusedRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (focusedIndex == null || focusedIndex === lastFocusedRef.current) return
    lastFocusedRef.current = focusedIndex
    const id = rows[focusedIndex]?.id
    if (id) {
      rowRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [focusedIndex, rows])

  return (
    <div className={styles.list} aria-label="Einstellungen">
      {rows.map((row, index) => {
        const focused = focusedIndex === index
        return (
          <div
            key={row.id}
            ref={(el) => {
              if (el) rowRefs.current.set(row.id, el)
              else rowRefs.current.delete(row.id)
            }}
            role={focused ? 'button' : undefined}
            tabIndex={focused ? 0 : undefined}
            aria-label={row.title}
            className={`${styles.row} ${focused ? styles.rowFocused : ''} ${
              adjustingRowId === row.id ? styles.rowAdjusting : ''
            }`}
            onClick={focused ? () => onRowTap(index) : undefined}
            onKeyDown={
              focused
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowTap(index)
                    }
                  }
                : undefined
            }
          >
            {row.autoToggle ? (
              <button
                type="button"
                role="switch"
                aria-checked={row.autoOn ?? false}
                aria-label="Auto brightness"
                className={`${styles.autoChip} ${row.autoOn ? styles.autoChipOn : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleAuto()
                }}
              >
                <SunIcon />
              </button>
            ) : (
              <span className={styles.chevron} aria-hidden>
                {row.kind === 'open-settings' || row.kind === 'open-link' ? '›' : ''}
              </span>
            )}
            <div className={styles.rowMain}>
              <div className={styles.rowHead}>
                <span className={styles.title}>{row.title}</span>
                <span className={styles.value}>{row.value}</span>
              </div>
              {row.slider ? (
                // bug35: slider interactions (drag / step buttons) must not
                // bubble to the row tap — on the brightness row the row tap
                // toggles auto brightness, which a touch-release click would
                // flip right after a manual drag
                <div onClick={(e) => e.stopPropagation()}>
                  <NotchedSlider
                    ariaLabel={row.slider.ariaLabel}
                    value={row.slider.value}
                    min={row.slider.min}
                    max={row.slider.max}
                    step={row.slider.step}
                    format={row.slider.format}
                    disabled={row.slider.disabled}
                    defaultValue={row.slider.defaultValue}
                    onChange={(v) => onSliderChange(row.id, v)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const SettingsList = memo(SettingsListImpl)
