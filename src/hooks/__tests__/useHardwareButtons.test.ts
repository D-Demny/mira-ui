import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ObserverStatusActive } from '@/api/types'

// the wheel listener only registers while a session is active
const activeStatus: ObserverStatusActive = {
  active: true,
  device_id: 'device-1',
  device_name: 'Mira',
  device_type: 'speaker',
  track_id: 't-1',
  track_uri: 'spotify:track:t-1',
  track_name: 'Song',
  track_artist: 'Artist',
  track_album: 'Album',
  track_image: '',
  context_uri: 'spotify:context:1',
  context_name: '',
  duration: 200,
  position: 10,
  is_playing: true,
  is_paused: false,
  volume: 50,
  shuffle: false,
  repeat_context: false,
  repeat_track: false,
  lyrics_url: '',
  received_at: 0,
}

function setup() {
  const onPlayPause = vi.fn()
  const onBack = vi.fn()
  const utils = renderHook(() =>
    useHardwareButtons({
      status: null,
      onPlayPause,
      setVolume: vi.fn(),
      playContext: vi.fn(),
      onBack,
      onTogglePowerMenu: vi.fn(),
      onScreensaver: vi.fn(),
      onOpenDebug: vi.fn(),
      notify: vi.fn(),
    }),
  )
  return { onPlayPause, onBack, ...utils }
}

function pressEnter() {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

describe('useHardwareButtons Enter handling', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('calls onConfirm and not onPlayPause when list focus is active', () => {
    const { onPlayPause } = setup()
    const onConfirm = vi.fn()
    ListFocusContext.setActive({ onWheel: vi.fn(), onConfirm, active: true })

    pressEnter()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onPlayPause).not.toHaveBeenCalled()
  })

  it('calls onPlayPause when list focus is not active', () => {
    const { onPlayPause } = setup()
    ListFocusContext.setActive(null)

    pressEnter()

    expect(onPlayPause).toHaveBeenCalledTimes(1)
  })

  it('calls onBack on Escape', () => {
    const { onBack } = setup()
    ListFocusContext.setActive(null)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('lets an active list focus handle Escape before the app back handler', () => {
    const { onBack } = setup()
    const onBackFocus = vi.fn(() => true)
    ListFocusContext.setActive({ onWheel: vi.fn(), onConfirm: null, onBack: onBackFocus, active: true })

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onBackFocus).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('falls through to the app back handler when list focus does not handle Escape', () => {
    const { onBack } = setup()
    const onBackFocus = vi.fn(() => false)
    ListFocusContext.setActive({ onWheel: vi.fn(), onConfirm: null, onBack: onBackFocus, active: true })

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onBackFocus).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('useHardwareButtons list-focus wheel throttling (bug8.2)', () => {
  function setupWithStatus() {
    renderHook(() =>
      useHardwareButtons({
        status: activeStatus,
        onPlayPause: vi.fn(),
        setVolume: vi.fn(),
        playContext: vi.fn(),
        onBack: vi.fn(),
        onTogglePowerMenu: vi.fn(),
        onScreensaver: vi.fn(),
        onOpenDebug: vi.fn(),
        notify: vi.fn(),
      }),
    )
  }

  function turnWheel(deltaX: number): WheelEvent {
    const e = new WheelEvent('wheel', { deltaX, deltaY: 0, cancelable: true, bubbles: true })
    window.dispatchEvent(e)
    return e
  }

  afterEach(() => {
    ListFocusContext.setActive(null)
    vi.useRealTimers()
  })

  it('dispatches at most one list-focus wheel event per 35ms, dropping the rest', () => {
    vi.useFakeTimers()
    setupWithStatus()
    const onWheel = vi.fn()
    ListFocusContext.setActive({ onWheel, onConfirm: null, active: true })

    turnWheel(-1)
    expect(onWheel).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(20)
    turnWheel(-1)
    expect(onWheel).toHaveBeenCalledTimes(1) // 20ms < 35ms → dropped, not queued

    vi.advanceTimersByTime(20)
    turnWheel(-1)
    expect(onWheel).toHaveBeenCalledTimes(2) // 40ms total → passes
  })

  it('still prevents native scrolling for a dropped tick', () => {
    vi.useFakeTimers()
    setupWithStatus()
    const onWheel = vi.fn()
    ListFocusContext.setActive({ onWheel, onConfirm: null, active: true })

    turnWheel(-1)
    const dropped = turnWheel(-1)

    expect(onWheel).toHaveBeenCalledTimes(1)
    expect(dropped.defaultPrevented).toBe(true)
  })
})
