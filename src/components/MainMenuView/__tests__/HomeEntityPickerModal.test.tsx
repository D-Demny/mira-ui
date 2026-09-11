import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HomeEntityPickerModal } from '../HomeEntityPickerModal'
import { server } from '@/__tests__/msw-server'
import { SELECTION_LS_KEY, __resetHomeEntityStores } from '@/hooks/useHomeEntities'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'
import { CATALOG_TIMEOUT_MS } from '@/api/homeassistant'
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
    // ticket 9.5: each default-selected light appears TWICE — once as a
    // catalog row, once in the 'Reihenfolge' section
    for (const light of HOME_LIGHTS) {
      expect(screen.getAllByText(light.label)).toHaveLength(2)
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
    // ticket 9.5: the selected entity ALSO appears in the 'Reihenfolge'
    // section (with its move buttons), so scope the row query to the catalog
    // group instead of a bare name match
    const schalterSection = screen.getByText('Schalter').closest('.section') as HTMLElement
    const catalogRow = schalterSection.querySelector('[role="button"]') as HTMLElement
    expect(catalogRow).toHaveAttribute('aria-pressed', 'true')
    expect(readSelection()).toContain('switch.wasserpumpe')
    // toggling the same row back removes it again (and clears its reorder row)
    fireEvent.click(catalogRow)
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

  it('shows the concrete error reason and retries with fresh requests until healthy', async () => {
    // bug53: the error screen carries the CONCRETE reason (here: the daemon
    // proxy's 502), not only the generic label
    let calls = 0
    server.use(
      http.get('*/ha-api/states', () => {
        calls += 1
        return HttpResponse.json({ error: 'home assistant unreachable' }, { status: 502 })
      }),
    )
    renderPicker()

    await screen.findByText('Home Assistant nicht erreichbar')
    expect(screen.getByText('home assistant 502')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Erneut versuchen/ })).toBeInTheDocument()
    // the (failed) catalog must not render any rows
    expect(screen.queryByText('Wasserpumpe')).not.toBeInTheDocument()
    expect(screen.queryByText('Zurücksetzen')).toBeDefined()

    // retry while the endpoint is STILL failing: a fresh request is issued
    // (no reused rejected promise) and the error state persists
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    await waitFor(() => expect(calls).toBe(2))
    await waitFor(() => expect(screen.getByText('home assistant 502')).toBeInTheDocument())

    // the endpoint heals → the next retry loads the catalog (bug55: the real
    // HA contract is an array — [] = valid empty catalog, {} would be a
    // contract violation)
    server.use(http.get('*/ha-api/states', () => HttpResponse.json([])))
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    await waitFor(() =>
      expect(screen.getByText('Keine steuerbaren Entitäten gefunden')).toBeInTheDocument(),
    )
  })

  // bug53: a timed-out catalog (the device's dominant failure mode — the
  // full /states dump is slow) shows 'home assistant timeout' as the
  // concrete reason. FULL fake timers + the never-resolving MSW handler
  // (established pattern: MSW ignores AbortSignal). Under fake timers no
  // findBy*/waitFor — only synchronous getBy* after the timer advance (the
  // advance is wrapped in act so the store update commits); the healthy
  // recovery at the end switches back to real timers.
  it('shows the concrete timeout reason and retries with a fresh request', async () => {
    let calls = 0
    vi.useFakeTimers()
    server.use(
      http.get('*/ha-api/states', () => {
        calls += 1
        return new Promise<HttpResponse<undefined>>(() => {})
      }),
    )
    renderPicker()
    // bug57 v2: wrapped in act like the second advance below — with polling
    // decoupled from subscription no interval fires during the fake-clock
    // advance, so only the act flush commits the timeout state update
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS)
    })

    expect(calls).toBe(1)
    expect(screen.getByText('Home Assistant nicht erreichbar')).toBeInTheDocument()
    expect(screen.getByText('home assistant timeout')).toBeInTheDocument()

    // retry while the endpoint still hangs: the loading state shows
    // immediately…
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    expect(screen.getByText('Lade…')).toBeInTheDocument()
    // …and when the second attempt ALSO times out the error screen persists
    // with the same concrete reason — the request count proves the retry
    // issued a FRESH request (no reused rejected promise)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS)
    })
    expect(calls).toBe(2)
    expect(screen.getByText('Home Assistant nicht erreichbar')).toBeInTheDocument()
    expect(screen.getByText('home assistant timeout')).toBeInTheDocument()

    // the endpoint heals → the next retry loads the catalog (real timers from
    // here — the immediate MSW answer settles on microtasks, not on the fake
    // clock, and findBy* would hang under fake timers anyway)
    vi.useRealTimers()
    // bug55: [] = valid (empty) HA array contract
    server.use(http.get('*/ha-api/states', () => HttpResponse.json([])))
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    await screen.findByText('Keine steuerbaren Entitäten gefunden')
  })

  // ticket 9.5: the 'Reihenfolge' section — the selection order IS the Home
  // carousel order; per row a ▲/▼ move button (flat focus chain, boundary
  // clamped moves stay disabled) and immediate persistence of each swap
  describe('reorder section (ticket 9.5)', () => {
    it('renders a numbered row per selected entity with the boundary buttons disabled', async () => {
      renderPicker()
      await screen.findByText('Reihenfolge')

      const section = screen.getByText('Reihenfolge').closest('.section') as HTMLElement
      const orderRows = Array.from(section.querySelectorAll('.orderRow'))
      expect(orderRows).toHaveLength(9)
      // the numbering follows the selection (default = HOME_LIGHTS order)
      expect(orderRows[0].textContent).toContain('3er Stehlampe Gold')
      expect(orderRows[8].textContent).toContain('Treppenspot Tür')
      // the first row cannot move up, the last cannot move down…
      const firstUp = orderRows[0].querySelector(
        'button[aria-label="3er Stehlampe Gold nach oben verschieben"]',
      ) as HTMLButtonElement
      expect(firstUp).toBeDisabled()
      const lastDown = orderRows[8].querySelector(
        'button[aria-label="Treppenspot Tür nach unten verschieben"]',
      ) as HTMLButtonElement
      expect(lastDown).toBeDisabled()
      // …but the inner moves are enabled
      const secondUp = orderRows[1].querySelector(
        'button[aria-label="Esstisch Hängelampe nach oben verschieben"]',
      ) as HTMLButtonElement
      expect(secondUp).toBeEnabled()
    })

    it('moves a row up: the stored order swaps and the section re-renders', async () => {
      renderPicker()
      await screen.findByText('Reihenfolge')

      fireEvent.click(
        screen.getByRole('button', { name: 'Esstisch Hängelampe nach oben verschieben' }),
      )

      // the swap is persisted immediately (the selection array is the source
      // of truth for the carousel order)…
      expect(readSelection()[0]).toBe('light.esstisch_hangelampe_3er')
      expect(readSelection()[1]).toBe('light.3er_stehlampe_gold_esszimmer')
      expect(readSelection().length).toBe(9)
      // …and the numbered rows follow the new order
      const section = screen.getByText('Reihenfolge').closest('.section') as HTMLElement
      const orderRows = Array.from(section.querySelectorAll('.orderRow'))
      expect(orderRows[0].textContent).toContain('Esstisch Hängelampe')
      expect(orderRows[1].textContent).toContain('3er Stehlampe Gold')
    })

    it('moves a row down the same way', async () => {
      renderPicker()
      await screen.findByText('Reihenfolge')

      fireEvent.click(
        screen.getByRole('button', { name: '3er Stehlampe Gold nach unten verschieben' }),
      )

      expect(readSelection()[0]).toBe('light.esstisch_hangelampe_3er')
      expect(readSelection()[1]).toBe('light.3er_stehlampe_gold_esszimmer')
    })

    it('a disabled boundary button is a no-op', async () => {
      renderPicker()
      await screen.findByText('Reihenfolge')

      const firstUp = screen.getByRole('button', {
        name: '3er Stehlampe Gold nach oben verschieben',
      }) as HTMLButtonElement
      expect(firstUp).toBeDisabled()
      fireEvent.click(firstUp)

      // the default order is untouched (the click handler guards !enabled,
      // even though a disabled button cannot fire in a real browser) — the
      // first reorder row is still the selection's first entry…
      const section = screen.getByText('Reihenfolge').closest('.section') as HTMLElement
      const firstRow = section.querySelector('.orderRow') as HTMLElement
      expect(firstRow.textContent).toContain('3er Stehlampe Gold')
      // …and nothing was persisted (the default selection has no LS entry yet)
      expect(readSelection()).toEqual([])
    })

    it('hides the section when only one entity is selected', async () => {
      window.localStorage.setItem(
        SELECTION_LS_KEY,
        JSON.stringify(['light.3er_stehlampe_gold_esszimmer']),
      )
      renderPicker()

      await screen.findByText('1 ausgewählt')
      expect(screen.queryByText('Reihenfolge')).not.toBeInTheDocument()
    })
  })

  // bug53 (stale data retention): a failed TTL-expired refetch on top of an
  // already-loaded catalog keeps the list visible (selection usable) with a
  // non-blocking error note — no blank screen, no error screen
  it('keeps the loaded catalog visible with an error note when a refetch fails', async () => {
    const realNow = Date.now
    let fakeNow = realNow()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const first = renderPicker()
      await screen.findByText('Wasserpumpe')
      // ticket 9.5: the default-selected light is listed twice (catalog row +
      // 'Reihenfolge' row)
      expect(screen.getAllByText('3er Stehlampe Gold')).toHaveLength(2)
      first.unmount()

      // beyond the 60 s catalog TTL, a remount re-fetches — and that
      // refetch fails
      fakeNow += 61_000
      server.use(
        http.get('*/ha-api/states', () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      )
      renderPicker()

      // the (stale) catalog rows stay visible and selectable… (the selected
      // light is listed twice: catalog row + 'Reihenfolge' row)
      expect(screen.getByText('Wasserpumpe')).toBeInTheDocument()
      expect(screen.getAllByText('3er Stehlampe Gold')).toHaveLength(2)
      // …with a non-blocking error note carrying the concrete reason
      await screen.findByText(/home assistant 500/)
      // and the full error screen (with its retry row) does NOT replace it
      expect(screen.queryByRole('button', { name: /Erneut versuchen/ })).not.toBeInTheDocument()
    } finally {
      nowSpy.mockRestore()
      warn.mockRestore()
    }
  })
})
