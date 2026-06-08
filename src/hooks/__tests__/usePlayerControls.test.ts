import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePlayerControls } from '../usePlayerControls'
import { activeStatus } from '../../__tests__/fixtures/observer'
import type { ObserverStatusActive } from '../../api/types'

function makeMocks() {
  return {
    togglePlayPause: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    next: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    prev: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    seek: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
    setShuffle: vi.fn<(on: boolean) => Promise<void>>().mockResolvedValue(undefined),
    setRepeat: vi
      .fn<(mode: 'off' | 'context' | 'track') => Promise<void>>()
      .mockResolvedValue(undefined),
  }
}

const T0 = 1_716_390_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlayerControls optimistic play/pause', () => {
  it('flips isPaused immediately on onPlayPause and fires togglePlayPause', () => {
    const mocks = makeMocks()
    const status: ObserverStatusActive = {
      ...activeStatus,
      is_paused: true,
      received_at: T0 - 1_000,
    }

    const { result } = renderHook(() => usePlayerControls({ status, ...mocks }))

    expect(result.current.isPaused).toBe(true)

    act(() => {
      result.current.onPlayPause()
    })

    expect(result.current.isPaused).toBe(false)
    expect(mocks.togglePlayPause).toHaveBeenCalledTimes(1)
  })

  it('drops the optimistic override once an observer event arrives past click time', () => {
    // regression for "play/pause stays wrong forever if the command failed silently"
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      is_paused: true,
      received_at: T0 - 1_000,
    }
    const { result, rerender } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    act(() => {
      result.current.onPlayPause()
    })
    expect(result.current.isPaused).toBe(false)

    rerender({ status: { ...initial, is_paused: true, received_at: T0 + 100 } })

    expect(result.current.isPaused).toBe(true)
  })
})

describe('usePlayerControls prev double-tap window', () => {
  it('rewinds to 0 on the first prev press without firing the prev command', () => {
    const mocks = makeMocks()
    const { result } = renderHook(() => usePlayerControls({ status: activeStatus, ...mocks }))

    act(() => {
      result.current.onPrev()
    })

    expect(mocks.seek).toHaveBeenCalledTimes(1)
    expect(mocks.seek).toHaveBeenCalledWith(0)
    expect(mocks.prev).not.toHaveBeenCalled()
  })

  it('fires the actual prev command on a second press within 1500ms', () => {
    const mocks = makeMocks()
    const { result } = renderHook(() => usePlayerControls({ status: activeStatus, ...mocks }))

    act(() => {
      result.current.onPrev()
    })
    expect(mocks.seek).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 500)

    act(() => {
      result.current.onPrev()
    })

    expect(mocks.seek).toHaveBeenCalledTimes(1)
    expect(mocks.prev).toHaveBeenCalledTimes(1)
  })

  it('rewinds again (not skip) on a second press past the 1500ms window', () => {
    // off-by-one would demote rewinds to skips at exactly 1500ms
    const mocks = makeMocks()
    const { result } = renderHook(() => usePlayerControls({ status: activeStatus, ...mocks }))

    act(() => {
      result.current.onPrev()
    })

    vi.setSystemTime(T0 + 1_500)

    act(() => {
      result.current.onPrev()
    })

    expect(mocks.seek).toHaveBeenCalledTimes(2)
    expect(mocks.seek).toHaveBeenNthCalledWith(1, 0)
    expect(mocks.seek).toHaveBeenNthCalledWith(2, 0)
    expect(mocks.prev).not.toHaveBeenCalled()
  })
})

describe('usePlayerControls repeat / shuffle cycling', () => {
  it('cycles repeat through off > context > track > off and fires setRepeat each step', () => {
    const mocks = makeMocks()
    const status: ObserverStatusActive = {
      ...activeStatus,
      repeat_context: false,
      repeat_track: false,
      received_at: T0 - 1_000,
    }
    const { result } = renderHook(() => usePlayerControls({ status, ...mocks }))

    expect(result.current.repeat).toBe('off')

    act(() => {
      result.current.onCycleRepeat()
    })
    expect(result.current.repeat).toBe('context')
    expect(mocks.setRepeat).toHaveBeenNthCalledWith(1, 'context')

    act(() => {
      result.current.onCycleRepeat()
    })
    expect(result.current.repeat).toBe('track')
    expect(mocks.setRepeat).toHaveBeenNthCalledWith(2, 'track')

    act(() => {
      result.current.onCycleRepeat()
    })
    expect(result.current.repeat).toBe('off')
    expect(mocks.setRepeat).toHaveBeenNthCalledWith(3, 'off')
  })

  it('holds optimistic shuffle through a stale status, then follows the confirmed value', () => {
    // regression for the flash: a stale in-flight status (still the old value)
    // must NOT drop the optimistic before the server reports the target
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      shuffle: false,
      received_at: T0 - 1_000,
    }
    const { result, rerender } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    act(() => {
      result.current.onToggleShuffle()
    })
    expect(result.current.shuffle).toBe(true)

    // stale status still reporting false
    rerender({ status: { ...initial, shuffle: false, received_at: T0 + 100 } })
    expect(result.current.shuffle).toBe(true)

    // server confirms the target
    rerender({ status: { ...initial, shuffle: true, received_at: T0 + 200 } })
    expect(result.current.shuffle).toBe(true)
  })

  it('clears a never-confirmed optimistic shuffle after the safety timeout', () => {
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      shuffle: false,
      received_at: T0 - 1_000,
    }
    const { result } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    act(() => {
      result.current.onToggleShuffle()
    })
    expect(result.current.shuffle).toBe(true)

    // change never confirms
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.shuffle).toBe(false)
  })

  it('holds optimistic repeat through a stale status, then follows the confirmed value', () => {
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      repeat_context: false,
      repeat_track: false,
      received_at: T0 - 1_000,
    }
    const { result, rerender } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    act(() => {
      result.current.onCycleRepeat()
    })
    expect(result.current.repeat).toBe('context')

    // stale status still reporting off
    rerender({
      status: { ...initial, repeat_context: false, repeat_track: false, received_at: T0 + 100 },
    })
    expect(result.current.repeat).toBe('context')

    // server confirms context
    rerender({
      status: { ...initial, repeat_context: true, repeat_track: false, received_at: T0 + 200 },
    })
    expect(result.current.repeat).toBe('context')
  })

  it('clears a never-confirmed optimistic repeat after the safety timeout', () => {
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      repeat_context: false,
      repeat_track: false,
      received_at: T0 - 1_000,
    }
    const { result } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    act(() => {
      result.current.onCycleRepeat()
    })
    expect(result.current.repeat).toBe('context')

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.repeat).toBe('off')
  })
})

describe('usePlayerControls track-transition dim', () => {
  it('marks transitioning during a next click and clears on the next observer event', () => {
    const mocks = makeMocks()
    const initial: ObserverStatusActive = {
      ...activeStatus,
      received_at: T0 - 1_000,
    }
    const { result, rerender } = renderHook(
      ({ status }: { status: ObserverStatusActive }) => usePlayerControls({ status, ...mocks }),
      { initialProps: { status: initial } },
    )

    expect(result.current.transitioning).toBe(false)

    act(() => {
      result.current.onNext()
    })
    expect(result.current.transitioning).toBe(true)
    expect(mocks.next).toHaveBeenCalledTimes(1)

    rerender({ status: { ...initial, received_at: T0 + 100 } })

    expect(result.current.transitioning).toBe(false)
  })

  it('does NOT mark transitioning on a first prev press (rewind, not track change)', () => {
    const mocks = makeMocks()
    const { result } = renderHook(() => usePlayerControls({ status: activeStatus, ...mocks }))

    act(() => {
      result.current.onPrev()
    })

    expect(result.current.transitioning).toBe(false)
  })
})
