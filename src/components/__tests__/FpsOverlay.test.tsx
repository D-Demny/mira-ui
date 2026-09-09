// PERF-A/B (temp) — FpsOverlay chip wiring tests (Bug58, debug/fps-bug58 only).
// The FPS readout itself stays on the ref/textContent path and is not asserted
// here. The overlay root is aria-hidden="true" (pure measurement HUD), so the
// chips are looked up by text, never by accessibility role. Strip together with
// the other PERF-A/B markers when the branch is deleted.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetPerfFlags } from '@/perfFlags'
import FpsOverlay from '../FpsOverlay'

const LS_KEY = 'mira.perf.debug'

// the store seeds at import time and survives across tests in this file —
// clear storage AND re-seed so every test starts from all-off
beforeEach(() => {
  localStorage.clear()
  __resetPerfFlags()
})

// the chip <span> renders exactly its label letter as text content
function chip(label: string): HTMLElement {
  return screen.getByText(label, { exact: true })
}

describe('FpsOverlay toggle chips (PERF-A/B temp)', () => {
  it('renders one chip per experiment flag: S, C, A and N', () => {
    render(<FpsOverlay />)
    for (const label of ['S', 'C', 'A', 'N']) {
      expect(chip(label).textContent).toBe(label)
    }
  })

  it('clicking N flips anim-carousel and persists it to localStorage', async () => {
    const user = userEvent.setup()
    render(<FpsOverlay />)
    const n = chip('N')

    // inactive chips render dimmed
    expect(n.style.color).toBe('rgba(255, 255, 255, 0.35)')

    await user.click(n)
    const persisted = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    expect(persisted.animCarousel).toBe(true)
    expect(persisted.staticBg).toBe(false)
    // the flipped chip now renders bright (the dimmed color is gone)
    expect(n.style.color).not.toBe('rgba(255, 255, 255, 0.35)')
  })

  it('clicking an active chip flips the flag back off', async () => {
    // the store seeds at module import time (all off here), so reach the
    // active state through a real toggle first
    const user = userEvent.setup()
    render(<FpsOverlay />)
    const n = chip('N')
    await user.click(n)
    expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}').animCarousel).toBe(true)
    await user.click(n)
    expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}').animCarousel).toBe(false)
  })
})
