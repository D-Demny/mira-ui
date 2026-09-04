import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { PiServerModal } from '../PiServerModal'
import { PiKeyboardOverlay, type PiKeyboardField } from '../PiKeyboardOverlay'
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
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ListFocusEntry } from '@/navigation/listFocusContext'

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
    // updates live from the poll tick (no modal reload needed). ticket10-5C:
    // the text also appears in the profile row (per-profile key state)
    expect(screen.getAllByText('SSH-Key installiert')).not.toHaveLength(0)
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
    let body: { ip?: string; user?: string; password?: string; profile_id?: string } = {}
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
    // ticket10-5C: the first keystroke lazily created profile 1 — the POST
    // carries its explicit profile_id (the 10-5B contract)
    await waitFor(() =>
      expect(body).toEqual({
        ip: '10.0.0.9',
        user: 'dietpi',
        password: 'hunter2',
        profile_id: 'pi-1',
      }),
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

  it('focusing the new label field opens the keyboard for the label', () => {
    const onOpenKeyboard = vi.fn()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={onOpenKeyboard} />)
    fireEvent.focus(screen.getByRole('textbox', { name: 'Profil-Name' }))
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('label')
  })
})

// Bug10-2: the credential fields (label / ip / user / password) are part of
// the dial focus chain — dial movement highlights them, Enter opens the
// on-screen keyboard for the focused field, Back closes the keyboard before
// the view, and the focused field is scrolled into the .content container
describe('PiServerModal: dial focus on credential fields (Bug10-2)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  // mirrors the App wiring: the modal's onOpenKeyboard opens the keyboard
  // overlay above it; the modal's onClose closes the keyboard together with
  // the view (App-level back)
  function ModalWithKeyboard({
    onBack,
    onOpenKeyboard,
  }: {
    onBack: () => void
    onOpenKeyboard: (field: PiKeyboardField) => void
  }) {
    const [field, setField] = useState<PiKeyboardField | null>(null)
    return (
      <>
        <PiServerModal
          onClose={() => {
            setField(null)
            onBack()
          }}
          onOpenKeyboard={(f) => {
            onOpenKeyboard(f)
            setField(f)
          }}
        />
        {field !== null ? <PiKeyboardOverlay field={field} onClose={() => setField(null)} /> : null}
      </>
    )
  }

  const wheel = (deltaX: number) => {
    act(() => {
      ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
  }

  const confirm = () => {
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
  }

  const back = () => {
    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })
    return consumed
  }

  it('with no profiles the dial starts on the label field and walks label → ip → user → password → buttons', () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    // fresh install: no profile rows, the first focus item is the label field
    expect(screen.getByRole('textbox', { name: 'Profil-Name' })).toHaveClass('focused')

    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'SSH Benutzer' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByLabelText('SSH Passwort')).toHaveClass('focused')
    wheel(-40) // the buttons follow the fields in layout order
    expect(screen.getByRole('button', { name: 'Profil hinzufügen' })).toHaveClass('focused')
  })

  it('the fields sit between the profile rows and the buttons (layout order with profiles)', () => {
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    // initial focus: the single profile row
    expect(screen.getByRole('button', { name: /Pi 1.*192\.168\.7\.1/ })).toHaveClass('focused')

    wheel(-40) // → the fields start after the rows
    expect(screen.getByRole('textbox', { name: 'Profil-Name' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'SSH Benutzer' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByLabelText('SSH Passwort')).toHaveClass('focused')
    wheel(-40) // → the buttons
    expect(screen.getByRole('button', { name: 'Profil hinzufügen' })).toHaveClass('focused')
  })

  it('Enter on a focused field opens the on-screen keyboard for exactly that field', () => {
    const onOpenKeyboard = vi.fn()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={onOpenKeyboard} />)

    // fresh install: label (0) → ip (1)
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')
    confirm()
    expect(onOpenKeyboard).toHaveBeenCalledTimes(1)
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('ip')

    // dial on (the view's entry is still on top — no keyboard in this harness)
    // → user (2), confirm again
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'SSH Benutzer' })).toHaveClass('focused')
    confirm()
    expect(onOpenKeyboard).toHaveBeenCalledTimes(2)
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('user')
  })

  it('Back closes the keyboard first and the view second; the dial focus stays on the field', () => {
    const onBack = vi.fn()
    const onOpenKeyboard = vi.fn()
    render(<ModalWithKeyboard onBack={onBack} onOpenKeyboard={onOpenKeyboard} />)

    // fresh install: label (0) → ip (1)
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')

    // Enter opens the keyboard for the ip field — its focus entry lands on
    // top of the modal's (bug31 pattern)
    confirm()
    expect(onOpenKeyboard).toHaveBeenLastCalledWith('ip')
    expect(screen.getByRole('dialog', { name: 'IP-Adresse' })).toBeInTheDocument()

    // Back #1: consumed by the keyboard's entry — only the keyboard closes
    expect(back()).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'IP-Adresse' })).not.toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()

    // the modal's dial focus is untouched: still on the ip field
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')

    // Back #2: the modal's entry closes the view (App-level back)
    expect(back()).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('scrolls the focused field into view inside the .content scroll container', () => {
    const scrollSpy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    scrollSpy.mockClear()

    // fresh install: label (0, scrolled on mount) → ip (1)
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')

    // the focused element (the input itself) is scrolled into view —
    // its nearest scrollable ancestor is the .content container
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy.mock.instances.at(-1)).toBe(
      screen.getByRole('textbox', { name: 'IP-Adresse' }),
    )
    expect((screen.getByRole('textbox', { name: 'IP-Adresse' }) as HTMLElement).closest('.content')).not.toBeNull()
    scrollSpy.mockRestore()
  })

  it('tapping a field sets the dial focus on it (touch path unchanged)', () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    // fresh install: the initial dial focus is the label field — tapping the
    // ip field moves the dial focus to it (the keyboard opens via the focus
    // event, covered in the ticket10-2 tests)
    const ipField = screen.getByRole('textbox', { name: 'IP-Adresse' })
    fireEvent.click(ipField)
    expect(ipField).toHaveClass('focused')
    expect(screen.getByRole('textbox', { name: 'Profil-Name' })).not.toHaveClass('focused')
  })
})

// ticket10-5C: the multi-profile list — render, add, switch, delete
describe('PiServerModal: profile list (ticket10-5C)', () => {
  afterEach(() => {
    vi.useRealTimers()
    ListFocusContext.setActive(null)
  })

  // two profiles: pi-1 active (no key), pi-2 inactive (key installed)
  function twoProfiles() {
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
        { id: 'pi-2', label: 'Büro', ip: '10.0.0.9', user: 'dietpi', password: 'hunter2', keyInstalled: true },
      ],
      activePiId: 'pi-1',
    })
  }

  it('renders both profiles with the aktiv marker and the per-profile status', async () => {
    twoProfiles()
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({
          conn: 'connected',
          profile_id: 'pi-1',
          profiles: [
            { id: 'pi-1', key_installed: false },
            { id: 'pi-2', key_installed: true },
          ],
        }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    // the aktiv marker appears exactly once — on the ACTIVE profile
    expect(await screen.findAllByText('aktiv')).toHaveLength(1)

    // active row: the live session state + its key state. The session state
    // arrives with the first /api/pi/status read (async) — wait for it. The
    // accessible name concatenates the spans WITHOUT spaces ("Pi 1aktiv…")
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pi 1.*192\.168\.7\.1/ })).toHaveTextContent('Verbunden')
    })
    const row1 = screen.getByRole('button', { name: /Pi 1.*192\.168\.7\.1/ })
    expect(row1).toHaveTextContent('Passwort-Login erforderlich')

    // inactive row: its key state only — NO live session state (the session
    // is bound to the active profile only, 10-5B)
    const row2 = screen.getByRole('button', { name: /Büro.*10\.0\.0\.9/ })
    expect(row2).toHaveTextContent('SSH-Key installiert')
    expect(row2).not.toHaveTextContent('Verbunden')
    expect(row2).not.toHaveTextContent('Getrennt')
  })

  it('shows no session state for the active profile either before the first status read (503 default)', async () => {
    twoProfiles()
    // no server.use for /api/pi/status — the default handler answers 503
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    const row = await screen.findByRole('button', { name: /Pi 1.*192\.168\.7\.1/ })
    expect(row).not.toHaveTextContent('Verbunden')
    expect(row).not.toHaveTextContent('Getrennt')
  })

  it('takes the daemon profiles[] key state over the settings flag (precedence)', async () => {
    // settings say keyInstalled=true, the device-side key file is gone —
    // the daemon status is the ground truth and must win
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: true },
      ],
      activePiId: 'pi-1',
    })
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({ conn: 'disconnected', profiles: [{ id: 'pi-1', key_installed: false }] }),
      ),
    )
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    const row = await screen.findByRole('button', { name: /Pi 1/ })
    expect(row).toHaveTextContent('Passwort-Login erforderlich')
    expect(row).not.toHaveTextContent('SSH-Key installiert')
  })

  it('falls back to the settings keyInstalled flag on an old daemon (503)', async () => {
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: true },
      ],
      activePiId: 'pi-1',
    })
    // no server.use — the default /api/pi/status handler answers 503
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    const row = await screen.findByRole('button', { name: /Pi 1/ })
    expect(row).toHaveTextContent('SSH-Key installiert')
  })

  it('add flow: creates the next profile (immediately active), the wizard POSTs its profile_id, success keeps it active with the key state', async () => {
    vi.useFakeTimers()
    let posted: { ip?: string; user?: string; password?: string; profile_id?: string } = {}
    server.use(
      http.post('*/api/setup-pi', async ({ request }) => {
        posted = (await request.json()) as typeof posted
        return HttpResponse.json({ job_id: 'job-add' }, { status: 202 })
      }),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'running', log_tail: ['installing...'] }),
      ),
    )
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // "Profil hinzufügen" creates pi-2 (gap-aware numbering) and makes it
    // active — the credential fields now edit it. (Synchronous query: the
    // fake timers below would stall findBy's real-time polling.)
    fireEvent.click(screen.getByRole('button', { name: 'Profil hinzufügen' }))
    expect(getSettings().piProfiles).toHaveLength(2)
    expect(getSettings().activePiId).toBe('pi-2')
    const newRow = screen.getByRole('button', { name: /Pi 2.*192\.168\.7\.1/ })
    expect(newRow).toHaveTextContent('aktiv')

    // the new profile's fields are the edit target (the 10-2 keyboard
    // writes the same store fields — here written directly)
    fireEvent.change(screen.getByRole('textbox', { name: 'Profil-Name' }), {
      target: { value: 'Büro' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.9.8.7' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SSH Benutzer' }), {
      target: { value: 'dietpi' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'hunter2' },
    })
    expect(getSettings().piProfiles[1]).toEqual({
      id: 'pi-2',
      label: 'Büro',
      ip: '10.9.8.7',
      user: 'dietpi',
      password: 'hunter2',
      keyInstalled: false,
    })

    // wizard start — the POST carries the explicit profile_id (10-5B)
    fireEvent.click(screen.getByRole('button', { name: 'Pi automatisch einrichten' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(posted).toEqual({
      ip: '10.9.8.7',
      user: 'dietpi',
      password: 'hunter2',
      profile_id: 'pi-2',
    })

    // the run finishes — the profile is stored, stays ACTIVE, and the key
    // state is persisted into it
    server.use(
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({
          state: 'success',
          model: 'Pi Zero 2 W',
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
      screen.getByText('Erfolgreich eingerichtet — Pi Zero 2 W (compute)'),
    ).toBeInTheDocument()
    expect(getSettings().activePiId).toBe('pi-2')
    expect(getSettings().piProfiles[1].keyInstalled).toBe(true)
    // the key line (active profile) AND the row's key state reflect it
    expect(screen.getAllByText('SSH-Key installiert')).not.toHaveLength(0)
  })

  it('switches the active profile on a tap and retargets the capabilities poll to the new ip', async () => {
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
        { id: 'pi-2', label: 'Pi 2', ip: '10.0.0.9', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    // settle the mount check of the FIRST profile (default handler: offline)
    await settleMountCheck()
    expect(getMiraServerState().mode).toBe('standalone')

    // only the second profile's ip answers the capabilities ping
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const host = new URL(request.url).hostname
        return host === '10.0.0.9' ? HttpResponse.json(COMPUTE) : HttpResponse.error()
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Pi 2.*10\.0\.0\.9/ }))
    expect(getSettings().activePiId).toBe('pi-2')

    // the retarget (ticket10-5A settings subscription) pings the new ip
    // and switches the shared state — the /img/ routes follow the same base
    await waitFor(() => expect(getMiraServerState().mode).toBe('compute'))

    // the aktiv marker moved to the second row
    const activeRows = screen.getAllByRole('button', { name: /aktiv/ })
    expect(activeRows).toHaveLength(1)
    expect(activeRows[0]).toHaveTextContent('10.0.0.9')
    // tapping the active row again is a no-op (still exactly one active)
    fireEvent.click(activeRows[0])
    expect(getSettings().activePiId).toBe('pi-2')
  })

  it('deletes the active profile: confirmation → DELETE call with the credentials → settings update, the first remaining profile becomes active', async () => {
    let id: string | null = null
    let body: unknown = null
    server.use(
      http.delete('*/api/pi/profile', async ({ request }) => {
        id = new URL(request.url).searchParams.get('id')
        body = await request.json()
        return HttpResponse.json({ key_removed: true, authorized_keys_removed: true })
      }),
    )
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: 'pw1', keyInstalled: true },
        { id: 'pi-2', label: 'Pi 2', ip: '10.0.0.9', user: 'dietpi', password: 'pw2', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    // the confirmation names the ACTIVE profile (the one being edited)
    fireEvent.click(screen.getByRole('button', { name: 'Profil entfernen' }))
    const dialog = await screen.findByRole('dialog', { name: 'Profil entfernen' })
    expect(dialog).toHaveTextContent('Pi 1')
    expect(dialog).toHaveTextContent('192.168.7.1')

    // confirm → the daemon endpoint gets the id (query) and the credentials
    // (body, for the best-effort authorized_keys cleanup)
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    await waitFor(() => expect(id).toBe('pi-1'))
    expect(body).toEqual({ ip: '192.168.7.1', user: 'root', password: 'pw1' })

    // the profile is gone from the store, the first remaining one is active
    await waitFor(() => {
      expect(getSettings().piProfiles).toEqual([
        { id: 'pi-2', label: 'Pi 2', ip: '10.0.0.9', user: 'dietpi', password: 'pw2', keyInstalled: false },
      ])
      expect(getSettings().activePiId).toBe('pi-2')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // the fields now edit the new active profile
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveValue('10.0.0.9')
  })

  it('canceling the confirmation deletes nothing (no DELETE call)', async () => {
    let deleteCalls = 0
    server.use(
      http.delete('*/api/pi/profile', () => {
        deleteCalls += 1
        return HttpResponse.json({})
      }),
    )
    twoProfiles()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Profil entfernen' }))
    await screen.findByRole('dialog', { name: 'Profil entfernen' })
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCalls).toBe(0)
    expect(getSettings().piProfiles).toHaveLength(2)
    expect(getSettings().activePiId).toBe('pi-1')
  })

  it('removes the profile from the store even when the daemon is too old (503, best-effort)', async () => {
    // no server.use — the default DELETE handler is 503 (old daemon)
    twoProfiles()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Profil entfernen' }))
    await screen.findByRole('dialog', { name: 'Profil entfernen' })
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    // the store update happens regardless (the cleanup is best-effort), and
    // the failure is surfaced instead of swallowing it
    await waitFor(() => expect(getSettings().activePiId).toBe('pi-2'))
    expect(getSettings().piProfiles).toHaveLength(1)
    expect(screen.getByText(/503/)).toBeInTheDocument()
  })

  it('deleting the LAST profile empties the list (activePiId null → standalone display)', async () => {
    server.use(
      http.delete('*/api/pi/profile', () =>
        HttpResponse.json({ key_removed: true, authorized_keys_removed: true }),
      ),
    )
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Profil entfernen' }))
    await screen.findByRole('dialog', { name: 'Profil entfernen' })
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => expect(getSettings().piProfiles).toHaveLength(0))
    expect(getSettings().activePiId).toBeNull()
    expect(screen.getByText('Kein Pi konfiguriert')).toBeInTheDocument()
    // the fields show the display defaults again (no synthetic profile)
    expect(screen.getByRole('textbox', { name: 'Profil-Name' })).toHaveValue('Pi 1')
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveValue('192.168.7.1')
    // and deleting is no longer possible (no profile to remove)
    expect(screen.getByRole('button', { name: 'Profil entfernen' })).toBeDisabled()
  })

  it('registers its own focus entry; back closes the confirmation first, then the view (back hierarchy)', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
    ListFocusContext.setActive(parent)
    const onClose = vi.fn()
    twoProfiles()
    const { unmount } = render(<PiServerModal onClose={onClose} onOpenKeyboard={vi.fn()} />)

    // the modal's entry sits on top of the parent's (bug31 pattern)
    expect(ListFocusContext.entry).not.toBe(parent)
    expect(ListFocusContext.entry.active).toBe(true)

    // opening the confirmation pushes its own entry on top of the modal's
    fireEvent.click(screen.getByRole('button', { name: 'Profil entfernen' }))
    expect(screen.getByRole('dialog', { name: 'Profil entfernen' })).toBeInTheDocument()

    // back #1: the confirmation closes (consumed), the view stays open
    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })
    expect(consumed).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // back #2: the modal's entry closes the view (the parent stays untouched)
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(parent.onBack).not.toHaveBeenCalled()

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('dial navigation walks the rows, the credential fields and the action buttons in visual order', () => {
    twoProfiles()
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)

    const wheel = (deltaX: number) => {
      act(() => {
        ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
      })
    }

    // initial focus: the first profile row (pi-1 is active — the "aktiv"
    // marker sits between label and ip in the accessible name)
    expect(screen.getByRole('button', { name: /Pi 1.*192\.168\.7\.1/ })).toHaveClass('focused')

    wheel(-40) // → second row
    expect(screen.getByRole('button', { name: /Büro.*10\.0\.0\.9/ })).toHaveClass('focused')

    // Bug10-2: the credential fields join the chain after the rows
    wheel(-40) // → "Profil-Name" (label field)
    expect(screen.getByRole('textbox', { name: 'Profil-Name' })).toHaveClass('focused')

    wheel(-40) // → "IP-Adresse"
    expect(screen.getByRole('textbox', { name: 'IP-Adresse' })).toHaveClass('focused')

    wheel(-40) // → "SSH Benutzer"
    expect(screen.getByRole('textbox', { name: 'SSH Benutzer' })).toHaveClass('focused')

    wheel(-40) // → "SSH Passwort"
    expect(screen.getByLabelText('SSH Passwort')).toHaveClass('focused')

    wheel(-40) // → "Profil hinzufügen"
    expect(screen.getByRole('button', { name: 'Profil hinzufügen' })).toHaveClass('focused')

    wheel(-40) // → "Profil entfernen"
    expect(screen.getByRole('button', { name: 'Profil entfernen' })).toHaveClass('focused')

    wheel(-40) // → "Verbindung testen"
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveClass('focused')

    wheel(-40) // → "Pi automatisch einrichten" (last item, clamped)
    expect(screen.getByRole('button', { name: 'Pi automatisch einrichten' })).toHaveClass('focused')

    wheel(-40) // stays clamped at the end
    expect(screen.getByRole('button', { name: 'Pi automatisch einrichten' })).toHaveClass('focused')

    wheel(40) // counter-clockwise one step back to the test button
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveClass('focused')

    wheel(40) // …and on to the "Profil entfernen" button
    expect(screen.getByRole('button', { name: 'Profil entfernen' })).toHaveClass('focused')

    wheel(40) // …and back into the chain: the "Profil hinzufügen" button
    expect(screen.getByRole('button', { name: 'Profil hinzufügen' })).toHaveClass('focused')

    wheel(40) // …then the last credential field
    expect(screen.getByLabelText('SSH Passwort')).toHaveClass('focused')
  })
})

describe('PiServerModal: layout (Bug10-1)', () => {
  it('wraps the whole menu in a vertical scroll container (fixed card shell + overflow-y: auto content)', () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    // the card is the fixed shell; .content (overflow-y: auto in
    // PiServerModal.module.scss) is the single vertical scroll container —
    // the established SettingsList pattern. jsdom does not compute class
    // styles, so the scroll role is asserted via the dedicated class.
    const card = document.querySelector('.card')
    const content = document.querySelector('.content')
    expect(card).not.toBeNull()
    expect(content).not.toBeNull()
    expect(content?.parentElement).toBe(card)
    // the scroll container holds the ENTIRE menu: header (status lines),
    // profile list, credential fields and the action buttons
    expect(content?.textContent).toContain('Raspberry Pi')
    expect(content?.textContent).toContain('SSH Passwort')
    expect(content?.textContent).toContain('Profil hinzufügen')
    expect(content?.textContent).toContain('Profil entfernen')
    expect(content?.textContent).toContain('Pi automatisch einrichten')
  })

  it('keeps header, credential fields and buttons in document-flow order inside the scroll container (no overlap structure)', () => {
    render(<PiServerModal onClose={() => {}} onOpenKeyboard={vi.fn()} />)
    const content = document.querySelector('.content')
    expect(content).not.toBeNull()
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
    const header = content!.querySelector('.header')
    const passwordField = screen.getByLabelText('SSH Passwort').closest('label')
    const addBtn = screen.getByRole('button', { name: 'Profil hinzufügen' })
    const deleteBtn = screen.getByRole('button', { name: 'Profil entfernen' })
    const setupBtn = screen.getByRole('button', { name: 'Pi automatisch einrichten' })
    // header (status lines) → credential fields → buttons: everything is in
    // normal document flow inside the scroll container, so the blocks can
    // never render at fixed offsets on top of each other
    expect(header?.compareDocumentPosition(passwordField!) & FOLLOWING).toBeTruthy()
    expect(passwordField?.compareDocumentPosition(addBtn) & FOLLOWING).toBeTruthy()
    expect(addBtn.compareDocumentPosition(deleteBtn) & FOLLOWING).toBeTruthy()
    expect(deleteBtn.compareDocumentPosition(setupBtn) & FOLLOWING).toBeTruthy()
    // no button block or field is outside the scroll container (nothing is
    // absolutely positioned above the menu anymore)
    for (const el of [header!, passwordField!, addBtn, deleteBtn, setupBtn]) {
      expect(content!.contains(el)).toBe(true)
    }
  })
})
