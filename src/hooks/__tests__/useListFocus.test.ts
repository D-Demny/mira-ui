import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useListFocus } from '@/hooks/useListFocus'

describe('useListFocus', () => {
  it('starts with focusedIndex 0', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect: vi.fn() }))
    expect(result.current.focusedIndex).toBe(0)
  })

  it('increments focusedIndex on CW wheel', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect: vi.fn() }))
    act(() => {
      result.current.handleWheel({ deltaX: 1, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
    expect(result.current.focusedIndex).toBe(1)
  })

  it('decrements focusedIndex on CCW wheel', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect: vi.fn() }))
    act(() => {
      result.current.handleWheel({ deltaX: -1, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not go below 0', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect: vi.fn() }))
    act(() => {
      result.current.handleWheel({ deltaX: -1, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not exceed itemCount - 1', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect: vi.fn() }))
    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.handleWheel({ deltaX: 1, preventDefault: vi.fn() } as unknown as WheelEvent)
      }
    })
    expect(result.current.focusedIndex).toBe(4)
  })

  it('calls onSelect on confirm', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect }))
    act(() => {
      result.current.handleWheel({ deltaX: 1, preventDefault: vi.fn() } as unknown as WheelEvent)
      result.current.handleWheel({ deltaX: 1, preventDefault: vi.fn() } as unknown as WheelEvent)
      result.current.confirm()
    })
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('calls onSelect and sets focus on tap', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useListFocus({ itemCount: 5, onSelect }))
    act(() => {
      result.current.tapItem(3)
    })
    expect(result.current.focusedIndex).toBe(3)
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('does not call onSelect on tap when allowTapSelect is false', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useListFocus({
      itemCount: 5,
      onSelect,
      allowTapSelect: false,
    }))
    act(() => {
      result.current.tapItem(3)
    })
    expect(result.current.focusedIndex).toBe(3)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('handles 0 items gracefully', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() => useListFocus({ itemCount: 0, onSelect }))
    expect(result.current.focusedIndex).toBe(0)
    act(() => {
      result.current.confirm()
    })
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('handles 1 item without changing focus', () => {
    const { result } = renderHook(() => useListFocus({ itemCount: 1, onSelect: vi.fn() }))
    act(() => {
      result.current.handleWheel({ deltaX: 1, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
    expect(result.current.focusedIndex).toBe(0)
    act(() => {
      result.current.handleWheel({ deltaX: -1, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
    expect(result.current.focusedIndex).toBe(0)
  })
})
