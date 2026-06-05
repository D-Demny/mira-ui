import { createContext, useContext } from 'react'

export type DevForcedScreen =
  | null
  | 'connection-chooser'
  | 'pc-connect'
  | 'needs-network'
  | 'starting'
  | 'boot-splash'
  | 'auth'
  | 'idle'
  | 'playing-lyrics'
  | 'playing-no-lyrics'
  | 'pairing'
  | 'menu'
  | 'power-menu'
  | 'daemon-error'

export interface DevScreenCtx {
  forced: DevForcedScreen
  setForced: (s: DevForcedScreen) => void
}

export const DevScreenContext = createContext<DevScreenCtx>({
  forced: null,
  setForced: () => {},
})

export function useDevScreen(): DevScreenCtx {
  return useContext(DevScreenContext)
}
