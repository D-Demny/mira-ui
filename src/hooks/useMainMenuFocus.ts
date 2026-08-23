import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ListFocusContext } from '@/navigation/listFocusContext'

export type MainMenuPane = 'sidebar' | 'content'

export interface UseMainMenuFocusOptions {
  sidebarCount: number
  contentCount: number
  // called when the menu should close (back on the sidebar)
  onExit: () => void
  // called when a sidebar item is selected (dial press or tap)
  onSelectSidebar?: (index: number) => void
  // called when a carousel card is confirmed (dial press or tap)
  onConfirmContent: (index: number) => void
  // called on back while focus is in the content pane, before returning to
  // the sidebar; returning true consumes the back press (e.g. closes a
  // playlist track sub-menu)
  onContentBack?: () => boolean
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
  // move the content focus without confirming (sub-menu open/close)
  focusContent: (index: number) => void
  setActivePane: (pane: MainMenuPane) => void
}

// 2D focus state machine for the Nocturne main menu (ticket 8.4b).
// The refs are the source of truth; the state values only mirror them for
// rendering so wheel/confirm/back handlers never read stale closures.
export function useMainMenuFocus({
  sidebarCount,
  contentCount,
  onExit,
  onSelectSidebar,
  onConfirmContent,
  onContentBack,
}: UseMainMenuFocusOptions): UseMainMenuFocusResult {
  const [activePane, setActivePaneState] = useState<MainMenuPane>('sidebar')
  const [sidebarIndex, setSidebarIndexState] = useState(0)
  const [contentIndex, setContentIndexState] = useState(0)

  const activePaneRef = useRef<MainMenuPane>('sidebar')
  const sidebarIndexRef = useRef(0)
  const contentIndexRef = useRef(0)

  // keep the latest callbacks/counts without re-registering the listeners;
  // useLayoutEffect (not the passive useEffect) so a dial event that lands
  // right after a render commit — e.g. a test firing wheel/confirm in the
  // next task — never reads a stale closure
  const onExitRef = useRef(onExit)
  const onSelectSidebarRef = useRef(onSelectSidebar)
  const onConfirmContentRef = useRef(onConfirmContent)
  const onContentBackRef = useRef(onContentBack)
  const countsRef = useRef({ sidebarCount, contentCount })
  useLayoutEffect(() => {
    onExitRef.current = onExit
    onSelectSidebarRef.current = onSelectSidebar
    onConfirmContentRef.current = onConfirmContent
    onContentBackRef.current = onContentBack
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
    // the newly previewed category starts at its first card (bug1)
    if (contentIndexRef.current !== 0) {
      contentIndexRef.current = 0
      setContentIndexState(0)
    }
  }, [])

  const moveContent = useCallback((dir: 1 | -1) => {
    const count = countsRef.current.contentCount
    if (count === 0) return
    const next = Math.max(0, Math.min(count - 1, contentIndexRef.current + dir))
    if (next === contentIndexRef.current) return
    contentIndexRef.current = next
    setContentIndexState(next)
  }, [])

  // bug20: every sidebar item (including 'Läuft gerade') transfers focus to
  // the content pane — there is no sidebar item that exits the menu any more;
  // the full-screen player is reached only from card 0 of the now-playing
  // carousel (handled by the view's card action)
  const selectSidebar = useCallback(
    (index: number) => {
      sidebarIndexRef.current = index
      setSidebarIndexState(index)
      // move focus to the first card of the carousel
      contentIndexRef.current = 0
      setContentIndexState(0)
      setActivePane('content')
      onSelectSidebarRef.current?.(index)
    },
    [setActivePane],
  )

  const selectContent = useCallback((index: number) => {
    contentIndexRef.current = index
    setContentIndexState(index)
    onConfirmContentRef.current(index)
  }, [])

  const focusContent = useCallback((index: number) => {
    const count = countsRef.current.contentCount
    contentIndexRef.current = Math.max(0, Math.min(count - 1, index))
    setContentIndexState(contentIndexRef.current)
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

  // back: a content sub-level (e.g. playlist track list) may consume the
  // press first, then content mode returns to the sidebar, sidebar mode exits
  const handleBack = useCallback((): boolean => {
    if (activePaneRef.current === 'content') {
      if (onContentBackRef.current?.()) return true
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
    focusContent,
    confirm,
    setActivePane,
  }
}
