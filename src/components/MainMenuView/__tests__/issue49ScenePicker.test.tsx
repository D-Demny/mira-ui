// issue #49 regression: scene entities picked in the Entity Picker must appear
// as REAL (non-placeholder) slots on the Home dashboard scene row. The earlier
// probe repro toggled the selection store directly from a sibling component,
// which bypasses the picker UI — this suite drives the REAL modal through the
// same App-level wiring as the device (App.tsx renders <HomeEntityPickerModal>
// conditionally next to <MainMenuView>; the 'Entity picker' settings row sets
// the shared open state).
//
// Branch base: stacked on fix/issue48-hide-empty-zones (#48), so expectations
// follow post-#48 zone suppression — zero configured scenes means the entire
// scene row (real slots AND placeholders) is absent.
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MainMenuView } from '../MainMenuView'
import { HomeEntityPickerModal } from '../HomeEntityPickerModal'
import { server } from '@/__tests__/msw-server'
import { ListFocusContext } from '@/navigation/listFocusContext'
import { __resetHomeLightStore } from '@/hooks/useHomeLight'
import { __resetHomeEntityStores, useHomeEntitySelection } from '@/hooks/useHomeEntities'

// issue #37 pattern: dial simulation via the top-most focus entry (the same
// routing the hardware dial uses on the device)
function wheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
  })
}

function confirmDial() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

// the App-level picker wiring (App.tsx): the modal is a sibling of
// MainMenuView, mounted by the SAME open state the settings row flips
function renderPickerHarness() {
  function PickerHarness() {
    const [pickerOpen, setPickerOpen] = useState(false)
    return (
      <>
        <MainMenuView onOpenEntityPicker={() => setPickerOpen(true)} />
        {pickerOpen ? <HomeEntityPickerModal onClose={() => setPickerOpen(false)} /> : null}
      </>
    )
  }
  return render(<PickerHarness />)
}

// settings list → 'Entity picker' row (row 8, same wheel sequence as the
// existing MainMenuView test 'the Entity picker settings row opens the entity picker')
async function openEntityPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
  await screen.findByText('Settings')
  wheel(-10) // 1 Show Lyrics
  wheel(-10) // 2 Karaoke Lyrics
  wheel(-10) // 3 Mic
  wheel(-10) // 4 Devices
  wheel(-10) // 5 Bluetooth Pairing
  wheel(-10) // 6 Raspberry Pi
  wheel(-10) // 7 Verbindung
  wheel(-10) // 8 Entity picker
  confirmDial()
}

let probeToggle: ((entityId: string) => void) | null = null
function SelectionProbe() {
  const selection = useHomeEntitySelection()
  // capture the toggle outside of render (react-hooks/globals)
  useEffect(() => {
    probeToggle = selection.toggle
  }, [selection.toggle])
  return null
}

describe('issue #49 — scene picker → home dashboard', () => {
  beforeEach(() => {
    __resetHomeLightStore()
    __resetHomeEntityStores()
    localStorage.clear()
    probeToggle = null
    server.use(
      http.get('*/ha-api/states/scene.abendstimmung', () =>
        HttpResponse.json({
          entity_id: 'scene.abendstimmung',
          state: 'none',
          attributes: { friendly_name: 'Abendstimmung' },
        }),
      ),
    )
  })

  it('a scene confirmed in the REAL picker modal renders as a real slot on the dashboard', async () => {
    renderPickerHarness()

    await openEntityPicker()

    // level 1: category cards derive from GET /states (the MSW fixture
    // includes exactly one scene) — descend into 'Szenen'
    fireEvent.click(await screen.findByRole('button', { name: /Szenen/ }))

    // level 2: the scene entity row — confirm it with the hardware dial path
    const sceneRow = await screen.findByRole('button', { name: /Abendstimmung/ })
    expect(sceneRow).toHaveAttribute('aria-pressed', 'false')
    confirmDial()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abendstimmung/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    // close the picker ('Fertig') and return to the home category
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))

    // the picked scene occupies its slot as a REAL node (no placeholder marker)
    const label = await screen.findByText('Abendstimmung')
    const btn = label.closest('[data-entity-id]')
    expect(btn).not.toBeNull()
    expect(btn).toHaveAttribute('data-entity-id', 'scene.abendstimmung')
    expect(btn).not.toHaveAttribute('data-dashboard-placeholder')
    // the remaining scene slots stay placeholders (3 slots − 1 real)
    expect(screen.getAllByText(/Normales Licht|Cosy time|Betti Zeit/)).toHaveLength(2)
  })

  it('deselecting the scene in the picker removes it from the dashboard again', async () => {
    renderPickerHarness()

    await openEntityPicker()
    fireEvent.click(await screen.findByRole('button', { name: /Szenen/ }))
    await screen.findByRole('button', { name: /Abendstimmung/ })
    confirmDial() // select
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abendstimmung/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
    confirmDial() // deselect again (toggle semantics)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Abendstimmung/ })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))

    await waitFor(() => {
      expect(screen.queryByText('Abendstimmung')).not.toBeInTheDocument()
    })
    // post-#48 semantics: zero configured scenes → the whole scene row is
    // suppressed again, so no placeholders render either
    expect(screen.queryAllByText(/Normales Licht|Cosy time|Betti Zeit/)).toHaveLength(0)
  })

  it('a store-level toggle (no picker UI) still reaches the dashboard', async () => {
    // fast guard for the store → view → model → render chain itself
    render(
      <>
        <MainMenuView />
        <SelectionProbe />
      </>,
    )
    await waitFor(() => {
      expect(screen.queryByText('Abendstimmung')).not.toBeInTheDocument()
    })
    act(() => {
      probeToggle?.('scene.abendstimmung')
    })
    const label = await screen.findByText('Abendstimmung')
    const btn = label.closest('[data-entity-id]')
    expect(btn).not.toBeNull()
    expect(btn).toHaveAttribute('data-entity-id', 'scene.abendstimmung')
    expect(btn).not.toHaveAttribute('data-dashboard-placeholder')
  })
})
