// ticket 9.4 B2: App-level wiring of the 'Home Assistant' settings row —
// confirming the row in the main menu opens the HaSettingsModal in the
// App's globalOverlays, and Back closes it again. The Pi modal has no
// dedicated full-App wiring test (noPiStandalone renders MainMenuView with
// the prop spy directly) — this smoke test covers the HA wiring end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'
import { ListFocusContext } from '@/navigation/listFocusContext'

let rootEl: HTMLDivElement
let stopSync: (() => void) | null = null

function renderApp() {
  return render(
    <DevScreenContext.Provider value={{ forced: 'mainmenu', setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
    { container: rootEl },
  )
}

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

describe('ticket 9.4 B2: Home Assistant row opens the modal (App wiring)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    clearCache()
    clearRecentCache()
    clearTracksCache()
    rootEl = document.createElement('div')
    rootEl.id = 'root'
    document.body.appendChild(rootEl)
    // main.tsx bridges the settings store onto the scale store before the
    // first render — the same recipe the other full-App tests use
    stopSync = startUiScaleSync()
    server.use(
      http.get('*/connect/devices', () => HttpResponse.json([])),
      http.get('*/web-api/me/playlists', () =>
        HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
      ),
      http.get('*/web-api/me/player/recently-played', () => HttpResponse.json({ items: [] })),
    )
  })

  afterEach(() => {
    stopSync?.()
    stopSync = null
    rootEl.remove()
  })

  it('confirming the Home Assistant row opens the HA settings modal, back closes it', async () => {
    renderApp()

    // open the 'Einstellungen' list in the main menu (the closed SettingsSheet
    // overlay carries the same 'Settings' TITLE text — the LIST ROW's
    // aria-label is what is unique)
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    const firstRow = await screen.findByLabelText('Settings')
    // the tap transferred the focus to the content pane on the first row
    expect(firstRow.className).toContain('rowFocused')

    // dial from 'Settings' (0) down to 'Home Assistant' (7) and confirm
    for (let i = 0; i < 7; i += 1) wheel(-10)
    confirmDial()

    // the modal renders in the App's globalOverlays — the unconfigured
    // base status line (no ha config seeded, so no probe is fired on open)
    expect(await screen.findByText('Nicht konfiguriert')).toBeInTheDocument()
    expect(screen.getByText('Verbindung testen')).toBeInTheDocument()

    // back closes the modal (its overlay ListFocus entry consumes the press)
    pressBack()
    expect(screen.queryByText('Verbindung testen')).not.toBeInTheDocument()
    expect(screen.queryByText('Nicht konfiguriert')).not.toBeInTheDocument()
  })
})
