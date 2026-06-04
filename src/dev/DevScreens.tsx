import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DevScreenContext, type DevForcedScreen, useDevScreen } from './devContext'
import styles from './DevScreens.module.scss'

const STORAGE_KEY = 'thing.dev.forcedScreen'

function readStored(): DevForcedScreen {
  if (!import.meta.env.DEV) return null
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (!v || v === 'null') return null
    return v as DevForcedScreen
  } catch {
    return null
  }
}

function writeStored(v: DevForcedScreen) {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, v)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function DevScreenProvider({ children }: { children: ReactNode }) {
  const [forced, setForcedRaw] = useState<DevForcedScreen>(() => readStored())

  // Persist across HMR
  const value = useMemo(
    () => ({
      forced,
      setForced: (s: DevForcedScreen) => {
        writeStored(s)
        setForcedRaw(s)
      },
    }),
    [forced],
  )

  if (!import.meta.env.DEV) return <>{children}</>

  return <DevScreenContext.Provider value={value}>{children}</DevScreenContext.Provider>
}

interface ScreenDef {
  id: Exclude<DevForcedScreen, null>
  label: string
  hint?: string
}

const SCREENS: ScreenDef[] = [
  { id: 'connection-chooser', label: 'Connection chooser', hint: 'PC/Bluetooth picker' },
  { id: 'pc-connect', label: 'PC connect', hint: 'USB tethering sub-screen' },
  { id: 'needs-network', label: 'Bluetooth connect', hint: 'BT pairing sub-screen' },
  { id: 'boot-splash', label: 'Boot splash', hint: 'Animated brand splash' },
  { id: 'starting', label: 'Starting up', hint: 'Boot splash w/ caption' },
  { id: 'auth', label: 'Auth (QR code)', hint: 'OAuth pairing screen' },
  { id: 'idle', label: 'Idle (no playback)' },
  { id: 'playing-lyrics', label: 'Playing: lyrics' },
  { id: 'playing-no-lyrics', label: 'Playing: no lyrics' },
  { id: 'pairing', label: 'Pairing dialog', hint: 'Over the player view' },
  { id: 'menu', label: 'Menu open', hint: 'Bottom-sheet over player' },
  { id: 'daemon-error', label: 'Daemon error', hint: 'Daemon-not-running popup' },
]

export function DevOverlay() {
  const { forced, setForced } = useDevScreen()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (inEditable) return

      if (e.key === '`' && !e.repeat) {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      if (open && e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!import.meta.env.DEV) return null

  const badge =
    !open && forced ? (
      <button
        type="button"
        className={styles.badge}
        onClick={() => setOpen(true)}
        title="Open dev screens (`)"
      >
        DEV - {forced}
      </button>
    ) : null

  if (!open) return badge

  return (
    <div className={styles.scrim} onClick={() => setOpen(false)} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Dev screens"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Dev screens</span>
          <span className={styles.kbd}>` to toggle</span>
        </div>

        <button
          type="button"
          className={`${styles.row} ${forced === null ? styles.rowActive : ''}`}
          onClick={() => {
            setForced(null)
            setOpen(false)
          }}
        >
          <span className={styles.rowMark}>{forced === null ? '->' : ''}</span>
          <span className={styles.rowLabel}>Reset (live state)</span>
          <span className={styles.rowHint}>Stop overriding</span>
        </button>

        <div className={styles.divider} aria-hidden />

        {SCREENS.map((s) => {
          const active = forced === s.id
          return (
            <button
              key={s.id}
              type="button"
              className={`${styles.row} ${active ? styles.rowActive : ''}`}
              onClick={() => {
                setForced(s.id)
                setOpen(false)
              }}
            >
              <span className={styles.rowMark}>{active ? '->' : ''}</span>
              <span className={styles.rowLabel}>{s.label}</span>
              <span className={styles.rowHint}>{s.hint ?? ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
