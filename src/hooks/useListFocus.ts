import { useCallback, useEffect, useRef, useState } from 'react'
import { ListFocusContext } from '@/navigation/listFocusContext'

export interface UseListFocusOptions {
  itemCount: number
  onSelect: (index: number) => void
  allowTapSelect?: boolean
}

export function useListFocus({ itemCount, onSelect, allowTapSelect = true }: UseListFocusOptions) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const focusedIndexRef = useRef(0)

  const scrollRef = useRef<HTMLLIElement | null>(null)

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.deltaX === 0) return
    e.preventDefault()
    const dir = e.deltaX > 0 ? 1 : -1
    const next = Math.max(0, Math.min(itemCount - 1, focusedIndexRef.current + dir))
    focusedIndexRef.current = next
    setFocusedIndex(next)
  }, [itemCount])

  const confirm = useCallback(() => {
    onSelect(focusedIndexRef.current)
  }, [onSelect])

  const tapItem = useCallback((index: number) => {
    focusedIndexRef.current = index
    setFocusedIndex(index)
    if (allowTapSelect) {
      onSelect(index)
    }
  }, [onSelect, allowTapSelect])

  useEffect(() => {
    if (focusedIndex < 0 || focusedIndex >= itemCount) return
    const el = scrollRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedIndex, itemCount])

  useEffect(() => {
    ListFocusContext.setActive({ onWheel: handleWheel, onConfirm: confirm })
    return () => {
      ListFocusContext.setActive(null)
    }
  }, [handleWheel, confirm])

  return {
    focusedIndex,
    handleWheel,
    confirm,
    tapItem,
    setFocusRef: (el: HTMLLIElement | null) => { scrollRef.current = el },
  }
}
