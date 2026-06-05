import { useCallback, useRef, useState, type ReactNode } from 'react'
import { TopBanner, type BannerVariant } from '@/components/TopBanner'
import { NotifyContext, type NotifyFn } from './notifyContext'

const DEFAULT_DURATION_MS = 2600

interface BannerState {
  message: string
  variant: BannerVariant
  visible: boolean
}

// owns the top-banner state and exposes notify() to the whole app thru context
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BannerState>({ message: '', variant: 'info', visible: false })
  const timerRef = useRef<number | undefined>(undefined)

  const notify = useCallback<NotifyFn>((message, opts) => {
    setState({ message, variant: opts?.variant ?? 'info', visible: true })
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setState((s) => ({ ...s, visible: false }))
    }, opts?.durationMs ?? DEFAULT_DURATION_MS)
  }, [])

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <TopBanner visible={state.visible} message={state.message} variant={state.variant} />
    </NotifyContext.Provider>
  )
}
