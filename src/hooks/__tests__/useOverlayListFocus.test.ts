import { createElement, StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOverlayListFocus } from '../useOverlayListFocus'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ListFocusEntry } from '@/navigation/listFocusContext'

// bug31: the hook that registers a modal overlay on the list focus stack so
// the hardware dial (wheel/Enter/Escape) is routed to the popup while open

function makeWheelEvent(deltaX: number): WheelEvent {
  return { deltaX, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as WheelEvent
}

function makeParentEntry(): ListFocusEntry {
  return { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
}

function renderFocus(options?: Partial<Parameters<typeof useOverlayListFocus>[0]>) {
  return renderHook(() =>
    useOverlayListFocus({
      itemCount: 4,
      onConfirm: vi.fn(),
      onBack: vi.fn(),
      ...options,
    }),
  )
}

describe('useOverlayListFocus (bug31)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('registers an active entry on top of the stack while mounted', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)
    const { result } = renderFocus()

    expect(ListFocusContext.entry.active).toBe(true)
    expect(ListFocusContext.entry).not.toBe(parent)
    expect(result.current.focusedIndex).toBe(0)
  })

  it('moves the focus with the dial and clamps at both ends', () => {
    const { result } = renderFocus()

    // clockwise turn = negative deltaX = focus down
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.focusedIndex).toBe(1)

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.focusedIndex).toBe(3)

    // clamped at the end (itemCount = 4)
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.focusedIndex).toBe(3)

    // back up
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(10))
    })
    expect(result.current.focusedIndex).toBe(2)
  })

  it('confirms the focused item on dial press', () => {
    const onConfirm = vi.fn()
    renderFocus({ onConfirm })

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(1)
  })

  it('consumes the back button and calls onBack', () => {
    const onBack = vi.fn()
    renderFocus({ onBack })

    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
  })

  it('restores the parent entry when the overlay unmounts', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)
    const { unmount } = renderFocus()
    expect(ListFocusContext.entry).not.toBe(parent)

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('registers exactly one entry under StrictMode double-mount', () => {
    // StrictMode (dev) runs the effect twice; the cleanup must remove the
    // first entry so the stack never holds a stale copy
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)
    const { unmount } = renderHook(
      () => useOverlayListFocus({ itemCount: 4, onConfirm: vi.fn(), onBack: vi.fn() }),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) },
    )
    expect(ListFocusContext.entry).not.toBe(parent)

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('honors initialIndex and clamps it into range', () => {
    const { result } = renderFocus({ initialIndex: 2 })
    expect(result.current.focusedIndex).toBe(2)

    const outOfRange = renderFocus({ initialIndex: 99 })
    expect(outOfRange.result.current.focusedIndex).toBe(3)
  })

  it('keeps the focus in range when the list shrinks', () => {
    const { result, rerender } = renderHook(
      ({ count }) =>
        useOverlayListFocus({ itemCount: count, onConfirm: vi.fn(), onBack: vi.fn() }),
      { initialProps: { count: 4 } },
    )

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.focusedIndex).toBe(3)

    rerender({ count: 2 })
    expect(result.current.focusedIndex).toBe(1)
  })

  it('ignores wheel ticks without horizontal delta', () => {
    const { result } = renderFocus()

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(0))
    })
    expect(result.current.focusedIndex).toBe(0)
  })
})
