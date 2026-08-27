import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ListFocusContext } from '@/navigation/listFocusContext'

// bug31: registers a list focus entry on the stack for a modal overlay so the
// hardware dial (wheel/Enter/Escape) is routed to the popup while it is open.
// The entry is pushed on mount and popped on unmount, at which point the
// parent's entry (e.g. the settings list) regains the hardware buttons; the
// parent's focus state is untouched, so its focused row is where the user left
// it.

export interface UseOverlayListFocusOptions {
  itemCount: number
  // called with the focused index on dial press (Enter)
  onConfirm: (index: number) => void
  // called for the hardware Back button; the press is consumed (returned true)
  onBack: () => void
  // row index focused when the overlay opens (default 0)
  initialIndex?: number
  // bug46: optional custom wheel handling for the currently focused item
  // (the HA light modal adjusts the slider value instead of moving the
  // focus). dir is the focus direction (1 = down, -1 = up, same convention
  // as the default movement). Returning true consumes the tick; returning
  // false falls back to the default focus movement.
  onWheel?: (dir: 1 | -1, focusedIndex: number) => boolean
}

export interface UseOverlayListFocusResult {
  focusedIndex: number
  // focus a row from a touch tap (the row's own click handler does the action)
  tapItem: (index: number) => void
  // ref for the currently focused row element, scrolled into view
  setFocusRef: (el: HTMLElement | null) => void
}

export function useOverlayListFocus({
  itemCount,
  onConfirm,
  onBack,
  initialIndex = 0,
  onWheel,
}: UseOverlayListFocusOptions): UseOverlayListFocusResult {
  const [focusedIndex, setFocusedIndexState] = useState(() =>
    Math.max(0, Math.min(itemCount - 1, initialIndex)),
  )
  const focusedIndexRef = useRef(focusedIndex)
  const focusedElRef = useRef<HTMLElement | null>(null)

  // keep the latest callbacks and count without re-registering the context
  // entry on every render (same pattern as useMainMenuFocus)
  const onConfirmRef = useRef(onConfirm)
  const onBackRef = useRef(onBack)
  const onWheelRef = useRef(onWheel)
  const itemCountRef = useRef(itemCount)
  useLayoutEffect(() => {
    onConfirmRef.current = onConfirm
    onBackRef.current = onBack
    onWheelRef.current = onWheel
    itemCountRef.current = itemCount
  })

  const moveFocus = useCallback((dir: 1 | -1) => {
    const count = itemCountRef.current
    if (count === 0) return
    const next = Math.max(0, Math.min(count - 1, focusedIndexRef.current + dir))
    if (next === focusedIndexRef.current) return
    focusedIndexRef.current = next
    setFocusedIndexState(next)
  }, [])

  const tapItem = useCallback((index: number) => {
    const next = Math.max(0, Math.min(itemCountRef.current - 1, index))
    focusedIndexRef.current = next
    setFocusedIndexState(next)
  }, [])

  const confirm = useCallback(() => {
    if (itemCountRef.current === 0) return
    onConfirmRef.current(focusedIndexRef.current)
  }, [])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.deltaX === 0) return
      e.preventDefault()
      // hardware: clockwise turn = negative deltaX, focus moves down (same
      // convention as useListFocus / useMainMenuFocus)
      const dir: 1 | -1 = e.deltaX > 0 ? -1 : 1
      // bug46: the custom handler may consume the tick (e.g. slider adjust);
      // otherwise the focus moves on
      if (onWheelRef.current && onWheelRef.current(dir, focusedIndexRef.current)) return
      moveFocus(dir)
    },
    [moveFocus],
  )

  // keep focus in range when the list shrinks (e.g. a BT device is forgotten
  // while focused)
  useEffect(() => {
    if (itemCount === 0) return
    if (focusedIndexRef.current >= itemCount) {
      const next = itemCount - 1
      focusedIndexRef.current = next
      setFocusedIndexState(next)
    }
  }, [itemCount])

  // scroll the focused row into view (the modal cards have their own scroll area)
  useEffect(() => {
    const el = focusedElRef.current
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedIndex])

  useEffect(() => {
    const pop = ListFocusContext.pushEntry({
      onWheel: handleWheel,
      onConfirm: confirm,
      onBack: () => {
        onBackRef.current()
        return true
      },
      active: true,
    })
    return pop
  }, [handleWheel, confirm])

  const setFocusRef = useCallback((el: HTMLElement | null) => {
    focusedElRef.current = el
  }, [])

  return { focusedIndex, tapItem, setFocusRef }
}
