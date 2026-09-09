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
      expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
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

      // the (stale) catalog rows stay visible and selectable…
      expect(screen.getByText('Wasserpumpe')).toBeInTheDocument()
      expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
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
