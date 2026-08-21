import { useCallback, useEffect, useRef, useState } from 'react'
import { ListFocusContext } from '@/navigation/listFocusContext'

export type MainMenuPane = 'sidebar' | 'content'

export interface UseMainMenuFocusOptions {
  sidebarCount: number
  contentCount: number
  // index of the sidebar item that exits the menu immediately ('Läuft gerade')
  exitSidebarIndex: number
  // called when the menu should close (exit item confirmed / back on the sidebar)
  onExit: () => void
  // called when a carousel card is confirmed (dial press or tap)
  onConfirmContent: (index: number) => void
}

export interface UseMainMenuFocusResult {
  activePane: MainMenuPane
  sidebarIndex: number
  contentIndex: number
  // select a sidebar item: focus it and enter the content pane,
  // the exit item closes the menu instead
  selectSidebar: (index: number) => void
  // confirm the focused item of the active pane (dial press / Enter)
  confirm: () => void
  // tap a carousel card: focus it and confirm
  selectContent: (index: number) => void
  setActivePane: (pane: MainMenuPane) => void
}

// 2D focus state machine for the Nocturne main menu (ticket 8.4b).
// The refs are the source of truth; the state values only mirror them for
// rendering so wheel/confirm/back handlers never read stale closures.
export function useMainMenuFocus({
  sidebarCount,
  contentCount,
  exitSidebarIndex,
  onExit,
  onConfirmContent,
}: UseMainMenuFocusOptions): UseMainMenuFocusResult {
  const [activePane, setActivePaneState] = useState<MainMenuPane>('sidebar')
  const [sidebarIndex, setSidebarIndexState] = useState(0)
  const [contentIndex, setContentIndexState] = useState(0)

  const activePaneRef = useRef<MainMenuPane>('sidebar')
  const sidebarIndexRef = useRef(0)
  const contentIndexRef = useRef(0)

  // keep the latest callbacks/counts without re-registering the listeners
  const onExitRef = useRef(onExit)
  const onConfirmContentRef = useRef(onConfirmContent)
  const exitSidebarIndexRef = useRef(exitSidebarIndex)
  const countsRef = useRef({ sidebarCount, contentCount })
  useEffect(() => {
    onExitRef.current = onExit
    onConfirmContentRef.current = onConfirmContent
    exitSidebarIndexRef.current = exitSidebarIndex
    countsRef.current = { sidebarCount, contentCount }
  })

  const setActivePane = useCallback((pane: MainMenuPane) => {
    activePaneRef.current = pane
    setActivePaneState(pane)
  }, [])

  const moveSidebar = useCallback((dir: 1 | -1) => {
    const count = countsRef.current.sidebarCount
    if (count === 0) return
    const next = Math.max(0, Math.min(count - 1, sidebarIndexRef.current + dir))
    if (next === sidebarIndexRef.current) return
    sidebarIndexRef.current = next
    setSidebarIndexState(next)
  }, [])

  const moveContent = useCallback((dir: 1 | -1) => {
    const count = countsRef.current.contentCount
    if (count === 0) return
    const next = Math.max(0, Math.min(count - 1, contentIndexRef.current + dir))
    if (next === contentIndexRef.current) return
    contentIndexRef.current = next
    setContentIndexState(next)
  }, [])

  const selectSidebar = useCallback(
    (index: number) => {
      if (index === exitSidebarIndexRef.current) {
        // 'Läuft gerade' exits the menu immediately
        onExitRef.current()
        return
      }
      sidebarIndexRef.current = index
      setSidebarIndexState(index)
      // move focus to the first card of the carousel
      contentIndexRef.current = 0
      setContentIndexState(0)
      setActivePane('content')
    },
    [setActivePane],
  )

  const selectContent = useCallback((index: number) => {
    contentIndexRef.current = index
    setContentIndexState(index)
    onConfirmContentRef.current(index)
  }, [])

  const confirm = useCallback(() => {
    if (activePaneRef.current === 'sidebar') {
      selectSidebar(sidebarIndexRef.current)
    } else {
      onConfirmContentRef.current(contentIndexRef.current)
    }
  }, [selectSidebar])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.deltaX === 0) return
      e.preventDefault()
      // hardware: clockwise turn = negative deltaX
      const dir: 1 | -1 = e.deltaX > 0 ? -1 : 1
      if (activePaneRef.current === 'sidebar') {
        moveSidebar(dir)
      } else {
        moveContent(dir)
      }
    },
    [moveSidebar, moveContent],
  )

  // back: content mode returns to the sidebar, sidebar mode exits the menu
  const handleBack = useCallback((): boolean => {
    if (activePaneRef.current === 'content') {
      setActivePane('sidebar')
      return true
    }
    onExitRef.current()
    return true
  }, [setActivePane])

  // keep the content focus in range when the card list shrinks
  useEffect(() => {
    if (contentCount > 0 && contentIndexRef.current >= contentCount) {
      const next = Math.max(0, contentCount - 1)
      contentIndexRef.current = next
      setContentIndexState(next)
    }
  }, [contentCount])

  useEffect(() => {
    ListFocusContext.setActive({
      onWheel: handleWheel,
      onConfirm: confirm,
      onBack: handleBack,
      active: true,
    })
    return () => {
      ListFocusContext.setActive(null)
    }
  }, [handleWheel, confirm, handleBack])

  return {
    activePane,
    sidebarIndex,
    contentIndex,
    selectSidebar,
    selectContent,
    confirm,
    setActivePane,
  }
}
