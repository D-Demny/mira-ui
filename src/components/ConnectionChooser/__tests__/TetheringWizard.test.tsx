import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { TetheringWizard } from '../TetheringWizard'
import { SETUP_PI_POLL_MS } from '@/api/piServer'
import {
  __resetSettings,
  getSettings,
  updateActivePiProfileField,
  updateSettings,
  type PiProfile,
} from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { PiKeyboardField } from '@/components/SettingsSheet/PiKeyboardOverlay'
import { server } from '@/__tests__/msw-server'

// ticket10-6C part 2: the onboarding wizard flow of the ticket's "Flow
// Specification" — keyboard (SSH user) → keyboard (SSH password) → automatic
// POST /api/setup-pi (+ profile_id, 2 s poll on /api/setup-pi/status) → 3 s
// result banner → key/model line → automatic POST /api/pi/tethering
// (+ profile_id, 2 s poll on /api/pi/tethering/status) → final notification
// — plus the failure paths (login failed, tethering failed, old-daemon 503)
// and the profile handling (fresh install creates a profile, an existing
// key-less profile is reused).
//
// TIMING: real timers throughout (MEMORY lesson: vi.useFakeTimers() hangs the
// MSW fetches and findBy*). The wizard's only Date-based computation (the UI
// give-up cap) is driven with a Date.now spy instead of fake timers. The 3 s
// result banner is waited for in real time (~3 s of wall clock in the tests
// that reach it).
//
// KEYBOARD: the on-screen keyboard is rendered by the App (above this view),
// not by the wizard — the harness simulates the App's piKeyboardField state
// (open → closed edges via the keyboardField prop) and the user's keystrokes
// go through updateActivePiProfileField, the same store path the
// PiKeyboardOverlay uses.

function profile(
  id: string,
  keyInstalled = false,
  ip = '192.168.7.1',
  user = 'root',
  password = '',
): PiProfile {
  return { id, label: id.toUpperCase(), ip, user, password, keyInstalled }
}

interface WizardHostProps {
  onBack: () => void
  onOpenKeyboard: (field: PiKeyboardField) => void
  field: PiKeyboardField | null
}

// the wizard's props are the App's state (piKeyboardField) + callbacks —
// the harness re-renders with a changed field to simulate the App
function WizardHost({ onBack, onOpenKeyboard, field }: WizardHostProps) {
  return (
    <TetheringWizard onBack={onBack} onOpenKeyboard={onOpenKeyboard} keyboardField={field} />
  )
}

function renderWizard() {
  const onBack = vi.fn()
  const onOpenKeyboard = vi.fn()
  let field: PiKeyboardField | null = null
  const utils = render(
    <WizardHost onBack={onBack} onOpenKeyboard={onOpenKeyboard} field={field} />,
  )
  const setField = (next: PiKeyboardField | null) => {
    field = next
    utils.rerender(
      <WizardHost onBack={onBack} onOpenKeyboard={onOpenKeyboard} field={next} />,
    )
  }
  return { ...utils, onBack, onOpenKeyboard, setField }
}

type SetField = (field: PiKeyboardField | null) => void

// drive the flow from the user step through both keyboards to the automatic
// setup-pi start (the ticket: user entry → password entry → the script opens
// the SSH connection automatically)
async function driveToLogin(setField: SetField, user = 'dietpi', password = 'dietpi'): Promise<void> {
  updateActivePiProfileField('user', user)
  setField('user')
  setField(null) // open→closed edge with the entered value → advances
  await screen.findByText('Schritt 2 von 4 · SSH-Passwort')
  updateActivePiProfileField('password', password)
  setField('password')
  setField(null)
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
})

afterEach(() => {
  // no fake keyboard entry may leak into the next test's focus stack
  ListFocusContext.setActive(null)
  vi.restoreAllMocks()
})

describe('TetheringWizard: happy path, ticket flow 1→6 (ticket10-6)', () => {
  it('fresh install: creates the profile, runs the whole flow and ends with the uplink notification', async () => {
    const setupBodies: Record<string, unknown>[] = []
    const tetherBodies: Record<string, unknown>[] = []
    let tetherCalls = 0
    server.use(
      http.post('*/api/setup-pi', async ({ request }) => {
        setupBodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ job_id: 'job-setup' }, { status: 202 })
      }),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'success',
          key_installed: true,
          model: 'Pi Zero 2 W',
          tier: 'compute',
        }),
      ),
      http.post('*/api/pi/tethering', async ({ request }) => {
        tetherBodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ job_id: 'job-tether' }, { status: 202 })
      }),
      http.get('*/api/pi/tethering/status', () => {
        tetherCalls += 1
        if (tetherCalls === 1) {
          return HttpResponse.json({
            state: 'running',
            uplink: 'eth',
            tethering_ok: false,
            internet_ok: false,
            log_tail: ['detecting uplink (eth0)…'],
          })
        }
        return HttpResponse.json({
          state: 'success',
          uplink: 'eth',
          tethering_ok: true,
          internet_ok: true,
          finished_at: new Date().toISOString(),
          log_tail: ['internet ok'],
        })
      }),
    )

    // (1) fresh install: the wizard materializes the profile on mount and
    // opens the user keyboard directly (ticket: selecting the card opens it)
    const { onOpenKeyboard, setField } = renderWizard()
    expect(getSettings().piProfiles).toEqual([
      expect.objectContaining({ id: 'pi-1', user: 'root', keyInstalled: false }),
    ])
    expect(getSettings().activePiId).toBe('pi-1')
    expect(onOpenKeyboard).toHaveBeenCalledTimes(1)
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('user')
    expect(screen.getByText('Schritt 1 von 4 · SSH-Benutzer')).toBeInTheDocument()

    // (2) the user enters the SSH user → the password keyboard follows
    await driveToLogin(setField)
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('password')

    // (3)+(6a) the automatic setup-pi run carries the stored credentials +
    // id and settles within the first tick — the 'Verbinde…' running display
    // is a transient state between two renders, so the test anchors on the
    // stable 3 s success banner (ticket flow step 6)
    const bannerAt = Date.now()
    await screen.findByText('SSH-Login erfolgreich')
    expect(setupBodies).toEqual([
      { ip: '192.168.7.1', user: 'dietpi', password: 'dietpi', profile_id: 'pi-1' },
    ])
    // the key/model outcome of the finished run is stored + the profile's
    // key record is persisted (the chooser's card check reads it)
    expect(getSettings().piProfiles[0].keyInstalled).toBe(true)

    // the banner disappears again after ~3 s and the tethering step starts
    // automatically (real timer — the only way without breaking MSW)
    await waitFor(
      () => expect(screen.queryByText('SSH-Login erfolgreich')).not.toBeInTheDocument(),
      { timeout: 6000 },
    )
    expect(Date.now() - bannerAt).toBeGreaterThanOrEqual(2800)

    // (5) the tethering run: POST with the profile id, 2 s poll
    // NOTE: the second arg of findBy* is the QUERY options, the waitFor
    // options (timeout) are the THIRD arg — the default 1 s timeout would
    // never see states that only appear after the 3 s banner
    await screen.findByText('Richte USB-Tethering ein… (Uplink: Ethernet)', undefined, { timeout: 4000 })
    expect(tetherBodies).toEqual([{ profile_id: 'pi-1' }])
    // the key/model line of the tethering screen (ticket flow step 7)
    expect(screen.getByText('SSH-Key installiert · Pi Zero 2 W (Compute Mode)')).toBeInTheDocument()
    expect(screen.getByLabelText('Tethering-Log')).toHaveTextContent('detecting uplink (eth0)…')

    // (6) the final success notification incl. the uplink (Ethernet)
    await screen.findByText('Internet über USB-Tethering', undefined, { timeout: 10000 })
    expect(screen.getByText('RPi-Uplink: Ethernet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menü' })).toBeInTheDocument()
  }, 20000)
})

describe('TetheringWizard: failure paths (ticket10-6)', () => {
  it('login failed: 3 s error banner, then the failure screen; no tethering start, no half profile update, retry re-opens the user step', async () => {
    let tetherPosts = 0
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-setup' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'failed',
          error: 'Permission denied (publickey,password)',
          key_installed: false,
        }),
      ),
      http.post('*/api/pi/tethering', () => {
        tetherPosts += 1
        return HttpResponse.json({ job_id: 'job' }, { status: 202 })
      }),
    )

    const { onBack, onOpenKeyboard, setField } = renderWizard()
    await driveToLogin(setField)

    // the 3 s failure banner (ticket: "short visual notification for 3 s
    // whether it worked or not") carries the daemon's error
    await screen.findByText(/SSH-Login fehlgeschlagen — Permission denied/)
    await waitFor(
      () => expect(screen.queryByText(/SSH-Login fehlgeschlagen/)).not.toBeInTheDocument(),
      { timeout: 6000 },
    )

    // then the failure screen with the error + retry; the tethering step
    // NEVER started and the stored profile is kept exactly as written
    expect(screen.getByText('Verbindung fehlgeschlagen')).toBeInTheDocument()
    expect(screen.getByText('Permission denied (publickey,password)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(tetherPosts).toBe(0)
    const s = getSettings()
    expect(s.piProfiles).toEqual([
      expect.objectContaining({ id: 'pi-1', user: 'dietpi', password: 'dietpi', keyInstalled: false }),
    ])

    // "Erneut versuchen" restarts the flow at the user step (credentials
    // editable again) — the user keyboard opens automatically again
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(screen.getByText('Schritt 1 von 4 · SSH-Benutzer')).toBeInTheDocument()
    expect(screen.queryByText('Permission denied (publickey,password)')).not.toBeInTheDocument()
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('user')
    expect(onBack).not.toHaveBeenCalled()
  }, 12000)

  it('tethering failed (internet_ok false): final error notification with "Wiederholen", the re-run only the tethering step succeeds', async () => {
    const tetherBodies: Record<string, unknown>[] = []
    const statusSeq: Record<string, unknown>[] = [
      {
        state: 'running',
        uplink: 'eth',
        tethering_ok: false,
        internet_ok: false,
        log_tail: ['detecting uplink (eth0)…'],
      },
      {
        state: 'failed',
        error: 'exit status 1',
        uplink: 'eth',
        tethering_ok: true,
        internet_ok: false,
        log_tail: ['usb0: no internet'],
      },
      {
        state: 'success',
        uplink: 'eth',
        tethering_ok: true,
        internet_ok: true,
        log_tail: ['internet ok'],
      },
    ]
    let tetherCalls = 0
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-setup' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'success', key_installed: true }),
      ),
      http.post('*/api/pi/tethering', async ({ request }) => {
        tetherBodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ job_id: `job-${tetherCalls + 1}` }, { status: 202 })
      }),
      http.get('*/api/pi/tethering/status', () =>
        HttpResponse.json(statusSeq[Math.min(tetherCalls++, statusSeq.length - 1)]),
      ),
    )

    const { setField } = renderWizard()
    await driveToLogin(setField)
    await screen.findByText('SSH-Login erfolgreich')

    // the banner (3 s) leads to the tethering run, which FAILS the internet
    // test → the final error notification lists the machine-readable reasons
    await screen.findByText('Tethering fehlgeschlagen', undefined, { timeout: 12000 })
    expect(screen.getByText('Kein Internet über das USB-Tethering')).toBeInTheDocument()
    expect(screen.getByText('exit status 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wiederholen' })).toBeInTheDocument()
    expect(tetherBodies).toEqual([{ profile_id: 'pi-1' }])

    // "Wiederholen" re-runs ONLY the tethering step (key + profile intact) —
    // a second POST, and this time the run succeeds
    fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }))
    await screen.findByText('Richte USB-Tethering ein…')
    expect(tetherBodies).toEqual([{ profile_id: 'pi-1' }, { profile_id: 'pi-1' }])
    await screen.findByText('Internet über USB-Tethering', undefined, { timeout: 12000 })
    expect(screen.getByText('RPi-Uplink: Ethernet')).toBeInTheDocument()
  }, 25000)

  it('old daemon (503 on the tethering POST): the final screen carries the daemon message + retry', async () => {
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-setup' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'success', key_installed: true }),
      ),
      // no override for POST /api/pi/tethering → the default 503 (old daemon)
    )

    const { setField } = renderWizard()
    await driveToLogin(setField)
    await screen.findByText('SSH-Login erfolgreich')

    // the 503 lands straight on the final failure screen (no run started,
    // no poll) with the daemon's plain status message
    await screen.findByText('Tethering fehlgeschlagen', undefined, { timeout: 10000 })
    expect(screen.getByText('pi/tethering 503')).toBeInTheDocument()
    expect(screen.getByText('USB-Tethering konnte nicht eingerichtet werden')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wiederholen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menü' })).toBeInTheDocument()
  }, 12000)

  it('old daemon (503 on the setup POST): straight to the failure screen, no banner', async () => {
    // no override for POST /api/setup-pi → the default 503 (old daemon)
    const { onBack, setField } = renderWizard()
    await driveToLogin(setField)

    expect(await screen.findByText('Verbindung fehlgeschlagen')).toBeInTheDocument()
    expect(screen.getByText('setup-pi 503')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()

    // "Menü" always returns to the connection chooser
    fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  }, 8000)
})

describe('TetheringWizard: profile handling (ticket10-5/10-6)', () => {
  it('fresh install: the profile is created on mount and the POST carries its id', () => {
    const { onOpenKeyboard } = renderWizard()
    const s = getSettings()
    expect(s.piProfiles).toHaveLength(1)
    expect(s.piProfiles[0]).toMatchObject({ id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1' })
    expect(s.activePiId).toBe('pi-1')
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('user')
  })

  it('existing key-less profile: it is REUSED, no second profile is created, the POST carries its id + credentials', async () => {
    const setupBodies: Record<string, unknown>[] = []
    updateSettings({
      piProfiles: [profile('pi-2', false, '192.168.1.50', 'piuser', 'p123')],
      activePiId: 'pi-2',
    })
    server.use(
      http.post('*/api/setup-pi', async ({ request }) => {
        setupBodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ job_id: 'job-setup' }, { status: 202 })
      }),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'running', key_installed: false, log_tail: ['probing…'] }),
      ),
    )

    const { setField, unmount } = renderWizard()
    // no second profile materialized on mount
    expect(getSettings().piProfiles).toHaveLength(1)
    expect(getSettings().activePiId).toBe('pi-2')

    // the stored credentials are already there — closing both keyboards
    // starts the run with the stored ip/user/password + profile id
    setField('user')
    setField(null)
    await screen.findByText('Schritt 2 von 4 · SSH-Passwort')
    setField('password')
    setField(null)
    await screen.findByText('Verbinde…')
    expect(setupBodies).toEqual([
      { ip: '192.168.1.50', user: 'piuser', password: 'p123', profile_id: 'pi-2' },
    ])
    expect(getSettings().piProfiles).toHaveLength(1)
    unmount()
  })
})

describe('TetheringWizard: keyboard hand-off edges (ticket10-2)', () => {
  it('closing the user keyboard with an EMPTY value keeps the step with a hint', async () => {
    let setupPosts = 0
    server.use(
      http.post('*/api/setup-pi', () => {
        setupPosts += 1
        return HttpResponse.json({ job_id: 'job' }, { status: 202 })
      }),
    )
    const { setField } = renderWizard()
    // clear the default user (the keyboard's backspace path writes '' too)
    updateActivePiProfileField('user', '')
    setField('user')
    setField(null)

    await screen.findByText('Bitte zuerst den SSH-Benutzer eingeben.')
    expect(screen.getByText('Schritt 1 von 4 · SSH-Benutzer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Benutzer eingeben' })).toBeInTheDocument()
    expect(setupPosts).toBe(0)
  })

  it('closing the password keyboard with an EMPTY value keeps the step with a hint', async () => {
    let setupPosts = 0
    server.use(
      http.post('*/api/setup-pi', () => {
        setupPosts += 1
        return HttpResponse.json({ job_id: 'job' }, { status: 202 })
      }),
    )
    const { setField } = renderWizard()
    // a non-empty user advances to the password step…
    updateActivePiProfileField('user', 'dietpi')
    setField('user')
    setField(null)
    await screen.findByText('Schritt 2 von 4 · SSH-Passwort')
    // …but the password is still empty → the step is kept
    setField('password')
    setField(null)

    await screen.findByText('Bitte zuerst das SSH-Passwort eingeben.')
    expect(screen.getByText('Schritt 2 von 4 · SSH-Passwort')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Passwort eingeben' })).toBeInTheDocument()
    expect(setupPosts).toBe(0)
  })
})

describe('TetheringWizard: back hierarchy + unmount cleanup (ticket10-6C)', () => {
  it('routes Back to the open keyboard first, then to the wizard (keyboard → wizard)', () => {
    const { onBack, unmount } = renderWizard()
    // simulate the keyboard overlay pushing its own ListFocusContext entry
    // on top of the wizard's (the App renders it above the wizard)
    const keyboardBack = vi.fn(() => true)
    const popKeyboard = ListFocusContext.pushEntry({
      onWheel: () => {},
      onConfirm: null,
      onBack: keyboardBack,
      active: true,
    })

    const topBack = ListFocusContext.entry.onBack
    expect(topBack).toBeTypeOf('function')
    topBack!()
    expect(keyboardBack).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled() // the keyboard closes FIRST

    // the keyboard closed (its entry popped) → the next Back closes the
    // wizard (back to the connection chooser)
    popKeyboard()
    ListFocusContext.entry.onBack!()
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('clears the 2 s poll interval on unmount during a run (no timer leak)', async () => {
    const setSpy = vi.spyOn(window, 'setInterval')
    const clearSpy = vi.spyOn(window, 'clearInterval')
    let statusCalls = 0
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () => {
        statusCalls += 1
        return HttpResponse.json({ state: 'running', key_installed: false, log_tail: ['probing…'] })
      }),
    )
    const { setField, unmount } = renderWizard()
    await driveToLogin(setField)
    await screen.findByText('Verbinde…')
    await waitFor(() => expect(statusCalls).toBeGreaterThanOrEqual(1))

    const idx = setSpy.mock.calls.findIndex(([, ms]) => ms === SETUP_PI_POLL_MS)
    expect(idx).toBeGreaterThanOrEqual(0)
    const id = setSpy.mock.results[idx].value
    unmount()
    expect(clearSpy).toHaveBeenCalledWith(id)
    setSpy.mockRestore()
    clearSpy.mockRestore()
  }, 8000)

  it('unmount during the 3 s banner kills the banner timer (no leaked tethering start)', async () => {
    let tetherPosts = 0
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'success', key_installed: true }),
      ),
      http.post('*/api/pi/tethering', () => {
        tetherPosts += 1
        return HttpResponse.json({ job_id: 'job' }, { status: 202 })
      }),
    )
    const { setField, unmount } = renderWizard()
    await driveToLogin(setField)
    await screen.findByText('SSH-Login erfolgreich')
    unmount()

    // wait PAST the 3 s banner duration — if the timer leaked, the automatic
    // tethering start (POST) would have fired meanwhile
    await new Promise((resolve) => setTimeout(resolve, 4000))
    expect(tetherPosts).toBe(0)
  }, 12000)
})

describe('TetheringWizard: UI give-up cap (Date.now spy, no fake timers)', () => {
  it('gives up watching a setup run that outlives the 5 min UI cap', async () => {
    let statusCalls = 0
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () => {
        statusCalls += 1
        return HttpResponse.json({ state: 'running', key_installed: false, log_tail: ['probing…'] })
      }),
    )
    const { setField } = renderWizard()
    await driveToLogin(setField)
    await screen.findByText('Verbinde…')
    // the run is still "running" — fast-forward the clock 6 min (real timers
    // keep the 2 s poll rhythm, the Date.now spy moves the wall time)
    await waitFor(() => expect(statusCalls).toBeGreaterThanOrEqual(1))
    const baseTime = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => baseTime + 6 * 60 * 1000)

    // the next tick trips the cap → the failure screen (no banner)
    await screen.findByText('Setup took longer than 5 minutes — give up', undefined, { timeout: 6000 })
    expect(screen.getByText('Verbindung fehlgeschlagen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
  }, 12000)
})
