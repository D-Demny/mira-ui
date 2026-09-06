import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HomeEntityPickerModal } from '../HomeEntityPickerModal'
import { server } from '@/__tests__/msw-server'
import { SELECTION_LS_KEY, __resetHomeEntityStores } from '@/hooks/useHomeEntities'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'
import { ListFocusContext } from '@/navigation/listFocusContext'

// ticket 9.3 (Teil 2): the entity picker modal — grouped catalog rows from
// the MSW /states fixture, per-row selection (aria-pressed + localStorage),
// counter header, reset/done footer, error state with retry row

function renderPicker(onClose = vi.fn()) {
  return { onClose, ...render(<HomeEntityPickerModal onClose={onClose} />) }
}

function readSelection(): string[] {
  const raw = window.localStorage.getItem(SELECTION_LS_KEY)
  return raw ? (JSON.parse(raw) as string[]) : []
}

describe('HomeEntityPickerModal (ticket 9.3)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetHomeEntityStores()
  })

  afterEach(() => {
    __resetHomeEntityStores()
    ListFocusContext.setActive(null)
  })

  it('renders the domain groups and the catalog rows (sensor filtered out)', async () => {
    renderPicker()

    await screen.findByText('Wasserpumpe')

    for (const section of [
      'Lichter',
      'Schalter',
      'Lüfter',
      'Szenen',
      'Rollläden',
      'Boolesche Werte',
      'Mediaplayer',
    ]) {
      expect(screen.getByText(section)).toBeInTheDocument()
    }
    for (const light of HOME_LIGHTS) {
      expect(screen.getByText(light.label)).toBeInTheDocument()
    }
    expect(screen.getByText('Abendstimmung')).toBeInTheDocument()
    expect(screen.getByText('Lüfter Wohnzimmer')).toBeInTheDocument()
    expect(screen.getByText('TV Wohnzimmer')).toBeInTheDocument()
    expect(screen.getByText('Garagentor')).toBeInTheDocument()
    expect(screen.getByText('Nachtmodus')).toBeInTheDocument()
    // the catalog fixture's sensor must NOT appear (not a controllable domain)
    expect(screen.queryByText('Temperatur Wohnzimmer')).not.toBeInTheDocument()
  })

  it('shows the selection count in the header (default = the 9 lights)', async () => {
    renderPicker()

    await screen.findByText('9 ausgewählt')
  })

  it('toggles a row: aria-pressed flips, the count grows, the id lands in localStorage', async () => {
    renderPicker()

    await screen.findByText('Wasserpumpe')
    const row = screen.getByRole('button', { name: /Wasserpumpe/ })
    expect(row).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(row)

    await screen.findByText('10 ausgewählt')
    expect(screen.getByRole('button', { name: /Wasserpumpe/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(readSelection()).toContain('switch.wasserpumpe')
    // toggling the same row back removes it again
    fireEvent.click(screen.getByRole('button', { name: /Wasserpumpe/ }))
    await screen.findByText('9 ausgewählt')
    expect(readSelection()).not.toContain('switch.wasserpumpe')
  })

  it('keeps the reset button disabled while the selection is the default', async () => {
    renderPicker()

    await screen.findByText('Wasserpumpe')
    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled()
  })

  it('after a toggle the reset button is enabled and resets the selection and closes', async () => {
    const onClose = vi.fn()
    renderPicker(onClose)

    await screen.findByText('Wasserpumpe')
    fireEvent.click(screen.getByRole('button', { name: /Wasserpumpe/ }))
    await screen.findByText('10 ausgewählt')

    const resetBtn = screen.getByRole('button', { name: 'Zurücksetzen' })
    expect(resetBtn).toBeEnabled()
    fireEvent.click(resetBtn)

    await screen.findByText('9 ausgewählt')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(readSelection()).toEqual(HOME_LIGHTS.map((light) => light.entityId))
  })

  it('closes on Fertig', async () => {
    const onClose = vi.fn()
    renderPicker(onClose)

    await screen.findByText('Wasserpumpe')
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the close button and the backdrop close the modal', async () => {
    const onClose = vi.fn()
    const first = renderPicker(onClose)
    await screen.findByText('Wasserpumpe')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()

    const onClose2 = vi.fn()
    const second = renderPicker(onClose2)
    await screen.findByText('Wasserpumpe')
    fireEvent.click(screen.getByRole('dialog')) // the card swallows its own clicks
    expect(onClose2).not.toHaveBeenCalled()
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose2).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  it('shows the error state with a retry row when the catalog fetch fails', async () => {
    server.use(http.get('*/ha-api/states', () => HttpResponse.error()))
    renderPicker()

    await screen.findByText('Home Assistant nicht erreichbar')
    expect(screen.getByRole('button', { name: /Erneut versuchen/ })).toBeInTheDocument()
    // the (failed) catalog must not render any rows
    expect(screen.queryByText('Wasserpumpe')).not.toBeInTheDocument()
    expect(screen.queryByText('Zurücksetzen')).toBeDefined()
    // retry: flip the mock to a healthy catalog and confirm the row
    server.use(http.get('*/ha-api/states', () => HttpResponse.json({})))
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    await waitFor(() =>
      expect(screen.getByText('Keine steuerbaren Entitäten gefunden')).toBeInTheDocument(),
    )
  })
})
