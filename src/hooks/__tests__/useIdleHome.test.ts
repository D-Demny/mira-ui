import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  IDLE_HOME_PAUSED_MS,
  IDLE_HOME_STOPPED_MS,
  useIdleHome,
  type UseIdleHomeParams,
} from '../useIdleHome'

describe('useIdleHome', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  function params(over: Partial<UseIdleHomeParams> = {}): UseIdleHomeParams {
    return {
      enabled: true,
      eligible: true,
      phase: 'stopped',
      showing: false,
      onShow: vi.fn(),
      onHide: vi.fn(),
      ...over,
    }
  }

  it('switches to home after the ~3 s quiet time following a stop', () => {
    const onShow = vi.fn()
    renderHook(() => useIdleHome(params({ onShow })))

    advance(IDLE_HOME_STOPPED_MS - 1)
    expect(onShow).not.toHaveBeenCalled()
    advance(1)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('waits the 30 s grace after a pause before switching', () => {
    const onShow = vi.fn()
    renderHook(() => useIdleHome(params({ phase: 'paused', onShow })))

    advance(IDLE_HOME_STOPPED_MS * 2)
    expect(onShow).not.toHaveBeenCalled() // the stopped delay is not the paused grace
    advance(IDLE_HOME_PAUSED_MS - IDLE_HOME_STOPPED_MS * 2)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it('never arms while a device is playing', () => {
    const onShow = vi.fn()
    renderHook(() => useIdleHome(params({ phase: 'playing', onShow })))
    advance(IDLE_HOME_STOPPED_MS * 2)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('never arms while the toggle is off', () => {
    const onShow = vi.fn()
    renderHook(() => useIdleHome(params({ enabled: false, onShow })))
    advance(IDLE_HOME_STOPPED_MS * 2)
    expect(onShow).not.toHaveBeenCalled()
  })

  it('never arms while something else owns the screen', () => {
    const onShow = vi.fn()
    renderHook(() => useIdleHome(params({ eligible: false, onShow })))
    advance(IDLE_HOME_STOPPED_MS * 2)
    expect(onShow).not.toHaveBeenCalled()
  })

  it.each(['pointerdown', 'keydown', 'wheel'] as const)(
    'restarts the full delay on %s (tap, dial, and physical keys all count)',
    (event) => {
      const onShow = vi.fn()
      renderHook(() => useIdleHome(params({ onShow })))

      advance(IDLE_HOME_STOPPED_MS - 1000)
      act(() => void window.dispatchEvent(new Event(event)))

      advance(IDLE_HOME_STOPPED_MS - 1000)
      expect(onShow).not.toHaveBeenCalled() // the first stretch does not carry over
      advance(1000)
      expect(onShow).toHaveBeenCalledTimes(1)
    },
  )

  it('re-arms with the new phase delay when the player pauses', () => {
    const onShow = vi.fn()
    const { rerender } = renderHook((p: UseIdleHomeParams) => useIdleHome(p), {
      initialProps: params({ onShow }),
    })

    advance(IDLE_HOME_STOPPED_MS - 1000)
    rerender(params({ phase: 'paused', onShow })) // the pause restarts the window

    advance(IDLE_HOME_STOPPED_MS)
    expect(onShow).not.toHaveBeenCalled()
    advance(IDLE_HOME_PAUSED_MS - IDLE_HOME_STOPPED_MS)
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  describe('returning to the player', () => {
    it('hides the view immediately when playback starts', () => {
      const onHide = vi.fn()
      renderHook(() => useIdleHome(params({ showing: true, phase: 'playing', onHide })))
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('hides the view when the toggle is switched off while it is up', () => {
      const onHide = vi.fn()
      renderHook(() => useIdleHome(params({ showing: true, enabled: false, onHide })))
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('keeps the view up across system screens (mere ineligibility does not clear it)', () => {
      const onHide = vi.fn()
      renderHook(() =>
        useIdleHome(params({ showing: true, eligible: false, phase: 'stopped', onHide })),
      )
      expect(onHide).not.toHaveBeenCalled()
    })

    it('keeps the view up while paused (the grace already elapsed)', () => {
      const onHide = vi.fn()
      renderHook(() => useIdleHome(params({ showing: true, phase: 'paused', onHide })))
      expect(onHide).not.toHaveBeenCalled()
    })
  })
})
