import { memo, useState, type ReactNode } from 'react'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  updateSettings,
  useSettings,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
} from '@/settings'
import { NotchedSlider } from './NotchedSlider'
import type { ConnectDevice } from '@/api/types'
import styles from './SettingsSheet.module.scss'

interface Props {
  open: boolean
  onClose: () => void
  // active device is a phone
  phoneVolume?: boolean
  // available connect devices for default device selection
  devices?: ConnectDevice[]
  // open default device modal
  onOpenDefaultDevice?: () => void
}

const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

function SettingsSheetImpl({
  open,
  onClose,
  phoneVolume = false,
  devices = [],
  onOpenDefaultDevice,
}: Props) {
  const { lyricOffsetMs, volumeStepPct, autoBrightness, brightness, uiScalePct, defaultDeviceId } =
    useSettings()

  // applying the scale mid-drag moves this very panel under the finger, which has no
  // fixed point near a notch boundary and makes the whole ui flicker between two sizes.
  // so track the drag locally and only commit on release
  const [scalePreview, setScalePreview] = useState<number | null>(null)
  // drop an uncommitted drag if the sheet is dismissed mid-gesture
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (scalePreview !== null) setScalePreview(null)
  }
  const shownScale = scalePreview ?? uiScalePct

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

        <div
          className={styles.row}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDefaultDevice?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenDefaultDevice?.()
            }
          }}
        >
          <span className={styles.chip} aria-hidden>
            <SpeakerIcon />
          </span>
          <div className={styles.rowMain}>
            <div className={styles.rowHead}>
              <span className={styles.label}>Default Device</span>
              <span className={styles.value}>
                {defaultDeviceId
                  ? devices.find((d) => d.id === defaultDeviceId)?.name ?? 'Unknown'
                  : 'None'}
              </span>
            </div>
          </div>
        </div>

        {/* first on purpose: at the largest display size the panel scrolls, and this is
            the one control that has to stay reachable to get back down */}
        <SettingRow icon={<DisplaySizeIcon />} label="Display size" value={`${shownScale}%`}>
          <NotchedSlider
            ariaLabel="Display size"
            value={shownScale}
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            onChange={setScalePreview}
            onCommit={(v) => {
              setScalePreview(null)
              // the sheet was dismissed mid-gesture, so drop the drag instead of
              // resizing the whole ui after it's gone
              if (!open) return
              updateSettings({ uiScalePct: v })
            }}
            onCancel={() => setScalePreview(null)}
            format={(v) => `${v}%`}
            defaultValue={UI_SCALE_DEFAULT}
          />
        </SettingRow>

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

function DisplaySizeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8.5 15V9.8m0 0H6.9m1.6 0h1.6M15.5 15V8.2m0 0h-2.1m2.1 0h2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const SettingsSheet = memo(SettingsSheetImpl)
