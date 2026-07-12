import { memo, type ReactNode } from 'react'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  updateSettings,
  useSettings,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
} from '@/settings'
import { NotchedSlider } from './NotchedSlider'
import styles from './SettingsSheet.module.scss'

interface Props {
  open: boolean
  onClose: () => void
  // active device is a phone
  phoneVolume?: boolean
}

const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

function SettingsSheetImpl({ open, onClose, phoneVolume = false }: Props) {
  const { lyricOffsetMs, volumeStepPct, autoBrightness, brightness } = useSettings()

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
        <div className={styles.title}>Settings</div>

        <SettingRow icon={<LyricsIcon />} label="Lyric sync" value={fmtOffset(lyricOffsetMs)}>
          <NotchedSlider
            ariaLabel="Lyric sync offset"
            value={lyricOffsetMs}
            min={OFFSET_MIN}
            max={OFFSET_MAX}
            step={OFFSET_STEP}
            onChange={(v) => updateSettings({ lyricOffsetMs: v })}
            format={fmtOffset}
            defaultValue={0}
          />
        </SettingRow>

        <SettingRow
          icon={<SpeakerIcon />}
          label="Volume per turn"
          value={phoneVolume ? 'Set by phone' : `${volumeStepPct}%`}
        >
          <NotchedSlider
            ariaLabel="Volume per turn"
            value={volumeStepPct}
            min={VOLUME_STEP_MIN}
            max={VOLUME_STEP_MAX}
            step={1}
            onChange={(v) => updateSettings({ volumeStepPct: v })}
            format={(v) => `${v}%`}
            disabled={phoneVolume}
            defaultValue={2}
          />
        </SettingRow>

        <div className={styles.row}>
          <button
            type="button"
            role="switch"
            aria-checked={autoBrightness}
            aria-label="Auto brightness"
            className={`${styles.chip} ${styles.chipBtn} ${autoBrightness ? styles.chipOn : ''}`}
            onClick={() => updateSettings({ autoBrightness: !autoBrightness })}
          >
            <SunIcon />
          </button>
          <div className={styles.rowMain}>
            <div className={styles.rowHead}>
              <span className={styles.label}>Brightness</span>
              <span className={styles.value}>
                {autoBrightness ? 'Auto' : `${brightness * 10}%`}
              </span>
            </div>
            <NotchedSlider
              ariaLabel="Brightness"
              value={brightness}
              min={BRIGHTNESS_MIN}
              max={BRIGHTNESS_MAX}
              step={1}
              onChange={(v) => updateSettings({ brightness: v })}
              format={(v) => `${v * 10}%`}
              disabled={autoBrightness}
              defaultValue={5}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  icon: ReactNode
  label: string
  value: string
  children: ReactNode
}

function SettingRow({ icon, label, value, children }: RowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.chip} aria-hidden>
        {icon}
      </span>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{value}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function LyricsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18V6l10-2v10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
      <circle cx="16.5" cy="16" r="2.5" fill="currentColor" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5h3.2L12 18.7V5.3L7.2 9.5H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
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

export const SettingsSheet = memo(SettingsSheetImpl)
