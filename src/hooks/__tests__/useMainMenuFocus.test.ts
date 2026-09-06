import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMainMenuFocus } from '../useMainMenuFocus'
import { ListFocusContext } from '@/navigation/listFocusContext'

function makeWheelEvent(deltaX: number): WheelEvent {
  return { deltaX, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as WheelEvent
}

function renderFocus(options?: Partial<Parameters<typeof useMainMenuFocus>[0]>) {
  return renderHook(() =>
    useMainMenuFocus({
      sidebarCount: 5,
      contentCount: 4,
      onExit: vi.fn(),
      onConfirmContent: vi.fn(),
      ...options,
    }),
  )
}

describe('useMainMenuFocus', () => {
  it('starts in the sidebar pane with the first item focused', () => {
    const { result } = renderFocus()
    expect(result.current.activePane).toBe('sidebar')
    expect(result.current.sidebarIndex).toBe(0)
    expect(result.current.contentIndex).toBe(0)
  })

  it('moves the sidebar focus vertically on wheel turns and clamps at the edges', () => {
    const { result } = renderFocus()

    // clockwise turn = negative deltaX = focus down
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.sidebarIndex).toBe(1)

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(10))
    })
    expect(result.current.sidebarIndex).toBe(0)

    // clamped at the top edge
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(10))
    })
    expect(result.current.sidebarIndex).toBe(0)
  })

  it('moving the dial in content mode rotates through the cards', () => {
    const { result } = renderFocus()

    // enter the content pane first
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
    expect(result.current.activePane).toBe('content')

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.contentIndex).toBe(2)

    // clamped at the end (contentCount = 4)
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.contentIndex).toBe(3)
  })

  it('pressing the dial on a sidebar item enters the content pane on the first card', () => {
    const { result } = renderFocus()

    // step over the exit item (index 1) to 'Playlists' (index 2)
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(result.current.sidebarIndex).toBe(2)

    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
    expect(result.current.activePane).toBe('content')
    expect(result.current.contentIndex).toBe(0)
    expect(result.current.sidebarIndex).toBe(2)
  })

  it('bug20: confirming the Läuft gerade item enters the content pane, it no longer exits', () => {
    const onExit = vi.fn()
    const { result } = renderFocus({ onExit })

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10)) // focus index 1
    })
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
    expect(onExit).not.toHaveBeenCalled()
    expect(result.current.activePane).toBe('content')
    expect(result.current.sidebarIndex).toBe(1)
    expect(result.current.contentIndex).toBe(0)
  })

  it('pressing the dial in content mode confirms the focused card', () => {
    const onConfirmContent = vi.fn()
    renderFocus({ onConfirmContent })

    act(() => {
      ListFocusContext.entry.onConfirm?.() // enter content
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
    expect(onConfirmContent).toHaveBeenCalledTimes(1)
    expect(onConfirmContent).toHaveBeenCalledWith(2)
  })

  it('back in content mode returns focus to the sidebar without exiting', () => {
    const onExit = vi.fn()
    const { result } = renderFocus({ onExit })

    act(() => {
      ListFocusContext.entry.onConfirm?.() // enter content
    })
    act(() => {
      ListFocusContext.entry.onBack?.()
    })
    expect(onExit).not.toHaveBeenCalled()
    expect(result.current.activePane).toBe('sidebar')
  })

  it('back in sidebar mode exits the menu', () => {
    const onExit = vi.fn()
    renderFocus({ onExit })

    act(() => {
      ListFocusContext.entry.onBack?.()
    })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('selectContent focuses the card and confirms it', () => {
    const onConfirmContent = vi.fn()
    const { result } = renderFocus({ onConfirmContent })

    act(() => {
      result.current.selectContent(3)
    })
    expect(result.current.contentIndex).toBe(3)
    expect(onConfirmContent).toHaveBeenCalledWith(3)
  })

  it('bug25: onWheelContent=true consumes the tick without moving the content focus', () => {
    const onWheelContent = vi.fn(() => true)
    const { result } = renderFocus({ onWheelContent })

    act(() => {
      ListFocusContext.entry.onConfirm?.() // enter content
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(onWheelContent).toHaveBeenCalledTimes(2)
    expect(onWheelContent).toHaveBeenCalledWith(1)
    expect(result.current.contentIndex).toBe(0)
  })

  it('bug25: onWheelContent=false lets the content focus move as usual', () => {
    const onWheelContent = vi.fn(() => false)
    const { result } = renderFocus({ onWheelContent })

    act(() => {
      ListFocusContext.entry.onConfirm?.() // enter content
    })
    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(onWheelContent).toHaveBeenCalledTimes(1)
    expect(result.current.contentIndex).toBe(1)
  })

  it('bug25: onWheelContent is not called while the sidebar is focused', () => {
    const onWheelContent = vi.fn(() => true)
    renderFocus({ onWheelContent })

    act(() => {
      ListFocusContext.entry.onWheel(makeWheelEvent(-10))
    })
    expect(onWheelContent).not.toHaveBeenCalled()
  })

  // bug53: the hold twin of confirm — the dial press held ≥ CARD_HOLD_MS
  // (the hardware layer decides when to call entry.onHold)
  describe('hold routing (bug53)', () => {
    it('content pane: entry.onHold routes to onHoldContent with the focused index', () => {
      const onConfirmContent = vi.fn()
      const onHoldContent = vi.fn()
      renderFocus({ onConfirmContent, onHoldContent })

      act(() => {
        ListFocusContext.entry.onConfirm?.() // enter content
      })
      act(() => {
        ListFocusContext.entry.onWheel(makeWheelEvent(-10)) // focus index 1
      })
      act(() => {
        ListFocusContext.entry.onHold?.()
      })

      expect(onHoldContent).toHaveBeenCalledTimes(1)
      expect(onHoldContent).toHaveBeenCalledWith(1)
      expect(onConfirmContent).not.toHaveBeenCalled()
    })

    it('content pane without onHoldContent falls back to the plain confirm behavior', () => {
      const onConfirmContent = vi.fn()
      renderFocus({ onConfirmContent })

      act(() => {
        ListFocusContext.entry.onConfirm?.() // enter content
      })
      act(() => {
        ListFocusContext.entry.onWheel(makeWheelEvent(-10)) // focus index 1
      })
      act(() => {
        ListFocusContext.entry.onHold?.()
      })

      expect(onConfirmContent).toHaveBeenCalledTimes(1)
      expect(onConfirmContent).toHaveBeenCalledWith(1)
    })

    it('sidebar pane: entry.onHold behaves like confirm (enters the content pane)', () => {
      const onHoldContent = vi.fn()
      const onSelectSidebar = vi.fn()
      const { result } = renderFocus({ onHoldContent, onSelectSidebar })

      act(() => {
        ListFocusContext.entry.onHold?.()
      })

      expect(result.current.activePane).toBe('content')
      expect(result.current.contentIndex).toBe(0)
      expect(onSelectSidebar).toHaveBeenCalledWith(0)
      expect(onHoldContent).not.toHaveBeenCalled()
    })
  })

  it('keeps the content focus in range when the card list shrinks', () => {
    const { result, rerender } = renderHook(
      ({ contentCount }: { contentCount: number }) =>
        useMainMenuFocus({
          sidebarCount: 5,
          contentCount,
          onExit: vi.fn(),
          onConfirmContent: vi.fn(),
        }),
      { initialProps: { contentCount: 4 } },
    )

    act(() => {
      result.current.selectContent(3)
    })
    expect(result.current.contentIndex).toBe(3)

    rerender({ contentCount: 1 })
    expect(result.current.contentIndex).toBe(0)
  })
})
