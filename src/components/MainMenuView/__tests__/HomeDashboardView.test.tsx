// ticket 9.6 (Task B): smoke test for HomeDashboardView — the pure rendering
// contract on top of the homeDashboard.ts view models (Task A): all three
// zones always render, unmapped slots carry placeholder markers, data-entity-id
// is set only on real entities, and focusedIndex marks exactly one node.

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
