import { createContext, useContext } from 'react'

export type LibraryRoute = 'library' | 'playlists' | 'home'

export interface NavigationState {
  navigationStack: LibraryRoute[]
  currentRoute: LibraryRoute | null
  lastBrowseRoute: LibraryRoute | null
}

export interface NavigationCtx {
  state: NavigationState
  pushRoute: (route: LibraryRoute) => void
  popRoute: () => LibraryRoute | null
  setCurrentRoute: (route: LibraryRoute | null) => void
  setLastBrowseRoute: (route: LibraryRoute | null) => void
  clearLastBrowseRoute: () => void
  resetStack: () => void
  goBackFromPlaying: () => LibraryRoute | null
}

export const NavigationContext = createContext<NavigationCtx>({
  state: { navigationStack: [], currentRoute: null, lastBrowseRoute: null },
  pushRoute: () => {},
  popRoute: () => null,
  setCurrentRoute: () => {},
  setLastBrowseRoute: () => {},
  clearLastBrowseRoute: () => {},
  resetStack: () => {},
  goBackFromPlaying: () => null,
})

export function useNavigation(): NavigationCtx {
  return useContext(NavigationContext)
}
