import { createContext, useContext } from 'react'
import type { BannerVariant } from '@/components/TopBanner'

export interface NotifyOptions {
  variant?: BannerVariant
  durationMs?: number
}

export type NotifyFn = (message: string, opts?: NotifyOptions) => void

export const NotifyContext = createContext<NotifyFn>(() => {})

// any component can use the banner
export function useNotify(): NotifyFn {
  return useContext(NotifyContext)
}
