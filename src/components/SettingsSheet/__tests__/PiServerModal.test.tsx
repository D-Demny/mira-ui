import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { PiServerModal } from '../PiServerModal'
import { __resetMiraServerState, checkMiraServer, getMiraServerState } from '@/hooks/useMiraServer'
import type { MiraServerCapabilities } from '@/api/miraServer'
import {
  PI_SERVER_DEFAULT_IP,
  __resetSettings,
  activePiProfile,
  getSettings,
  updateSettings,
} from '@/settings'
import { SETUP_PI_POLL_MS, SETUP_PI_UI_CAP_MS } from '@/api/piServer'
import { server } from '@/__tests__/msw-server'

const COMPUTE: MiraServerCapabilities = {
  tier: 'compute',
  disk_cache: true,
  remote_colors: true,
  remote_blur: true,
}

const CACHE: MiraServerCapabilities = {
  tier: 'cache',
  disk_cache: true,
  remote_colors: false,
  remote_blur: false,
}

// ticket10-5A: seed an active profile so the mount-time capabilities check
// (useMiraServer subscription) has a target (fresh installs have none and
// stay standalone without polling)
function setProfile(ip = '192.168.7.1') {
  updateSettings({
    piProfiles: [
      { id: 'pi-1', label: 'Pi 1', ip, user: 'root', password: '', keyInstalled: false },
    ],
    activePiId: 'pi-1',
  })
}

// the mount-time capabilities check (useMiraServer subscription) must settle
// before a manual re-check, otherwise the re-check joins it (default handler
// = standalone) and the test would assert the wrong request. The mount check
// targets the active profile's ip (or the shown default while none exists)
async function settleMountCheck() {
  const ip = activePiProfile(getSettings())?.ip ?? PI_SERVER_DEFAULT_IP
  await act(async () => {
    await checkMiraServer(ip)
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  __resetMiraServerState()
})

describe('PiServerModal: status line', () => {
  it('shows the standalone status and the default credentials', async () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    expect(await screen.findByText('Getrennt (Standalone)')).toBeInTheDocument()
    // the default ip / user are pre-filled from the settings store
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveValue('192.168.7.1')
    expect(screen.getByRole('textbox', { name: 'SSH Benutzer' })).toHaveValue('root')
    // the password is masked (no textbox role in jsdom — query by label)
    const password = screen.getByLabelText('SSH Passwort')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveValue('')
  })

  it('shows the compute status line once the Pi reports compute capabilities', async () => {
    setProfile()
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Verbunden (Compute Mode)')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('compute')
  })

  it('shows the lightweight (cache only) status line', async () => {
    setProfile()
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(CACHE)))
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Connected (Cache Only)')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('lightweight')
  })

  it('includes the detected model from the setup status in the status line', async () => {
    setProfile()
    server.use(
      http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'idle', model: 'Pi Zero 2 W', tier: 'compute' }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('Verbunden (Pi Zero 2 W - Compute Mode)')).toBeInTheDocument(),
    )
  })
})

describe('PiServerModal: SSH key status line (ticket10-3)', () => {
  it('shows "SSH-Key installiert" when the daemon reports the key installed', async () => {
    server.use(
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'idle', key_installed: true }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('SSH-Key installiert')
  })

  it('shows "Passwort-Login erforderlich" when the key is not installed', async () => {
    server.use(
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'idle', key_installed: false }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('Passwort-Login erforderlich')
  })

  it('shows the key error message — the error line wins over the installed flag', async () => {
    server.use(
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'idle',
          key_installed: true,
          key_error: 'ssh: append to authorized_keys failed',
        }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('Key-Setup fehlgeschlagen: ssh: append to authorized_keys failed')
    expect(screen.queryByText('SSH-Key installiert')).not.toBeInTheDocument()
  })

  it('treats MISSING key fields (key_installed/key_error) as no error, not as a failure', async () => {
    // the default MSW handler answers { state: 'idle' } with neither key
    // field — the line must show the plain password-required text, no error
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('Passwort-Login erforderlich')
    expect(screen.queryByText(/Key-Setup fehlgeschlagen/)).not.toBeInTheDocument()
  })
})

describe('PiServerModal: live session status line (ticket10-4)', () => {
  it('shows "Verbunden" with the model and tier while connected', async () => {
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'connected', model: 'Pi 4 Model B', tier: 'compute' }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    // the mode line stays "Getrennt (Standalone)" (default capabilities
    // handler is offline) — the exact match picks the session line out
    await screen.findByText('Verbunden (Pi 4 Model B - Compute Mode)')
  })

  it('shows "Verbinde… (letzter Versuch vor Xs)" from the last_attempt_at age', async () => {
    // Date.now spy instead of fake timers: MSW + fake timers + the manual
    // AbortController timeout is the known hang trap (MEMORY lesson)
    const BASE = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE)
    try {
      server.use(
        http.get('*/api/pi/status', () =>
          HttpResponse.json({
            conn: 'connecting',
            last_attempt_at: new Date(BASE - 45_000).toISOString(),
          }),
        ),
      )
      render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
      await screen.findByText('Verbinde… (letzter Versuch vor 45s)')
      // the age tracks the clock — the next 2 s tick re-renders with a
      // fresh Date.now (waitForOptions are the 3rd arg in this
      // testing-library version; the 2nd arg is the query options)
      nowSpy.mockReturnValue(BASE + 20_000)
      await screen.findByText('Verbinde… (letzter Versuch vor 65s)', undefined, {
        timeout: 4000,
      })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('shows "Verbinde…" without an age when last_attempt_at is missing', async () => {
    server.use(http.get('*/api/pi/status', () => HttpResponse.json({ conn: 'connecting' })))
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('Verbinde…')
  })

  it('shows "Getrennt" when the session is disconnected', async () => {
    server.use(http.get('*/api/pi/status', () => HttpResponse.json({ conn: 'disconnected' })))
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    // the mode line is "Getrennt (Standalone)" — the exact text match picks
    // out the session line
    await screen.findByText('Getrennt')
  })

  it('keeps the last known model and tier after the connection drops (cache)', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'connected', model: 'Pi 4 Model B', tier: 'compute' }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    // the mount-time read settles over the 0-drains (MSW macrotask hops)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Verbunden (Pi 4 Model B - Compute Mode)')).toBeInTheDocument()
    // the Pi drops — the next rhythm tick sees disconnected WITHOUT
    // model/tier: the remembered "letzter guter Zustand" must carry over
    server.use(http.get('*/api/pi/status', () => HttpResponse.json({ conn: 'disconnected' })))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETUP_PI_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Getrennt (Pi 4 Model B - Compute Mode)')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('hides the line entirely on an old daemon (503 = default handler)', async () => {
    // no server.use for /api/pi/status — the default handler answers 503
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await screen.findByText('Getrennt (Standalone)')
    expect(screen.queryByText('Getrennt')).not.toBeInTheDocument()
    expect(screen.queryByText('Verbunden')).not.toBeInTheDocument()
    expect(screen.queryByText(/Verbinde…/)).not.toBeInTheDocument()
  })
})

describe('PiServerModal: Verbindung testen', () => {
  it('pings the ENTERED ip and reports success', async () => {
    // settle the mount check (default handler: offline), then make only the
    // custom ip answer — proves the test used the input value, not the default
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await settleMountCheck()
    expect(getMiraServerState().mode).toBe('standalone')
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const host = new URL(request.url).hostname
        return host === '10.9.8.7' ? HttpResponse.json(COMPUTE) : HttpResponse.error()
      }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.9.8.7' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await waitFor(() => expect(screen.getByText('Test: Verbunden (Compute Mode)')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('compute')
  })

  it('pings the default ip when the input is untouched and reports failure when offline', async () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await settleMountCheck()
    // no custom handler: the default (default ip) stays offline
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await waitFor(() => expect(screen.getByText('Test: Getrennt')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('standalone')
  })
})

describe('PiServerModal: persistent credentials', () => {
  it('persists ip / user / password in the settings store (localStorage)', async () => {
    // ticket10-5A: the first keystroke lazily creates profile 1 (no profile
    // on a fresh install) — the values persist with the profile
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.0.0.9' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SSH Benutzer' }), {
      target: { value: 'dietpi' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'hunter2' },
    })
    const expected = [
      { id: 'pi-1', label: 'Pi 1', ip: '10.0.0.9', user: 'dietpi', password: 'hunter2', keyInstalled: false },
    ]
    await waitFor(() => expect(getSettings().piProfiles).toEqual(expected))
    expect(getSettings().activePiId).toBe('pi-1')
    // the store writes through to the settings blob in localStorage
    const stored = JSON.parse(localStorage.getItem('mira.settings.v1') ?? '{}') as {
      piProfiles?: unknown
      activePiId?: string | null
      piServer?: unknown
    }
    expect(stored.piProfiles).toEqual(expected)
    expect(stored.activePiId).toBe('pi-1')
    // the legacy flat key is gone after the first profile write
    expect(stored.piServer).toBeUndefined()
  })

  it('restores the persisted credentials on a fresh mount (simulated reload)', async () => {
    const { unmount } = render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.0.0.9' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'secret' },
    })
    await waitFor(() =>
      expect(getSettings().piProfiles).toEqual([
        { id: 'pi-1', label: 'Pi 1', ip: '10.0.0.9', user: 'root', password: 'secret', keyInstalled: false },
      ]),
    )
    unmount()
    // a reload re-reads the blob from localStorage
    __resetSettings()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveValue('10.0.0.9')
    expect(screen.getByLabelText('SSH Passwort')).toHaveValue('secret')
  })
})

describe('PiServerModal: Pi automatisch einrichten', () => {
  it('starts the daemon job (202) and polls to success with model + tier', async () => {
    vi.useFakeTimers()
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-1' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'running', log_tail: ['ssh: connected', 'installing...'] }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // the mount-time status probe settled (running) — start the wizard
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    // one drain settles the POST (202), the next one the status tick that
    // starts mid-drain — MSW resolves each fetch over macrotask hops
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // running: the wizard button reflects it and the log tail is shown
    // (getByText normalizes the DOM text but not the matcher — single space)
    expect(screen.getByRole('button', { name: 'Einrichtung läuft…' })).toBeInTheDocument()
    expect(screen.getByText('ssh: connected installing...')).toBeInTheDocument()

    // the wizard finishes on the next poll tick
    server.use(
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'success',
          model: 'Raspberry Pi Zero 2 W',
          tier: 'compute',
          key_installed: true,
          log_tail: ['done'],
        }),
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETUP_PI_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(
      screen.getByText('Erfolgreich eingerichtet — Raspberry Pi Zero 2 W (compute)'),
    ).toBeInTheDocument()
    // ticket10-3: the finished run reports the key outcome — the key line
    // updates live from the poll tick (no modal reload needed)
    expect(screen.getByText('SSH-Key installiert')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows the daemon error when the job fails during the run', async () => {
    vi.useFakeTimers()
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-2' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'failed',
          error: 'SSH authentication failed',
          key_error: 'ssh-keygen: key generation failed',
          log_tail: ['ssh: Permission denied'],
        }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // the first poll tick (immediately after the 202) already sees the
    // failure — two drains settle the POST and the status tick (s. above)
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('SSH authentication failed')).toBeInTheDocument()
    expect(screen.getByText('ssh: Permission denied')).toBeInTheDocument()
    // ticket10-3: a failed run surfaces the key error in the key line
    // (key_installed missing = false — the line is the error, not a half state)
    expect(screen.getByText('Key-Setup fehlgeschlagen: ssh-keygen: key generation failed'))
      .toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows the daemon 400 validation error and does not start polling', async () => {
    let statusHits = 0
    server.use(
      http.post('*/api/setup-pi', () =>
        HttpResponse.json({ error: 'invalid ip format: "abc"' }, { status: 400 }),
      ),
      http.get('*/api/setup-pi/status', () => {
        statusHits += 1
        return HttpResponse.json({ state: 'idle' })
      }),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pi automatisch einrichten' })).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    await waitFor(() => expect(screen.getByText('invalid ip format: "abc"')).toBeInTheDocument())
    // no job started — the status endpoint was only hit by the mount probe
    expect(statusHits).toBe(1)
  })

  it('shows the daemon 409 busy error', async () => {
    server.use(
      http.post('*/api/setup-pi', () =>
        HttpResponse.json({ error: 'a provisioning run is already in progress' }, { status: 409 }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pi automatisch einrichten' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    await waitFor(() =>
      expect(screen.getByText('a provisioning run is already in progress')).toBeInTheDocument(),
    )
  })

  it('sends the entered credentials with the POST', async () => {
    let body: { ip?: string; user?: string; password?: string } = {}
    server.use(
      http.post('*/api/setup-pi', async ({ request }) => {
        body = (await request.json()) as typeof body
        return HttpResponse.json({ job_id: 'job-3' }, { status: 202 })
      }),
      http.get('*/api/setup-pi/status', () => HttpResponse.json({ state: 'idle' })),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pi automatisch einrichten' })).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.0.0.9' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SSH Benutzer' }), {
      target: { value: 'dietpi' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    await waitFor(() =>
      expect(body).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' }),
    )
  })

  it('gives up after the 5 minute cap while the job is still running', async () => {
    vi.useFakeTimers()
    server.use(
      http.post('*/api/setup-pi', () => HttpResponse.json({ job_id: 'job-4' }, { status: 202 })),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'running', log_tail: ['hanging...'] }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    // one tick past the cap — the elapsed check is strictly greater than
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETUP_PI_UI_CAP_MS + SETUP_PI_POLL_MS)
    })
    expect(screen.getByText('Setup took longer than 5 minutes — give up')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('closes via the backdrop and the close button', () => {
    const onClose = vi.fn()
    render(<PiServerModal onClose={onClose} onOpenKeyboard={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    // tapping the dimmed backdrop (outside the card) closes the view
    fireEvent.click(document.querySelector('.backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('PiServerModal: on-screen keyboard (ticket10-2)', () => {
  it('focusing a credential field opens the keyboard for exactly that field', () => {
    const onOpenKeyboard = vi.fn()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={onOpenKeyboard} />)

    fireEvent.focus(screen.getByRole('textbox', { name: 'IP-Adresse' }))
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('ip')

    fireEvent.focus(screen.getByRole('textbox', { name: 'SSH Benutzer' }))
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('user')

    fireEvent.focus(screen.getByLabelText('SSH Passwort'))
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('password')

    expect(onOpenKeyboard).toHaveBeenCalledTimes(3)
  })
})
