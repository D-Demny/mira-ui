import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HomeEntityPickerModal } from '../HomeEntityPickerModal'
import { server } from '@/__tests__/msw-server'
import { SELECTION_LS_KEY, __resetHomeEntityStores } from '@/hooks/useHomeEntities'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'
import { CATALOG_TIMEOUT_MS } from '@/api/homeassistant'
import { ListFocusContext } from '@/navigation/listFocusContext'

// ticket 9.3 (Teil 2) + issue #37: the entity picker modal — a 2-level
// sub-menu. Level 1 = one category card per catalog domain, derived
// DYNAMICALLY from GET /states (known domains first in HOME_ENTITY_DOMAINS
// priority order, unknown domains after in alphabetical order — a new domain
// gets a card without any code change). Level 2 = the entity rows of the
// selected domain (aria-pressed + localStorage persistence via the selection
// store). Dial-confirm on a card descends; dial-back restores focus on the
// originating card. The footer (Zurücksetzen/Fertig), the close button and
// the backdrop work at both levels; the 'Reihenfolge' reorder section renders
// only at level 1. Error states keep the concrete reason and the retry row
// (full screen when there is no data, non-blocking note when a refetch fails
// on top of stale data).

function renderPicker(onClose = vi.fn()) {
  return { onClose, ...render(<HomeEntityPickerModal onClose={onClose} />) }
}

function readSelection(): string[] {
  const raw = window.localStorage.getItem(SELECTION_LS_KEY)
  return raw ? (JSON.parse(raw) as string[]) : []
}

// issue #37: dial simulation (established pattern, see MainMenuView.test.tsx)
function wheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({
      deltaX,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent)
  })
}

function confirmDial() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

function pressBack() {
  act(() => {
    ListFocusContext.entry.onBack?.()
  })
}

// issue #37: the level-1 category cards (non-scoped CSS module classes)
function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.categoryCard'))
}

function cardTitles(): string[] {
  return cards().map((card) => card.querySelector('.categoryTitle')?.textContent ?? '')
}

// Mirrors the MSW default /states fixture (src/__tests__/msw-server.ts) plus
// one 'climate' entity — 'climate' is NOT in HOME_ENTITY_DOMAINS, so seeding
// it proves the category cards are derived dynamically from the catalog
// (issue #37 task 2 removed the whitelist filter)
function catalogWithClimate(): Array<{
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}> {
  const body: Array<{
    entity_id: string
    state: string
    attributes: Record<string, unknown>
  }> = []
  for (const light of HOME_LIGHTS) {
    body.push({
      entity_id: light.entityId,
      state: 'off',
      attributes: { friendly_name: light.label, supported_color_modes: ['color_temp', 'xy'] },
    })
  }
  body.push({
    entity_id: 'switch.wasserpumpe',
    state: 'off',
    attributes: { friendly_name: 'Wasserpumpe' },
  })
  body.push({
    entity_id: 'scene.abendstimmung',
    state: 'none',
    attributes: { friendly_name: 'Abendstimmung' },
  })
  body.push({
    entity_id: 'fan.wohnzimmer',
    state: 'off',
    attributes: { friendly_name: 'Lüfter Wohnzimmer' },
  })
  body.push({
    entity_id: 'media_player.wohnzimmer',
    state: 'idle',
    attributes: { friendly_name: 'TV Wohnzimmer' },
  })
  body.push({
    entity_id: 'cover.garage',
    state: 'closed',
    attributes: { friendly_name: 'Garagentor' },
  })
  body.push({
    entity_id: 'input_boolean.nachtmodus',
    state: 'off',
    attributes: { friendly_name: 'Nachtmodus' },
  })
  // was filtered out of the catalog before issue #37 — now a regular domain
  body.push({
    entity_id: 'sensor.temperatur_wohnzimmer',
    state: '21.5',
    attributes: { friendly_name: 'Temperatur Wohnzimmer' },
  })
  // NEW domain, not in the old whitelist — no code change needed for it to
  // appear as a level-1 card
  body.push({
    entity_id: 'climate.wohnzimmer',
    state: 'heat',
    attributes: { friendly_name: 'Klimaanlage Wohnzimmer' },
  })
  return body
}

function seedClimateCatalog() {
  server.use(http.get('*/ha-api/states', () => HttpResponse.json(catalogWithClimate())))
}

describe('HomeEntityPickerModal (ticket 9.3 + issue #37)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetHomeEntityStores()
  })

  afterEach(() => {
    __resetHomeEntityStores()
    ListFocusContext.setActive(null)
  })

  it('level 1 renders one category card per catalog domain — known first, new domains after', async () => {
    seedClimateCatalog()
    renderPicker()

    await screen.findByText('Lichter')

    // one card per domain in the catalog: the 7 known ones + 'climate' (new)
    // + 'sensor' (no longer filtered out)
    expect(cards()).toHaveLength(9)
    // known domains in HOME_ENTITY_DOMAINS priority order, unknowns after —
    // alphabetical by domain ('climate' < 'sensor')
    expect(cardTitles()).toEqual([
      'Lichter',
      'Schalter',
      'Lüfter',
      'Szenen',
      'Rollläden',
      'Boolesche Werte',
      'Mediaplayer',
      'Climate',
      'Sensor',
    ])
    // a card shows the domainLabel, the entity count and (for the default
    // selection) the selected-count badge
    const lightCard = cards()[0]
    expect(lightCard.textContent).toContain('9 Entitäten')
    expect(lightCard.textContent).toContain('· 9 ausgewählt')
    const climateCard = cards()[7]
    expect(climateCard.textContent).toContain('1 Entität')
    // 'sensor' is no longer filtered out — it gets a card like any other domain
    expect(cards()[8].textContent).toContain('Sensor')
  })

  it('a new domain in the catalog gets a working card without a code change', async () => {
    seedClimateCatalog()
    renderPicker()

    await screen.findByText('Lichter')

    // dial to the 'Climate' card (index 7: the 8 known/earlier domains first)
    for (let i = 0; i < 7; i += 1) wheel(-1)
    confirmDial()

    await screen.findByText('Klimaanlage Wohnzimmer')
    expect(screen.getByText('Climate')).toBeInTheDocument()
    // level 2 shows the single entity row of the new domain only
    const rows = Array.from(document.querySelectorAll('.section .row'))
    expect(rows).toHaveLength(1)
  })

  it('shows the selection count in the header (default = the 9 lights)', async () => {
    renderPicker()

    await screen.findByText('9 ausgewählt')
  })

  it("dial-confirm on a card descends to level 2 — only that domain's rows render", async () => {
    renderPicker()

    await screen.findByText('Lichter')

    // focus starts on the first card ('Lichter'); one dial tick over to
    // 'Schalter', then confirm
    wheel(-1)
    confirmDial()

    await screen.findByText('Wasserpumpe')

    // level 2: the domain's section header and its rows…
    expect(screen.getByText('Schalter')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Wasserpumpe/ })
    expect(row).toHaveAttribute('aria-pressed', 'false')
    // …and nothing else: no level-1 cards, no reorder section (level 1 only),
    // no rows of other domains
    expect(cards()).toHaveLength(0)
    expect(screen.queryByText('Reihenfolge')).not.toBeInTheDocument()
    expect(screen.queryByText('Abendstimmung')).not.toBeInTheDocument()
    expect(screen.queryByText('3er Stehlampe Gold')).not.toBeInTheDocument()
    const domainRows = Array.from(document.querySelectorAll('.section .row'))
    expect(domainRows).toHaveLength(1)
  })

  it('dial-back at level 2 restores focus on the originating card', async () => {
    renderPicker()

    await screen.findByText('Lichter')

    // descend into 'Schalter' (the second card)…
    wheel(-1)
    confirmDial()
    await screen.findByText('Wasserpumpe')
    // …descending focuses the domain's first row (the parked focus is applied
    // after the re-render)
    expect(screen.getByRole('button', { name: /Wasserpumpe/ })).toHaveAttribute('tabIndex', '0')

    pressBack()

    // level-1 cards are back…
    expect(cards()).toHaveLength(8)
    // …and the focus is on the card we descended from ('Schalter', index 1)
    const schalterCard = screen.getByRole('button', { name: /Schalter/ })
    expect(schalterCard).toHaveAttribute('tabIndex', '0')
    for (const card of cards()) {
      if (card !== schalterCard) expect(card).toHaveAttribute('tabIndex', '-1')
    }
  })

  it('toggles a row at level 2: aria-pressed flips, the count grows, the id lands in localStorage', async () => {
    renderPicker()

    await screen.findByText('Lichter')
    wheel(-1)
    confirmDial()

    const row = await screen.findByRole('button', { name: /Wasserpumpe/ })
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

  it('keeps the reset button disabled at level 2 while the selection is the default', async () => {
    renderPicker()

    await screen.findByText('Lichter')
    wheel(-1)
    confirmDial()
    await screen.findByText('Wasserpumpe')

    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled()
  })

  it('at level 2 a non-default selection enables reset (resets + closes) — and Fertig closes', async () => {
    const onClose = vi.fn()
    renderPicker(onClose)

    await screen.findByText('Lichter')
    wheel(-1)
    confirmDial()

    fireEvent.click(await screen.findByRole('button', { name: /Wasserpumpe/ }))
    await screen.findByText('10 ausgewählt')

    const resetBtn = screen.getByRole('button', { name: 'Zurücksetzen' })
    expect(resetBtn).toBeEnabled()
    fireEvent.click(resetBtn)

    await screen.findByText('9 ausgewählt')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(readSelection()).toEqual(HOME_LIGHTS.map((light) => light.entityId))

    // Fertig works at level 2 too
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('the close button and the backdrop close the modal', async () => {
    const onClose = vi.fn()
    const first = renderPicker(onClose)
    await screen.findByText('Lichter')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()

    const onClose2 = vi.fn()
    const second = renderPicker(onClose2)
    await screen.findByText('Lichter')
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
    // the (failed) catalog must not render any category cards
    expect(cards()).toHaveLength(0)

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
    await screen.findByText('Keine Entitäten gefunden')
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
    await screen.findByText('Keine Entitäten gefunden')
  })

  it('a retry reloads the catalog and re-renders the level-1 category cards', async () => {
    server.use(
      http.get('*/ha-api/states', () => HttpResponse.json({ error: 'down' }, { status: 502 })),
    )
    renderPicker()

    await screen.findByText('home assistant 502')
    expect(cards()).toHaveLength(0)

    // the endpoint heals → retry fetches fresh… (seedClimateCatalog swaps the
    // MSW handler, so the error-state → catalog transition below proves the
    // retry issued a NEW request — a cached rejected promise would persist)
    seedClimateCatalog()
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))

    // …and level 1 re-renders its category cards — including the new domain.
    await screen.findByText('Lichter')
    expect(cards()).toHaveLength(9)
    expect(cardTitles()).toContain('Climate')
  })

  // ticket 9.5: the 'Reihenfolge' section — the selection order IS the Home
  // carousel order; per row a ▲/▼ move button (flat focus chain, boundary
  // clamped moves stay disabled) and immediate persistence of each swap.
  // issue #37: the section renders at level 1 only.
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
  // non-blocking error note — no blank screen, no full error screen. issue
  // #37: a fresh open always starts at level 1, so after the reload the
  // category cards re-render.
  it('keeps the loaded catalog visible with an error note when a refetch fails — a reopen returns to level 1', async () => {
    const realNow = Date.now
    let fakeNow = realNow()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const first = renderPicker()
      await screen.findByText('Lichter')

      // open the switch domain (level 2), then close again
      wheel(-1)
      confirmDial()
      await screen.findByText('Wasserpumpe')
      first.unmount()

      // beyond the 60 s catalog TTL, a remount re-fetches — and that
      // refetch fails
      fakeNow += 61_000
      server.use(
        http.get('*/ha-api/states', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      )
      renderPicker()

      // the (stale) catalog stays visible — and a fresh open starts at level
      // 1, so the category cards + the 'Reihenfolge' section re-render…
      expect(screen.getByText('Lichter')).toBeInTheDocument()
      expect(cards()).toHaveLength(8)
      expect(screen.getByText('Reihenfolge')).toBeInTheDocument()
      const orderRows = Array.from(document.querySelectorAll('.orderRow'))
      expect(orderRows).toHaveLength(9)
      // …with a non-blocking error note carrying the concrete reason
      await screen.findByText(/home assistant 500/)
      // and the full error screen (with its retry row) does NOT replace it —
      // with stale data the picker stays usable, no error screen
      expect(screen.queryByRole('button', { name: /Erneut versuchen/ })).not.toBeInTheDocument()
    } finally {
      nowSpy.mockRestore()
      warn.mockRestore()
    }
  })

  it('an empty catalog shows the plain empty-state text', async () => {
    server.use(http.get('*/ha-api/states', () => HttpResponse.json([])))
    renderPicker()

    await screen.findByText('Keine Entitäten gefunden')
    expect(cards()).toHaveLength(0)
    // the footer stays rendered (reset disabled for the default selection)
    expect(screen.getByRole('button', { name: 'Zurücksetzen' })).toBeDisabled()
  })
})
