import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useHardwareButtons } from '../useHardwareButtons'

const mockStatus = {
  active: true,
  volume: 32767,
  volume_disabled: false,
  track: { name: 'Test', uri: 'spotify:track:test' },
  context_uri: 'spotify:playlist:test',
  context_name: 'Test Playlist',
} as any

const createParams = (overrides: Partial<Parameters<typeof useHardwareButtons>[0]> = {}) => ({
  status: mockStatus,
  onPlayPause: vi.fn(),
  setVolume: vi.fn(),
  playContext: vi.fn(),
  onBack: vi.fn(),
  onOpenClock: vi.fn(),
  onTogglePowerMenu: vi.fn(),
  onSleep: vi.fn(),
  onOpenDebug: vi.fn(),
  notify: vi.fn(),
  ...overrides,
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHardwareButtons — power button', () => {
  it('fires onOpenClock after single press (350ms delay)', async () => {
    const params = createParams()
    const { unmount } = renderHook(() => useHardwareButtons(params))

    // Simulate keydown + keyup for a short press
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    expect(params.onOpenClock).not.toHaveBeenCalled()
    expect(params.onTogglePowerMenu).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 360))

    expect(params.onOpenClock).toHaveBeenCalledTimes(1)
    expect(params.onTogglePowerMenu).not.toHaveBeenCalled()

    unmount()
  })

  it('fires onTogglePowerMenu on double press', async () => {
    const params = createParams()
    const { unmount } = renderHook(() => useHardwareButtons(params))

    // First tap
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    // Second tap within window
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    await new Promise((r) => setTimeout(r, 50))

    expect(params.onTogglePowerMenu).toHaveBeenCalledTimes(1)
    expect(params.onOpenClock).not.toHaveBeenCalled()

    unmount()
  })

  it('fires onSleep on long press (2s)', async () => {
    const params = createParams()
    const { unmount } = renderHook(() => useHardwareButtons(params))

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))

    await new Promise((r) => setTimeout(r, 2100))

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    expect(params.onSleep).toHaveBeenCalledTimes(1)
    expect(params.onOpenClock).not.toHaveBeenCalled()
    expect(params.onTogglePowerMenu).not.toHaveBeenCalled()

    unmount()
  })

  it('ignores repeat keydown events', async () => {
    vi.useFakeTimers()
    const params = createParams()
    renderHook(() => useHardwareButtons(params))

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    // Simulate a repeat event
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: true }))

    expect(params.onOpenClock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(350)

    expect(params.onOpenClock).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('cancels single press timer when second tap arrives (double press detection)', async () => {
    const params = createParams()
    const { unmount } = renderHook(() => useHardwareButtons(params))

    // First tap
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    // Second tap within 350ms window
    await new Promise((r) => setTimeout(r, 200))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    await new Promise((r) => setTimeout(r, 200))

    expect(params.onTogglePowerMenu).toHaveBeenCalledTimes(1)
    expect(params.onOpenClock).not.toHaveBeenCalled()

    unmount()
  })

  it('cleans up timers on unmount', async () => {
    const params = createParams()
    const { unmount } = renderHook(() => useHardwareButtons(params))

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', repeat: false }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM', key: 'm' }))

    unmount()

    // Should not throw or fire callbacks after unmount
    await new Promise((r) => setTimeout(r, 400))

    // The single press timer should have been cleaned up
    expect(params.onOpenClock).not.toHaveBeenCalled()
  })
})
