import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProgressBar } from '../ProgressBar'
import { activeStatus } from '../../../__tests__/fixtures/observer'

// transition logic is in scrubMachine.test.ts

// jsdom returns a zero-width rect by default, patch a width on the .bar
function mockBarRect(slider: HTMLElement, width: number) {
  const bar = slider.querySelector(':scope > div')
  if (!bar) throw new Error('expected bar element inside slider')
  ;(bar as HTMLElement).getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width,
      height: 6,
      top: 0,
      left: 0,
      right: width,
      bottom: 6,
      toJSON: () => ({}),
    }) as DOMRect
}

function stubPointerCapture(el: HTMLElement) {
  el.setPointerCapture = () => undefined
  el.releasePointerCapture = () => undefined
}

describe('ProgressBar DOM event wiring', () => {
  it('routes pointerdown pointerup into a seek call at the tapped position', () => {
    const onSeek = vi.fn()
    render(<ProgressBar status={activeStatus} onSeek={onSeek} />)

    const slider = screen.getByRole('slider')
    mockBarRect(slider, 800)
    stubPointerCapture(slider)

    // tap at 400/800 = 0.5, fixture duration 180_000ms, expect 90_000
    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(slider, { clientX: 400, pointerId: 1 })

    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(90_000)
  })

  it('does not fire a seek when interrupted by pointercancel', () => {
    // regression test for the "drag goes to position 0" bug
    const onSeek = vi.fn()
    // dev-mode warn fires on cancel
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      render(<ProgressBar status={activeStatus} onSeek={onSeek} />)

      const slider = screen.getByRole('slider')
      mockBarRect(slider, 800)
      stubPointerCapture(slider)

      fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
      fireEvent.pointerMove(slider, { clientX: 560, pointerId: 1 })
      fireEvent.pointerCancel(slider, { clientX: 0, pointerId: 1 })

      expect(onSeek).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pointercancel during scrub'),
        expect.anything(),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
