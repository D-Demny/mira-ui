import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HaSettingsModal } from '../HaSettingsModal'
import * as settingsModule from '@/settings'
import { __resetSettings, getSettings, updateSettings } from '@/settings'
import { __resetHomeEntityStores } from '@/hooks/useHomeEntities'
import { server } from '@/__tests__/msw-server'
import { ListFocusContext } from '@/navigation/listFocusContext'

// ticket 9.4: the Home Assistant settings modal (URL/IP:Port / Username /
// Passwort + on-screen keyboard + "Verbindung testen" (probe only) +
// "Speichern" (transactional, optionally with the daemon's WS login)).
//
// Test isolation: the settings store (__resetSettings) and the 60 s-TTL
// entity catalog (__resetHomeEntityStores) are reset in beforeEach;
// server.resetHandlers() runs automatically, so the msw-server defaults
// (plain-text 404 for the ha endpoints = old daemon) apply unless a test
// opts in.

// the default MSW catalog fixture carries 9 lights + 6 controllable
// non-lights (the sensor is filtered out)
const CATALOG_SIZE = 15

const FULL_HA = {
  url: 'http://10.10.1.104:8123',
  username: 'mira',
  password: 'pw-secret',
  token: 'tok-secret',
  tokenSource: 'login' as const,
}

function haTestOk(opts: { reachable?: boolean; authenticated?: boolean; defaultUrl?: string } = {}) {
  return HttpResponse.json({
    reachable: opts.reachable ?? true,
    authenticated: opts.authenticated ?? true,
    defaults: { url: opts.defaultUrl ?? '' },
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  __resetHomeEntityStores()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  ListFocusContext.setActive(null)
})

// the observable for "EIN Store-Write": the settings store exposes exactly
// one write path (updateSettings, settings.ts), so a spy on it captures
// every store write and its patch (same pattern as the PiServerModal tests)
function captureStoreWrites() {
  const patches: unknown[] = []
  const original = settingsModule.updateSettings.bind(settingsModule)
  vi.spyOn(settingsModule, 'updateSettings').mockImplementation(
    (patch: Parameters<typeof settingsModule.updateSettings>[0]) => {
      patches.push(patch)
      original(patch)
    },
  )
  return patches
}

describe('HaSettingsModal: status line per status state', () => {
  it('shows "Nicht konfiguriert" on a fresh install (no config, no probe yet)', () => {
    render(<HaSettingsModal onClose={() => {}} />)
    expect(screen.getByText('Nicht konfiguriert')).toBeInTheDocument()
    // nothing saved → empty fields, the buttons are disabled without a URL
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('shows "Konfiguriert — verbunden, N Entitäten" for an authenticated probe (count via the 60 s-TTL catalog)', async () => {
    updateSettings({ ha: FULL_HA })
    server.use(
      http.post('*/api/ha/test', () => haTestOk({ reachable: true, authenticated: true })),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    await screen.findByText(`Konfiguriert — verbunden, ${CATALOG_SIZE} Entitäten`)
  })

  it('shows "Konfiguriert — nicht authentifiziert (401)" for a reachable-unauth probe', async () => {
    updateSettings({ ha: FULL_HA })
    server.use(
      http.post('*/api/ha/test', () =>
        haTestOk({ reachable: true, authenticated: false }),
      ),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    await screen.findByText('Konfiguriert — nicht authentifiziert (401)')
  })

  it('shows "Nicht erreichbar (<host>)" for an unreachable probe', async () => {
    updateSettings({ ha: FULL_HA })
    server.use(
      http.post('*/api/ha/test', () => haTestOk({ reachable: false, authenticated: false })),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    await screen.findByText('Nicht erreichbar (10.10.1.104:8123)')
  })

  it('shows "Prüfe Verbindung…" while the probe is in flight (both buttons disabled)', () => {
    updateSettings({ ha: FULL_HA })
    server.use(http.post('*/api/ha/test', () => new Promise<HttpResponse<undefined>>(() => {})))
    render(<HaSettingsModal onClose={() => {}} />)
    expect(screen.getByText('Prüfe Verbindung…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('shows "Konfiguriert" (base) + the concrete reason when the probe itself fails (old daemon)', async () => {
    updateSettings({ ha: FULL_HA })
    // no server.use — the default handler is the old-daemon plain-text 404
    render(<HaSettingsModal onClose={() => {}} />)
    await screen.findByText('Konfiguriert')
    expect(screen.getByText('HA-Login nicht verfügbar (Daemon veraltet?)')).toBeInTheDocument()
  })

  it('shows "Nicht konfiguriert (Default: …)" once a probe delivered the default URL and the next probe failed (timeout)', async () => {
    vi.useFakeTimers()
    // url saved without a token (base 'default', partial config)
    updateSettings({
      ha: { url: 'http://10.10.1.104:8123', username: '', password: '', token: '', tokenSource: 'default' },
    })
    server.use(
      http.post('*/api/ha/test', () =>
        haTestOk({ reachable: true, authenticated: false, defaultUrl: 'http://10.10.1.104:8123' }),
      ),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    // the mount probe settles: url saved without token → "nicht authentifiziert"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Konfiguriert — nicht authentifiziert (401)')).toBeInTheDocument()
    // the next probe hangs → the 10 s client timeout aborts it; the failed
    // probe clears the connection but keeps the known default URL
    server.use(http.post('*/api/ha/test', () => new Promise<HttpResponse<undefined>>(() => {})))
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByText('Nicht konfiguriert (Default: http://10.10.1.104:8123)')).toBeInTheDocument()
    expect(screen.getByText('Zeitüberschreitung — Daemon antwortet nicht')).toBeInTheDocument()
  })
})

describe('HaSettingsModal: field pre-fills', () => {
  it('pre-fills all three fields from the saved ha config (password masked)', () => {
    updateSettings({ ha: FULL_HA })
    server.use(
      http.post('*/api/ha/test', () => haTestOk({ reachable: true, authenticated: true })),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('http://10.10.1.104:8123')
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('mira')
    const password = screen.getByLabelText('Passwort')
    expect(password).toHaveValue('pw-secret')
    expect(password).toHaveAttribute('type', 'password')
  })

  it('falls back to the daemon default URL (task 7) while the config is default and a probe delivered it', async () => {
    server.use(
      http.post('*/api/ha/test', () =>
        haTestOk({ reachable: false, authenticated: false, defaultUrl: 'http://10.10.1.104:8123' }),
      ),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    // fresh install: nothing saved, nothing probed → empty field, no default yet
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('')
    // the user enters a URL and tests it — the probe delivers the default
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://192.168.1.50:8123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await waitFor(() =>
      expect(screen.getByText('Nicht erreichbar (192.168.1.50:8123)')).toBeInTheDocument(),
    )
    // clearing the field falls back to the daemon's default URL (the base
    // status is still 'default' — nothing has been saved)
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: '' },
    })
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue(
      'http://10.10.1.104:8123',
    )
  })
})

describe('HaSettingsModal: dial focus chain (fields + buttons)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  const wheel = (deltaX: number) => {
    act(() => {
      ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
  }

  it('walks url → username → password → test → save (clamped at both ends)', () => {
    render(<HaSettingsModal onClose={() => {}} />)
    // the first focus item is the URL field
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveClass('focused')

    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByLabelText('Passwort')).toHaveClass('focused')
    wheel(-40) // the buttons follow the fields in layout order
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
    wheel(-40) // clamped at the end
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
    wheel(40) // counter-clockwise back to the test button
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveClass('focused')
    wheel(40) // …and back into the fields
    expect(screen.getByLabelText('Passwort')).toHaveClass('focused')
  })
})

describe('HaSettingsModal: on-screen keyboard (dedicated HaKeyboardOverlay instance)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

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

  it('focusing a credential field opens the keyboard for exactly that field', () => {
    render(<HaSettingsModal onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.focus(screen.getByRole('textbox', { name: 'URL/IP:Port' }))
    expect(screen.getByRole('dialog', { name: 'URL/IP:Port' })).toBeInTheDocument()

    fireEvent.focus(screen.getByRole('textbox', { name: 'Username' }))
    expect(screen.getByRole('dialog', { name: 'Username' })).toBeInTheDocument()

    fireEvent.focus(screen.getByLabelText('Passwort'))
    expect(screen.getByRole('dialog', { name: 'Passwort' })).toBeInTheDocument()
  })

  it('Enter on a focused field opens the keyboard for exactly that field', () => {
    render(<HaSettingsModal onClose={() => {}} />)
    wheel(-40) // → username
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveClass('focused')
    confirm()
    expect(screen.getByRole('dialog', { name: 'Username' })).toBeInTheDocument()
  })

  it('typing on the keyboard edits the DRAFT (the field behind + the preview), never the store', () => {
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    // the URL field is focused initially (index 0) → open its keyboard
    confirm()
    expect(screen.getByRole('dialog', { name: 'URL/IP:Port' })).toBeInTheDocument()
    // the first key ('1') is focused; confirm types it
    confirm()
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('1')
    // dial to the '0' key (index 9) and type it
    for (let i = 0; i < 9; i++) wheel(-40)
    confirm()
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('10')
    // nothing is persisted while typing (the draft model — only "Speichern"
    // may write the store)
    expect(storeWrites).toHaveLength(0)

    // the password field masks the preview: close this keyboard, dial on to
    // the password field, open its keyboard and type one key
    back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    wheel(-40) // → username
    wheel(-40) // → password
    confirm()
    expect(screen.getByRole('dialog', { name: 'Passwort' })).toBeInTheDocument()
    confirm()
    // the open keyboard's dialog carries the same accessible name — scope
    // to the input element
    const passwordInput = screen
      .getAllByLabelText('Passwort')
      .find((el) => el.tagName === 'INPUT') as HTMLInputElement
    expect(passwordInput).toHaveValue('1')
    expect(screen.getByText('•')).toBeInTheDocument()
  })

  it('Back closes the keyboard first and the modal second; the dial focus stays on the field', () => {
    const onClose = vi.fn()
    render(<HaSettingsModal onClose={onClose} />)
    wheel(-40) // → username
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveClass('focused')
    confirm() // opens the keyboard for the username field
    expect(screen.getByRole('dialog', { name: 'Username' })).toBeInTheDocument()

    // Back #1: consumed by the keyboard's entry — only the keyboard closes
    expect(back()).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Username' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // the modal's dial focus is untouched: still on the username field
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveClass('focused')

    // Back #2: the modal's entry closes the view
    expect(back()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes via the backdrop and the close button', () => {
    const onClose = vi.fn()
    render(<HaSettingsModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    // tapping the dimmed backdrop (outside the card) closes the view
    fireEvent.click(document.querySelector('.backdrop') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('HaSettingsModal: Verbindung testen (probe only, never persists)', () => {
  it('probes the entered URL with the stored token and updates the status line (no store write)', async () => {
    updateSettings({ ha: FULL_HA })
    const bodies: unknown[] = []
    server.use(
      http.post('*/api/ha/test', async ({ request }) => {
        bodies.push(await request.json())
        return haTestOk({ reachable: true, authenticated: false })
      }),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    // the mount probe (saved config) settles on "nicht authentifiziert"
    await waitFor(() =>
      expect(screen.getByText('Konfiguriert — nicht authentifiziert (401)')).toBeInTheDocument(),
    )
    // re-probe via the button with an edited URL (the stored token rides
    // along — the draft has no token field, phase 2)
    server.use(
      http.post('*/api/ha/test', async ({ request }) => {
        bodies.push(await request.json())
        return haTestOk({ reachable: true, authenticated: true })
      }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://10.9.8.7:8123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await waitFor(() =>
      expect(
        screen.getByText(`Konfiguriert — verbunden, ${CATALOG_SIZE} Entitäten`),
      ).toBeInTheDocument(),
    )
    expect(bodies).toEqual([
      { url: 'http://10.10.1.104:8123', token: 'tok-secret' },
      { url: 'http://10.9.8.7:8123', token: 'tok-secret' },
    ])
    // the test button never persists
    expect(storeWrites).toHaveLength(0)
    expect(getSettings().ha).toEqual(FULL_HA)
  })

  it('reports an unreachable HA server in the status line (no store write)', async () => {
    updateSettings({ ha: FULL_HA })
    server.use(
      http.post('*/api/ha/test', () => haTestOk({ reachable: false, authenticated: false })),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText('Nicht erreichbar (10.10.1.104:8123)')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
  })
})

describe('HaSettingsModal: Speichern (transactional)', () => {
  it('login OK → ONE store write with the exact ha patch (fresh token, tokenSource login) + fresh status line, modal stays open', async () => {
    const loginBodies: unknown[] = []
    server.use(
      http.post('*/api/ha/login', async ({ request }) => {
        loginBodies.push(await request.json())
        return HttpResponse.json({ ok: true, token: 'tok-new-10y' })
      }),
      http.post('*/api/ha/test', () => haTestOk({ reachable: true, authenticated: true })),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    // fresh install: no probe on mount, no store write yet
    expect(storeWrites).toHaveLength(0)
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://10.10.1.104:8123' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'mira' },
    })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw-secret' } })
    // typing never persists (the draft model)
    expect(storeWrites).toHaveLength(0)
    expect(getSettings().ha).toEqual({
      url: '',
      username: '',
      password: '',
      token: '',
      tokenSource: 'default',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(storeWrites).toHaveLength(1))
    expect(storeWrites[0]).toEqual({
      ha: {
        url: 'http://10.10.1.104:8123',
        username: 'mira',
        password: 'pw-secret',
        token: 'tok-new-10y',
        tokenSource: 'login',
      },
    })
    expect(getSettings().ha).toEqual({
      url: 'http://10.10.1.104:8123',
      username: 'mira',
      password: 'pw-secret',
      token: 'tok-new-10y',
      tokenSource: 'login',
    })
    // the daemon got exactly the entered credentials
    expect(loginBodies).toEqual([
      { url: 'http://10.10.1.104:8123', username: 'mira', password: 'pw-secret' },
    ])
    // the modal stays open — the status line settles on the fresh
    // connection (the probe runs with the newly saved token)
    await waitFor(() =>
      expect(screen.getByText(`Konfiguriert — verbunden, ${CATALOG_SIZE} Entitäten`)).toBeInTheDocument(),
    )
    expect(screen.getByText('Home Assistant')).toBeInTheDocument()
  })

  it('an unchanged valid login token skips the re-login (token + source kept, URL still saved)', async () => {
    updateSettings({ ha: FULL_HA })
    let loginCalls = 0
    server.use(
      http.post('*/api/ha/login', () => {
        loginCalls += 1
        return HttpResponse.json({ ok: true, token: 'tok-must-not-appear' })
      }),
      http.post('*/api/ha/test', () => haTestOk({ reachable: true, authenticated: true })),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    // the mount probe (saved config) must settle first — while it is in
    // flight both buttons are disabled (busy state)
    await screen.findByText(`Konfiguriert — verbunden, ${CATALOG_SIZE} Entitäten`)
    // only the URL changes — the stored token is a valid login result for
    // exactly these credentials → no re-login
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://10.10.1.105:8123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(storeWrites).toHaveLength(1))
    expect(loginCalls).toBe(0)
    expect(storeWrites[0]).toEqual({
      ha: {
        url: 'http://10.10.1.105:8123',
        username: 'mira',
        password: 'pw-secret',
        token: 'tok-secret',
        tokenSource: 'login',
      },
    })
  })

  it('a changed password triggers the re-login (fresh token, tokenSource login)', async () => {
    updateSettings({ ha: FULL_HA })
    const loginBodies: unknown[] = []
    server.use(
      http.post('*/api/ha/login', async ({ request }) => {
        loginBodies.push(await request.json())
        return HttpResponse.json({ ok: true, token: 'tok-relogin' })
      }),
      http.post('*/api/ha/test', () => haTestOk({ reachable: true, authenticated: true })),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    // the mount probe (saved config) must settle first — while it is in
    // flight both buttons are disabled (busy state)
    await screen.findByText(`Konfiguriert — verbunden, ${CATALOG_SIZE} Entitäten`)
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw-new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(storeWrites).toHaveLength(1))
    expect(loginBodies).toEqual([
      { url: 'http://10.10.1.104:8123', username: 'mira', password: 'pw-new' },
    ])
    expect(storeWrites[0]).toEqual({
      ha: {
        url: 'http://10.10.1.104:8123',
        username: 'mira',
        password: 'pw-new',
        token: 'tok-relogin',
        tokenSource: 'login',
      },
    })
  })

  it('shows "Speichere…" and disables both buttons while the save (login) runs', async () => {
    server.use(http.post('*/api/ha/login', () => new Promise<HttpResponse<undefined>>(() => {})))
    render(<HaSettingsModal onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://10.10.1.104:8123' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), { target: { value: 'mira' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(screen.getByRole('button', { name: 'Speichere…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toBeDisabled()
  })
})

describe('HaSettingsModal: login failure flows (no store write + concrete error line)', () => {
  const FILL = { url: 'http://10.10.1.104:8123', user: 'mira', pw: 'wrong-pw' }

  function fillFields() {
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: FILL.url },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: FILL.user },
    })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: FILL.pw } })
  }

  it('invalid_credentials → "Benutzername oder Passwort falsch", no store write', async () => {
    server.use(
      http.post('*/api/ha/login', () =>
        HttpResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 }),
      ),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('Benutzername oder Passwort falsch')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
    expect(getSettings().ha).toEqual({
      url: '',
      username: '',
      password: '',
      token: '',
      tokenSource: 'default',
    })
    // the credentials must not appear in the error line
    expect(screen.getByText('Benutzername oder Passwort falsch').textContent).not.toContain(FILL.pw)
  })

  it('mfa → "2FA aktiv — Access Token manuell eingeben (Phase 2)", no store write', async () => {
    server.use(
      http.post('*/api/ha/login', () =>
        HttpResponse.json({ ok: false, error: 'mfa' }, { status: 401 }),
      ),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('2FA aktiv — Access Token manuell eingeben (Phase 2)')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
  })

  it('unreachable → "Nicht erreichbar (Timeout für <host>)", no store write', async () => {
    server.use(
      http.post('*/api/ha/login', () =>
        HttpResponse.json({ ok: false, error: 'unreachable' }, { status: 502 }),
      ),
    )
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('Nicht erreichbar (Timeout für 10.10.1.104:8123)')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
  })

  it('not_available (old daemon, plain-text 404) → "HA-Login nicht verfügbar (Daemon veraltet?)", no store write', async () => {
    // no server.use — the default handler IS the old-daemon plain-text 404
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('HA-Login nicht verfügbar (Daemon veraltet?)')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
  })

  it('timeout (daemon unresponsive) → "Zeitüberschreitung — Daemon antwortet nicht", no store write', async () => {
    vi.useFakeTimers()
    server.use(http.post('*/api/ha/login', () => new Promise<HttpResponse<undefined>>(() => {})))
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    // the 10 s client timeout aborts the fetch (haSettings.ts)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(screen.getByText('Zeitüberschreitung — Daemon antwortet nicht')).toBeInTheDocument()
    expect(storeWrites).toHaveLength(0)
  })

  it('network (daemon offline) → "Daemon nicht erreichbar (Netzwerkfehler)", no store write', async () => {
    server.use(http.post('*/api/ha/login', () => HttpResponse.error()))
    const storeWrites = captureStoreWrites()
    render(<HaSettingsModal onClose={() => {}} />)
    fillFields()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('Daemon nicht erreichbar (Netzwerkfehler)')).toBeInTheDocument(),
    )
    expect(storeWrites).toHaveLength(0)
  })
})

describe('HaSettingsModal: security (no credential logging)', () => {
  it('never puts username/password/token on the console (error line included)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.post('*/api/ha/login', () =>
        HttpResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 }),
      ),
    )
    render(<HaSettingsModal onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: 'http://10.10.1.104:8123' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'mira-secret-user' },
    })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw-super-secret-xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(screen.getByText('Benutzername oder Passwort falsch')).toBeInTheDocument(),
    )
    // the rendered error line carries no credential value
    expect(screen.getByText('Benutzername oder Passwort falsch').textContent).not.toContain(
      'pw-super-secret-xyz',
    )
    expect(screen.getByText('Benutzername oder Passwort falsch').textContent).not.toContain(
      'mira-secret-user',
    )
    // neither did any console.* call (the modal + the Part A clients must
    // never log credentials — ticket 9.4 hard acceptance criterion)
    const all = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((c) => c.join(' '))
      .join('\n')
    expect(all).not.toContain('pw-super-secret-xyz')
    expect(all).not.toContain('mira-secret-user')
  })
})

describe('HaSettingsModal: layout (CR69 / Bug51)', () => {
  it('wraps the whole menu in a vertical scroll container (fixed card shell + scrolling content)', () => {
    render(<HaSettingsModal onClose={() => {}} />)
    // the card is the fixed shell; .content (overflow-y: auto in
    // HaSettingsModal.module.scss) is the single vertical scroll container
    // — the established SettingsList pattern. jsdom does not compute class
    // styles, so the scroll role is asserted via the dedicated class.
    const card = document.querySelector('.card')
    const content = document.querySelector('.content')
    expect(card).not.toBeNull()
    expect(content).not.toBeNull()
    expect(content?.parentElement).toBe(card)
    // Bug51: the scroll container is the ONLY child of the fixed shell —
    // every block of the menu must scroll with it
    expect(Array.from(card!.children)).toEqual([content])
    // the scroll container holds the ENTIRE menu: header (status line),
    // credential fields and the action buttons
    expect(content?.textContent).toContain('Home Assistant')
    expect(content?.textContent).toContain('URL/IP:Port')
    expect(content?.textContent).toContain('Username')
    expect(content?.textContent).toContain('Passwort')
    expect(content?.textContent).toContain('Verbindung testen')
    expect(content?.textContent).toContain('Speichern')
  })

  // Bug51: on the 800x480 device the card is capped by the max-height chain
  // (backdrop 100vh → card max-height calc(100% - $s-6)). Inside the capped
  // card the .content block shrinks to the available height (flex: 1 1 auto
  // + min-height: 0) — and then its direct children must keep their content
  // height (flex-shrink: 0, the SettingsList .row rule). With the default
  // flex-shrink: 1 the blocks were compressed BELOW their content height
  // instead: labels painted on the inputs, the action buttons on the fields,
  // and the scrolling never kicked in. jsdom does not compute class-based
  // styles, so the fix is pinned in the stylesheet source (same pattern as
  // the Bug51 pin in PiServerModal.test.tsx).
  it('pins the CR69 scroll chain in the stylesheet: capped shell, scrolling content, non-shrinking blocks, margin spacing, no raw gap', () => {
    // read from disk: vitest's CSS pipeline intercepts .scss imports, so
    // the file is the only observable form of the rules
    const scss = readFileSync('src/components/SettingsSheet/HaSettingsModal.module.scss', 'utf8')
    // extract a top-level block (brace-balanced — .content nests its child
    // selector)
    const block = (selector: string): string => {
      const start = scss.indexOf(`.${selector} {`)
      expect(start, `${selector} block missing`).toBeGreaterThanOrEqual(0)
      let depth = 0
      let end = -1
      for (let i = start; i < scss.length; i++) {
        if (scss[i] === '{') depth += 1
        else if (scss[i] === '}') {
          depth -= 1
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      expect(end, `${selector} block unbalanced`).toBeGreaterThanOrEqual(0)
      return scss.slice(start, end + 1)
    }
    // the fixed shell: height-capped, and it does NOT scroll itself
    // (Bug10-1 contract — the scrolling lives in .content)
    const card = block('card')
    expect(card).toContain('max-height: calc(100% - #{$s-6});')
    expect(card).not.toContain('overflow')
    // the scroll container: capped flex child with scrolling (Bug10-1) and
    // the Bug51 rule — its direct children never shrink, so they keep
    // their content height and the scroll happens
    const content = block('content')
    expect(content).toContain('flex: 1 1 auto;')
    expect(content).toContain('min-height: 0;')
    expect(content).toContain('overflow-y: auto;')
    expect(content).toMatch(/> \* \{\s*flex-shrink: 0;\s*\}/)
    // CR69/Bug49: the vertical spacing is margin-based (flex-gap-y) — no
    // raw flex `gap` anywhere in the module (Chromium 69 ignores it)
    expect(scss).not.toMatch(/gap\s*:/)
  })
})
