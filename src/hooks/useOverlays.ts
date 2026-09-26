import { useCallback, useMemo, useState } from 'react'

export type OverlayId =
  | 'screensaver'
  | 'report'
  | 'debug'
  | 'deviceMenu'
  | 'btMenu'
  | 'settings'
  | 'powerMenu'
  | 'menu'

/**
 * Back closes the first of these that is open. A fixed order rather than a
 * stack of open order: these open each other (menu opens settings, settings
 * opens debug), and this is the order a user can actually unwind them in.
 */
const BACK_ORDER: readonly OverlayId[] = [
  'screensaver',
  'report',
  'debug',
  'deviceMenu',
  'btMenu',
  'settings',
  'powerMenu',
  'menu',
]

export type ScreensaverBy = 'manual' | 'auto'

export interface UseOverlaysParams {
  /**
   * Dev screens force an overlay open without touching its state. Treated as
   * open everywhere here, so `busy` and back behave as they would for real.
   */
  forcedOpen?: Partial<Record<OverlayId, boolean>>
  /** fires after any close, for the dev screen to drop its own override */
  onClosed?: (id: OverlayId) => void
}

export interface Overlays {
  isOpen: (id: OverlayId) => boolean
  open: (id: OverlayId) => void
  close: (id: OverlayId) => void
  /** flips the real state, ignoring any dev override on top of it */
  toggle: (id: OverlayId) => void
  /** an overlay owns the screen: idle timers and one-shot cards stand down */
  busy: boolean
  /** closes the topmost overlay; false when there was nothing to close */
  goBack: () => boolean

  /** the support report dialog carries the id it is showing */
  reportId: string | null
  openReport: (id: string) => void

  /** an auto-opened screensaver yields to playback; a manual one stays */
  screensaverBy: ScreensaverBy
  openScreensaver: (by: ScreensaverBy) => void
}

const NONE: Record<OverlayId, boolean> = {
  screensaver: false,
  report: false,
  debug: false,
  deviceMenu: false,
  btMenu: false,
  settings: false,
  powerMenu: false,
  menu: false,
}

/**
 * Every menu, sheet, dialog, and card that can cover the screen, plus the
 * order the back button unwinds them in. Owns opening, closing, and what a
 * close has to remember; deciding *when* to open one is the caller's job.
 */
export function useOverlays({ forcedOpen, onClosed }: UseOverlaysParams = {}): Overlays {
  const [flags, setFlags] = useState(NONE)
  const [reportId, setReportId] = useState<string | null>(null)
  const [screensaverBy, setScreensaverBy] = useState<ScreensaverBy>('manual')

  const isOpen = useCallback(
    (id: OverlayId) => forcedOpen?.[id] ?? (id === 'report' ? reportId !== null : flags[id]),
    [forcedOpen, flags, reportId],
  )

  const open = useCallback((id: OverlayId) => {
    setFlags((f) => ({ ...f, [id]: true }))
  }, [])

  const close = useCallback(
    (id: OverlayId) => {
      if (id === 'report') setReportId(null)
      setFlags((f) => ({ ...f, [id]: false }))
      onClosed?.(id)
    },
    [onClosed],
  )

  const toggle = useCallback((id: OverlayId) => {
    setFlags((f) => ({ ...f, [id]: !f[id] }))
  }, [])

  const openReport = useCallback((id: string) => setReportId(id), [])

  const openScreensaver = useCallback((by: ScreensaverBy) => {
    setScreensaverBy(by)
    setFlags((f) => ({ ...f, screensaver: true }))
  }, [])

  const goBack = useCallback(() => {
    for (const id of BACK_ORDER) {
      if (!isOpen(id)) continue
      close(id)
      return true
    }
    return false
  }, [isOpen, close])

  const busy = BACK_ORDER.some((id) => isOpen(id))

  return useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      busy,
      goBack,
      reportId,
      openReport,
      screensaverBy,
      openScreensaver,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      busy,
      goBack,
      reportId,
      openReport,
      screensaverBy,
      openScreensaver,
    ],
  )
}
