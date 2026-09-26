import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOverlays, type OverlayId, type UseOverlaysParams } from '../useOverlays'

const render = (params: UseOverlaysParams = {}) => renderHook(() => useOverlays(params))

describe('useOverlays', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens and closes by id', () => {
    const { result } = render()
    expect(result.current.isOpen('menu')).toBe(false)

    act(() => result.current.open('menu'))
    expect(result.current.isOpen('menu')).toBe(true)

    act(() => result.current.close('menu'))
    expect(result.current.isOpen('menu')).toBe(false)
  })

  it('toggles the real state, not what a dev screen forced on top of it', () => {
    const { result } = render({ forcedOpen: { powerMenu: true } })
    expect(result.current.isOpen('powerMenu')).toBe(true)

    // the hardware key flips the underlying state; the override still wins
    act(() => result.current.toggle('powerMenu'))
    expect(result.current.isOpen('powerMenu')).toBe(true)

    act(() => result.current.toggle('powerMenu'))
    expect(result.current.isOpen('powerMenu')).toBe(true)
  })

  describe('busy', () => {
    it('is false with nothing up', () => {
      expect(render().result.current.busy).toBe(false)
    })

    it('is true while an overlay owns the screen', () => {
      const { result } = render()
      act(() => result.current.open('settings'))
      expect(result.current.busy).toBe(true)
    })
  })

  describe('goBack', () => {
    it('reports nothing to close on an empty stack', () => {
      const { result } = render()
      let handled = true
      act(() => {
        handled = result.current.goBack()
      })
      expect(handled).toBe(false)
    })

    it('closes the topmost overlay and leaves the rest alone', () => {
      const { result } = render()
      act(() => {
        result.current.open('menu')
        result.current.open('settings')
      })

      act(() => void result.current.goBack())
      expect(result.current.isOpen('settings')).toBe(false)
      expect(result.current.isOpen('menu')).toBe(true)

      act(() => void result.current.goBack())
      expect(result.current.isOpen('menu')).toBe(false)
    })

    it('unwinds in a fixed order regardless of the order they opened', () => {
      const order: OverlayId[] = ['screensaver', 'report', 'debug', 'btMenu', 'powerMenu']
      const { result } = render()
      act(() => {
        result.current.open('powerMenu')
        result.current.open('btMenu')
        result.current.open('debug')
        result.current.openReport('r-1')
        result.current.open('screensaver')
      })

      for (const id of order) {
        expect(result.current.isOpen(id)).toBe(true)
        act(() => void result.current.goBack())
        expect(result.current.isOpen(id)).toBe(false)
      }
    })

    it('treats a forced-open overlay as really open', () => {
      const { result } = render({ forcedOpen: { menu: true } })
      expect(result.current.busy).toBe(true)

      let handled = false
      act(() => {
        handled = result.current.goBack()
      })
      expect(handled).toBe(true)
    })
  })

  describe('closing remembers what it has to', () => {
    it('tells the caller which overlay closed', () => {
      const onClosed = vi.fn()
      const { result } = render({ onClosed })
      act(() => result.current.open('powerMenu'))
      act(() => void result.current.goBack())
      expect(onClosed).toHaveBeenCalledWith('powerMenu')
    })
  })

  it('carries the id the report dialog is showing', () => {
    const { result } = render()
    expect(result.current.isOpen('report')).toBe(false)

    act(() => result.current.openReport('report-42'))
    expect(result.current.reportId).toBe('report-42')
    expect(result.current.isOpen('report')).toBe(true)

    act(() => result.current.close('report'))
    expect(result.current.reportId).toBeNull()
  })

  it('keeps a stable identity so the back handler is not rebuilt each render', () => {
    // App feeds goBack to the hardware keys; an unstable one tears the
    // listeners down on every render
    const params: UseOverlaysParams = { forcedOpen: {}, onClosed: vi.fn() }
    const { result, rerender } = renderHook(() => useOverlays(params))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('remembers whether the screensaver was opened by hand or by the idle timer', () => {
    const { result } = render()
    expect(result.current.screensaverBy).toBe('manual')

    act(() => result.current.openScreensaver('auto'))
    expect(result.current.isOpen('screensaver')).toBe(true)
    expect(result.current.screensaverBy).toBe('auto')
  })
})
