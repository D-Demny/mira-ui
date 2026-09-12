// ticket 9.6 (Task B): smoke test for HomeDashboardView — the pure rendering
// contract on top of the homeDashboard.ts view models (Task A): all three
// zones always render, unmapped slots carry placeholder markers, data-entity-id
// is set only on real entities, and focusedIndex marks exactly one node.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import { HomeDashboardView } from '../HomeDashboardView'
import type { DashboardEntity } from '../homeDashboard'

function scene(entityId: string, label: string): DashboardEntity {
  return {
    entityId,
    domain: 'scene',
    label,
    state: null,
    active: null,
    dimmable: false,
    brightnessPct: null,
  }
}

function light(entityId: string, label: string): DashboardEntity {
  return {
    entityId,
    domain: 'light',
    label,
    state: 'on',
    active: true,
    dimmable: true,
    brightnessPct: 40,
  }
}

describe('HomeDashboardView (ticket9.6)', () => {
  it('renders all three zones with placeholder markers when nothing is configured', () => {
    const { container } = render(<HomeDashboardView entities={[]} />)
    // 3 scene slots + 4 light tiles + section + 2 cover columns = 10 marked nodes
    expect(container.querySelectorAll('[data-dashboard-placeholder="true"]').length).toBe(10)
    // default mockup labels across all three zones
    for (const label of [
      'Normales Licht',
      'Cosy time',
      'Betti Zeit',
      'Esstisch',
      'Flurlicht',
      'Stehlampen',
      'Treppenspots',
      'Wohnzimmer und Esszimmer',
      'Rollo Steuerung EG',
      'Wohnzimmer',
      'Esszimmer',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('renders real labels and fills the remaining slots with placeholders', () => {
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    // data-entity-id on the 3 real nodes only — placeholders fill the rest
    // (2 scene slots + 2 light tiles + section + 2 cover columns = 7 marked)
    expect(container.querySelectorAll('[data-entity-id]').length).toBe(3)
    expect(screen.getByText('Abendstimmung')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-dashboard-placeholder="true"]').length).toBe(7)
  })

  it('marks exactly one node focused (chain: scenes → lights → covers)', () => {
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    // 3 scene slots + 4 light tiles + 2 cover columns → index 4 = 2nd light tile
    const { container, rerender } = render(<HomeDashboardView entities={entities} focusedIndex={4} />)
    const focused = container.querySelectorAll('.focused')
    expect(focused.length).toBe(1)
    expect(focused[0]).toHaveAttribute('data-entity-id', 'light.flurlicht')
    // undefined focusedIndex → nothing focused
    rerender(<HomeDashboardView entities={entities} />)
    expect(container.querySelectorAll('.focused').length).toBe(0)
  })
})

// ticket 9.6 W2-3a: touch hold (pattern ported from ContentCarousel). A held
// press (≥ CARD_HOLD_MS) fires the hold callback once and suppresses the
// short-press that follows it; a press under the threshold stays a plain tap.
describe('HomeDashboardView touch hold (ticket 9.6 W2-3a)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // grab the interactive node for a given entity label (light tile or cover button)
  function nodeFor(container: HTMLElement, selector: string): HTMLElement {
    const el = container.querySelector(selector)
    expect(el).not.toBeNull()
    return el as HTMLElement
  }

  it('dimmable light tile hold fires onLightHold after CARD_HOLD_MS and suppresses the click', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    const entities = [light('light.esstisch_lampe', 'Esstisch Lampe')]
    const { container } = render(
      <HomeDashboardView entities={entities} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.esstisch_lampe"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS - 1) // still inside the hold budget
    expect(onLightHold).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1) // the deadline fires exactly once
    expect(onLightHold).toHaveBeenCalledTimes(1)
    // the LIGHT TILE view model (Task A), not the raw entity
    expect(onLightHold).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'light.esstisch_lampe', dimmable: true }),
    )

    // the click that follows a long press must be suppressed — no short-press tap
    fireEvent.pointerUp(tile)
    fireEvent.click(tile)
    expect(onLightTap).not.toHaveBeenCalled()
  })

  it('non-dimmable light tile fires no hold (short-press stays plain W2-2)', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    // switch-like light: dimmable false → the tile is NOT holdable
    const entity: DashboardEntity = {
      entityId: 'light.trichtspot',
      domain: 'light',
      label: 'Trittspot',
      state: 'on',
      active: true,
      dimmable: false,
      brightnessPct: null,
    }
    const { container } = render(
      <HomeDashboardView entities={[entity]} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.trichtspot"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS * 2) // well past the deadline
    expect(onLightHold).not.toHaveBeenCalled()

    // no hold armed → the short-press click still routes to onLightTap
    fireEvent.pointerUp(tile)
    fireEvent.click(tile)
    expect(onLightTap).toHaveBeenCalledTimes(1)
    // the LIGHT TILE view model (Task A), not the raw entity
    expect(onLightTap).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'light.trichtspot', dimmable: false }),
    )
  })

  it('cover button hold fires onCoverHold with the column (both ^ and v)', () => {
    vi.useFakeTimers()
    const onCoverAction = vi.fn()
    const onCoverHold = vi.fn()
    // no real cover → both columns are placeholders, still holdable
    const { container } = render(
      <HomeDashboardView entities={[]} onCoverAction={onCoverAction} onCoverHold={onCoverHold} />,
    )
    const upBtn = nodeFor(container, '[data-cover-action="up"]')

    fireEvent.pointerDown(upBtn)
    vi.advanceTimersByTime(CARD_HOLD_MS) // the deadline fires the column hold
    expect(onCoverHold).toHaveBeenCalledTimes(1)
    // placeholder column model carries entityId null + the mockup label
    expect(onCoverHold).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: null, label: 'Wohnzimmer' }),
    )

    // a fired hold suppresses the subsequent ^ short-press on the same press
    fireEvent.pointerUp(upBtn)
    fireEvent.click(upBtn)
    expect(onCoverAction).not.toHaveBeenCalled()
  })

  it('placeholder cover column hold also shows the W2-2 toast', () => {
    vi.useFakeTimers()
    const onCoverHold = vi.fn()
    // no real cover → both columns are placeholders
    const { container } = render(<HomeDashboardView entities={[]} onCoverHold={onCoverHold} />)
    const upBtn = nodeFor(container, '[data-cover-action="up"]')

    fireEvent.pointerDown(upBtn)
    act(() => {
      vi.advanceTimersByTime(CARD_HOLD_MS) // the deadline fires the column hold
    })
    expect(onCoverHold).toHaveBeenCalledTimes(1)
    // W2-3: a placeholder column is a no-op for the parent, so the component
    // reuses the W2-2 toast as the feedback for the hold
    const toast = container.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast).toHaveTextContent('„Wohnzimmer" ist noch nicht zugewiesen')
  })

  it('short press (under CARD_HOLD_MS) fires the tap only, no hold', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    const entities = [light('light.esstisch_lampe', 'Esstisch Lampe')]
    const { container } = render(
      <HomeDashboardView entities={entities} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.esstisch_lampe"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS - 1) // still inside the hold budget
    fireEvent.pointerUp(tile) // released before the deadline → a short press
    expect(onLightHold).not.toHaveBeenCalled()

    fireEvent.click(tile)
    expect(onLightTap).toHaveBeenCalledTimes(1)
    expect(onLightHold).not.toHaveBeenCalled()
  })
})
