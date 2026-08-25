import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext, type DevForcedScreen } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { __resetSettings } from '@/settings'

// bug40: firmware updates are flashed manually, so the "update available"
// overlay must never appear — the daemon may still report update_available /
// update_mandatory in its status, the UI has to ignore those flags. These
// tests render the real App in the live (non-forced) idle flow, where the old
// implementation armed the overlay 1.5s after the status landed.

function renderApp(forced: DevForcedScreen = null) {
  return render(
    <DevScreenContext.Provider value={{ forced, setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
  )
}

// the old implementation opened the card 1500ms after becoming eligible; the
// 3s auto-screensaver is the next timer to fire, so asserting inside that
// window proves the update card specifically never showed
const OPEN_WINDOW_MS = 2000

async function assertNoUpdateCard() {
  expect(screen.queryByRole('dialog', { name: 'Update available' })).not.toBeInTheDocument()
  expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  expect(screen.queryByText(/1\.1\.0 is out/)).not.toBeInTheDocument()
  expect(screen.queryByText('Remind me later')).not.toBeInTheDocument()
  expect(screen.queryByText('Skip this version')).not.toBeInTheDocument()
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
})

describe('bug40: "update available" popup completely disabled', () => {
  it('never opens the update card over the idle screen, even for a mandatory release', async () => {
    server.use(
      http.get('*/connect/devices', () => HttpResponse.json([])),
      http.get('*/observer/status', () =>
        HttpResponse.json({
          active: false,
          message: 'no session',
          update_available: true,
          update_mandatory: true,
          latest_version: '1.1.0',
          latest_highlights: ['Clock screensaver'],
        }),
      ),
    )

    renderApp()
    // the idle screen is up and the daemon status (with the update flags) landed
    expect(await screen.findByText('Nothing playing')).toBeInTheDocument()

    await new Promise((r) => window.setTimeout(r, OPEN_WINDOW_MS))
    await assertNoUpdateCard()
  })

  it('never opens the update card for a normal (skippable) release either', async () => {
    server.use(
      http.get('*/connect/devices', () => HttpResponse.json([])),
      http.get('*/observer/status', () =>
        HttpResponse.json({
          active: false,
          message: 'no session',
          update_available: true,
          latest_version: '1.1.0',
        }),
      ),
    )

    renderApp()
    expect(await screen.findByText('Nothing playing')).toBeInTheDocument()

    await new Promise((r) => window.setTimeout(r, OPEN_WINDOW_MS))
    await assertNoUpdateCard()
  })

  it('keeps the dev-only update-card screen for visual testing', async () => {
    // 'update-card' is only reachable through the dev-screen context, which is
    // gated on DEV_SCREENS_ENABLED (import.meta.env.DEV / VITE_DEV_SCREENS) —
    // a production build always renders with forced = null, so this path can
    // never trigger in the product flow (bug40 decision: keep it to test the
    // card's look)
    renderApp('update-card')
    expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument()
    expect(screen.getByText(/1\.1\.0 is out/)).toBeInTheDocument()
  })
})
