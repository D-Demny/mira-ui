import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { PiServerModal } from '../PiServerModal'
import { __resetMiraServerState, checkMiraServer, getMiraServerState } from '@/hooks/useMiraServer'
import type { MiraServerCapabilities } from '@/api/miraServer'
import { __resetSettings, getSettings } from '@/settings'
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

// the mount-time capabilities check (useMiraServer subscription) must settle
// before a manual re-check, otherwise the re-check joins it (default handler
// = standalone) and the test would assert the wrong request
async function settleMountCheck() {
  await act(async () => {
    await checkMiraServer()
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  __resetMiraServerState()
})

describe('PiServerModal: status line', () => {
  it('shows the standalone status and the default credentials', async () => {
    render(<PiServerModal onClose={() => {}} />)
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
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    render(<PiServerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Verbunden (Compute Mode)')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('compute')
  })

  it('shows the lightweight (cache only) status line', async () => {
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(CACHE)))
    render(<PiServerModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Connected (Cache Only)')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('lightweight')
  })

  it('includes the detected model from the setup status in the status line', async () => {
    server.use(
      http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)),
      http.get('*/api/setup-pi/status', () =>
        HttpResponse.json({ state: 'idle', model: 'Pi Zero 2 W', tier: 'compute' }),
      ),
    )
    render(<PiServerModal onClose={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText('Verbunden (Pi Zero 2 W - Compute Mode)')).toBeInTheDocument(),
    )
  })
})

describe('PiServerModal: Verbindung testen', () => {
  it('pings the ENTERED ip and reports success', async () => {
    // settle the mount check (default handler: offline), then make only the
    // custom ip answer — proves the test used the input value, not the default
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
    await settleMountCheck()
    // no custom handler: the default (default ip) stays offline
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await waitFor(() => expect(screen.getByText('Test: Getrennt')).toBeInTheDocument())
    expect(getMiraServerState().mode).toBe('standalone')
  })
})

describe('PiServerModal: persistent credentials', () => {
  it('persists ip / user / password in the settings store (localStorage)', async () => {
    render(<PiServerModal onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.0.0.9' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SSH Benutzer' }), {
      target: { value: 'dietpi' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'hunter2' },
    })
    await waitFor(() =>
      expect(getSettings().piServer).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' }),
    )
    // the store writes through to the settings blob in localStorage
    const stored = JSON.parse(localStorage.getItem('mira.settings.v1') ?? '{}') as {
      piServer?: { ip: string; user: string; password: string }
    }
    expect(stored.piServer).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' })
  })

  it('restores the persisted credentials on a fresh mount (simulated reload)', async () => {
    const { unmount } = render(<PiServerModal onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'IP-Adresse' }), {
      target: { value: '10.0.0.9' },
    })
    fireEvent.change(screen.getByLabelText('SSH Passwort'), {
      target: { value: 'secret' },
    })
    await waitFor(() =>
      expect(getSettings().piServer).toEqual({ ip: '10.0.0.9', user: 'root', password: 'secret' }),
    )
    unmount()
    // a reload re-reads the blob from localStorage
    __resetSettings()
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
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
          log_tail: ['ssh: Permission denied'],
        }),
      ),
    )
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={() => {}} />)
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
    render(<PiServerModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    // tapping the dimmed backdrop (outside the card) closes the view
    fireEvent.click(document.querySelector('.backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
