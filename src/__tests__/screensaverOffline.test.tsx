import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { __resetSettings, updateActivePiProfileField } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'

// ticket10-7 G15 (Standalone-Guarantee-Audit, Layer 2): with a known daemon
// status (realStatus != null) the 3 s auto screensaver used to cover the
// offline screens — including the guided USB-tethering onboarding wizard,
// whose keyboard-less phases (setup-running / tether-running / setup-banner)
// the saver then covered until any input woke it. The wizard must be excluded
// from the saver's eligibility; the connection chooser (and the reconnecting
// screens) keep the pre-Epic-10 behavior — the saver covers them, any input
// wakes it.
//
// How the test reaches the offline screen: no WS ever connects here (the
// event bus is mocked, so `online` stays null) — the cold-boot fallback
// (bootStuck, 12 s without an online signal) activates the offline screen.
// The idle saver arms 3 s after the status lands, so the helper wakes it with
// key presses until just past the 12 s fallback: the offline screen appears
// with the saver closed and one 3 s arm pending, firing ~0.3 s after the
// screen appears. That pending arm is what decides the assertions below.

const busState = vi.hoisted(() => ({
  listeners: [] as Array<(evt: unknown) => void>,
  connListeners: [] as Array<(connected: boolean) => void>,
}))

vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (evt: unknown) => void) => {
    busState.listeners.push(fn)
    return () => {
      const i = busState.listeners.indexOf(fn)
      if (i >= 0) busState.listeners.splice(i, 1)
    }
  },
  subscribeConnection: (fn: (connected: boolean) => void) => {
    busState.connListeners.push(fn)
    fn(false)
    return () => {
      const i = busState.connListeners.indexOf(fn)
      if (i >= 0) busState.connListeners.splice(i, 1)
    }
  },
}))

// the screensaver renders the clock date as "<Wochentag> TT.MM.JJJJ"
const SAVED_CLOCK =
  /(Sonntag|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag) \d{2}\.\d{2}\.\d{4}/

function renderApp() {
  return render(
    <DevScreenContext.Provider value={{ forced: null, setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
  )
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// any key other than KeyM (power) wakes the screensaver
function wakeSaver() {
  fireEvent.keyDown(window, { key: 'x', code: 'KeyX' })
}

// render the real app in the live idle flow, let the status land, then cycle
// the idle saver (open -> wake) until just past the 12 s cold-boot fallback.
// Returns with the connection chooser up, the saver closed and a 3 s arm
// pending (it fires ~0.3 s after the offline screen appeared).
async function reachOfflineChooser() {
  server.use(
    http.get('*/observer/status', () =>
      HttpResponse.json({ active: false, message: 'no session' }),
    ),
    http.get('*/connect/devices', () => HttpResponse.json([])),
  )
  renderApp()
  await advance(100)
  expect(screen.getByText('Nothing playing')).toBeInTheDocument()
  for (let i = 0; i < 3; i++) {
    await advance(3100)
    expect(screen.getByText(SAVED_CLOCK)).toBeInTheDocument()
    wakeSaver()
  }
  await advance(2700)
  expect(screen.getByRole('button', { name: 'Setup USB Tethering' })).toBeInTheDocument()
}

// drive the wizard from the mounted user step through both keyboards to the
// keyboard-less setup-running phase (the audit's G15 gap: a guided-flow phase
// the saver must not cover)
async function driveWizardToSetupRunning() {
  fireEvent.click(screen.getByRole('button', { name: 'Setup USB Tethering' }))
  expect(screen.getByRole('dialog', { name: 'Setup USB Tethering' })).toBeInTheDocument()
  expect(screen.getByText('Schritt 1 von 4 · SSH-Benutzer')).toBeInTheDocument()

  updateActivePiProfileField('user', 'dietpi')
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }) // close the user keyboard
  await advance(5)
  expect(screen.getByText('Schritt 2 von 4 · SSH-Passwort')).toBeInTheDocument()

  updateActivePiProfileField('password', 'dietpi')
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }) // close -> startSetup
  await advance(5)
  expect(screen.getByText('Schritt 3 von 4 · Verbindung zum Pi')).toBeInTheDocument()
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  busState.listeners.length = 0
  busState.connListeners.length = 0
  ListFocusContext.setActive(null)
})

describe('ticket10-7 G15: auto screensaver vs. the offline screens', () => {
  it('never opens over the tethering-onboarding wizard, not even in a keyboard-less phase', async () => {
    await reachOfflineChooser()
    server.use(
      http.post('*/api/setup-pi', () =>
        HttpResponse.json({ job_id: 'job-setup' }, { status: 202 }),
      ),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'running', log_tail: ['connecting…'] }),
      ),
    )
    await driveWizardToSetupRunning()

    // well past the 3 s window (and past the arm that was pending when the
    // offline screen appeared): the saver must stay away from the wizard
    await advance(6000)
    expect(screen.queryByText(SAVED_CLOCK)).not.toBeInTheDocument()
    // and the wizard is still on its running phase (nothing woke/covered it)
    expect(screen.getByText('Schritt 3 von 4 · Verbindung zum Pi')).toBeInTheDocument()
  })

  it('keeps covering the connection chooser (pre-Epic-10 behavior)', async () => {
    await reachOfflineChooser()

    // the arm that was pending when the chooser appeared fires ~0.3 s later
    await advance(400)
    expect(screen.getByText(SAVED_CLOCK)).toBeInTheDocument()
    // the chooser itself is still underneath (the saver is an overlay)
    expect(screen.getByRole('button', { name: 'Setup USB Tethering' })).toBeInTheDocument()
  })
})
