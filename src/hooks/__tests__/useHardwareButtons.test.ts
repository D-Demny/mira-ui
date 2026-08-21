import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { ListFocusContext } from '@/navigation/listFocusContext'

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
