import { createContext, useCallback, useContext, useState } from 'react'

export type LibraryRoute = 'library' | 'playlists'

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

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NavigationState>({
    navigationStack: [],
    currentRoute: null,
    lastBrowseRoute: null,
  })

  const pushRoute = useCallback((route: LibraryRoute) => {
    setState((prev) => ({
      ...prev,
      navigationStack: [...prev.navigationStack, route],
      currentRoute: route,
    }))
  }, [])

  const popRoute = useCallback((): LibraryRoute | null => {
    let popped: LibraryRoute | null = null
    setState((prev) => {
      if (prev.navigationStack.length === 0) {
        return { ...prev, currentRoute: null }
      }
      popped = prev.navigationStack[prev.navigationStack.length - 1]
      const newStack = prev.navigationStack.slice(0, -1)
      return {
        ...prev,
        navigationStack: newStack,
        currentRoute: newStack.length > 0 ? newStack[newStack.length - 1] : 'library',
      }
    })
    return popped
  }, [])

  const setCurrentRoute = useCallback((route: LibraryRoute | null) => {
    setState((prev) => ({ ...prev, currentRoute: route }))
  }, [])

  const setLastBrowseRoute = useCallback((route: LibraryRoute | null) => {
    setState((prev) => ({ ...prev, lastBrowseRoute: route }))
  }, [])

  const clearLastBrowseRoute = useCallback(() => {
    setState((prev) => ({ ...prev, lastBrowseRoute: null }))
  }, [])

  const goBackFromPlaying = useCallback((): LibraryRoute | null => {
    return state.lastBrowseRoute
  }, [state.lastBrowseRoute])

  const resetStack = useCallback(() => {
    setState((prev) => ({
      ...prev,
      navigationStack: [],
      currentRoute: null,
    }))
  }, [])

  return (
    <NavigationContext.Provider
      value={{
        state,
        pushRoute,
        popRoute,
        setCurrentRoute,
        setLastBrowseRoute,
        clearLastBrowseRoute,
        resetStack,
        goBackFromPlaying,
      }}
    >
      {children}
    </NavigationContext.Provider>
  )
}
