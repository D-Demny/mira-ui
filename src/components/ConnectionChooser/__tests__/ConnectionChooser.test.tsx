import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { ConnectionChooser } from '../ConnectionChooser'
import { PI_STATUS_POLL_MS } from '@/api/piStatus'
import { __resetSettings, updateSettings, type PiProfile } from '@/settings'
import { server } from '@/__tests__/msw-server'

// ticket10-6C: the third card "Setup USB Tethering" + the recovery status
// panel (the onboarding card is replaced while the daemon's one-time reboot
// recovery runs). Display logic under test:
//   card    ⇔ no internet (App mount condition, implicit here)
//             AND no key for ANY profile (daemon-over-settings precedence,
//             ticket10-5C rule) AND recovery IDLE
//   panel   ⇔ recovery rebooting / waiting_after_reboot (any key state)
//   503     → the last known state is kept (never read → null = idle)

function profile(id: string, keyInstalled = false): PiProfile {
  return { id, label: id.toUpperCase(), ip: '192.168.7.1', user: 'root', password: '', keyInstalled }
}

function seedProfiles(profiles: PiProfile[]) {
  updateSettings({ piProfiles: profiles, activePiId: profiles[0]?.id ?? null })
}

function renderChooser() {
  return render(
    <ConnectionChooser
      onPickPc={vi.fn()}
      onPickBluetooth={vi.fn()}
      onPickUsbTethering={vi.fn()}
    />,
  )
}

const TETHERING_CARD = 'Setup USB Tethering'

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
})

describe('ConnectionChooser: third card (ticket10-6C)', () => {
  it('shows "Setup USB Tethering" next to the two existing cards on a fresh install (no profiles, old daemon 503)', async () => {
    renderChooser()
    expect(await screen.findByRole('button', { name: TETHERING_CARD })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect to PC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect with Bluetooth' })).toBeInTheDocument()
  })

  it('hides the card when a profile has the key (settings flag, old daemon)', () => {
    seedProfiles([profile('pi-1', true)])
    renderChooser()
    // the 503 never fills the status → the settings flag decides immediately
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect to PC' })).toBeInTheDocument()
  })

  it('hides the card when ANY profile has the key (multi-pi, settings flags)', () => {
    seedProfiles([profile('pi-1', false), profile('pi-2', true)])
    renderChooser()
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })

  it('hides the card when the DAEMON reports the key, even if the settings flag is false (daemon precedence)', async () => {
    seedProfiles([profile('pi-1', false)])
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({
          conn: 'disconnected',
          profiles: [{ id: 'pi-1', key_installed: true }],
        }),
      ),
    )
    renderChooser()
    // initially visible (status not read yet, settings flag false), then
    // removed once the daemon status lands
    expect(screen.getByRole('button', { name: TETHERING_CARD })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument(),
    )
  })

  it('shows the card when the daemon says no key, even if the settings flag is stale-true (daemon precedence)', async () => {
    let calls = 0
    seedProfiles([profile('pi-1', true)])
    server.use(
      http.get('*/api/pi/status', () => {
        calls += 1
        return HttpResponse.json({
          conn: 'disconnected',
          profiles: [{ id: 'pi-1', key_installed: false }],
        })
      }),
    )
    renderChooser()
    // initially hidden (the settings flag says a key exists); once the
    // daemon status lands — no key file on the device, the ground truth of
    // the ticket10-5C rule — the RPi is not recognized and the card returns
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1), { timeout: 2000 })
    await screen.findByRole('button', { name: TETHERING_CARD })
  })

  it('keeps the card hidden while a recovery runs and the daemon has no profile list (old shape)', async () => {
    // recovery set but the daemon predates the profiles[] shape — the key
    // check falls back to the settings flag (no key → would show the card,
    // but the recovery wins)
    seedProfiles([profile('pi-1', false)])
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'disconnected', recovery: 'rebooting' }),
      ),
    )
    renderChooser()
    const panel = await screen.findByRole('status')
    expect(panel).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })
})

describe('ConnectionChooser: recovery status panel (ticket10-6B)', () => {
  it('replaces the card with the "rebooting" status (text + age)', async () => {
    seedProfiles([profile('pi-1', false)])
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({
          conn: 'disconnected',
          recovery: 'rebooting',
          recovery_started_at: new Date(Date.now() - 45000).toISOString(),
        }),
      ),
    )
    renderChooser()
    const panel = await screen.findByRole('status')
    expect(panel).toHaveTextContent(/RPi wird neu gestartet — bitte warten…/)
    expect(panel).toHaveTextContent(/\(seit 4[456]s\)/)
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })

  it('shows the "waiting after reboot" status without an age when the timestamp is missing', async () => {
    seedProfiles([profile('pi-1', false)])
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'disconnected', recovery: 'waiting_after_reboot' }),
      ),
    )
    renderChooser()
    const panel = await screen.findByRole('status')
    expect(panel).toHaveTextContent('Warte auf RPi-Boot…')
    expect(panel).not.toHaveTextContent(/seit/)
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })

  it('shows the panel even when a key exists (the recovery wins over the card check)', async () => {
    seedProfiles([profile('pi-1', true)])
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'disconnected', recovery: 'rebooting' }),
      ),
    )
    renderChooser()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })
})

describe('ConnectionChooser: 503 behavior + polling cleanup (ticket10-6C)', () => {
  it('keeps the last known state on a 503 after a successful read (no flicker back to the card)', async () => {
    let calls = 0
    server.use(
      http.get('*/api/pi/status', () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({ conn: 'disconnected', recovery: 'rebooting' })
        }
        return new HttpResponse(null, { status: 503 })
      }),
    )
    seedProfiles([profile('pi-1', false)])
    renderChooser()
    const panel = await screen.findByRole('status')
    // wait until the 2 s rhythm delivered at least one FAILED (503) tick
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), {
      timeout: PI_STATUS_POLL_MS + 2000,
    })
    expect(panel).toHaveTextContent(/RPi wird neu gestartet/)
    expect(screen.queryByRole('button', { name: TETHERING_CARD })).not.toBeInTheDocument()
  })

  it('treats a persistent 503 as idle (never read → null → the card shows if the key check passes)', async () => {
    // default handler = 503 — the status is never read
    renderChooser()
    expect(await screen.findByRole('button', { name: TETHERING_CARD })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the 2 s status poll on unmount', () => {
    const setSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = renderChooser()
    const idx = setSpy.mock.calls.findIndex(([, ms]) => ms === PI_STATUS_POLL_MS)
    expect(idx).toBeGreaterThanOrEqual(0)
    const id = setSpy.mock.results[idx].value
    unmount()
    expect(clearSpy).toHaveBeenCalledWith(id)
    setSpy.mockRestore()
    clearSpy.mockRestore()
  })
})
