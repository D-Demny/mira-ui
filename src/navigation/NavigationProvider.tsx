import { useCallback, useState } from 'react'
import { NavigationContext, type LibraryRoute, type NavigationState } from './context'

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
    // Read the current stack synchronously: the setState updater below runs
    // during the next render, so side effects inside it are not observable
    // from the return value.
    const stack = state.navigationStack
    const popped = stack.length > 0 ? stack[stack.length - 1] : null
    setState((prev) => {
      if (prev.navigationStack.length === 0) {
        return { ...prev, currentRoute: null }
      }
      const newStack = prev.navigationStack.slice(0, -1)
      return {
        ...prev,
        navigationStack: newStack,
        currentRoute: newStack.length > 0 ? newStack[newStack.length - 1] : 'library',
      }
    })
    return popped
  }, [state])

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
