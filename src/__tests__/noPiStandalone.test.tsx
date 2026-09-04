// ticket10-7 task 4 — No-Pi-Integrationsszenarien ("alles tot").
//
// Alle Pi-Endpoints sind tot (Capabilities unerreichbar, alle Daemon-Pi-
// Endpoints 500/503), in beiden Profil-Settings-Varianten:
//   (1) KEIN Profil — echtes Standalone: das Hauptmenü rendert und bleibt
//       interaktiv (Dial-Settings-Öffnen, Pi-Row), mit null Pi-Requests
//       (kein Capabilities-Poll, keine /img/-Requests) und direkter
//       CDN-Artwork-URLs;
//   (2) Profil vorhanden, Pi tot: SettingsSheet + PiServerModal öffnen und
//       schließen ohne Crash / Fehler-State-Blitz; nach den ambienten
//       Poll-Zyklen (Fake-Timer) steht die State-Machine auf standalone mit
//       allen Features false — per Live-Store-Read (D.1-Quirk: das
//       gerenderte `checking` ist nur bei Emit sichtbar, der stille Settle
//       wird nicht re-publishen).
// Dazu:
//   (3) keine unhandled rejections über beide Flows hinweg (die Fallback-
//       Rejections der absichtlich getöteten Fetches muss die App selbst
//       fangen — eine echte wäre ein Bug, kein Test-Hack);
//   (4) der Empty-State nach Deaktivieren (hybridDisabled + keine Profile =
//       kein Polling, keine Pi-Requests).
//
// Konventionen: die Views werden wie die anderen Integrationssuiten direkt
// gerendert (MainMenuView.test.tsx) auf dem geteilten MSW-Server (setup.ts,
// onUnhandledRequest: 'error'); die 30-s-Poll-Zyklen folgen dem
// Fake-Timer-Pattern aus useMiraServer.test.ts (der MSW-Interceptor
// löst Requests über Microtasks auf, die advanceTimersByTimeAsync nur bei
// gefakter Uhr zuverlässig flusht).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MainMenuView } from '@/components/MainMenuView/MainMenuView'
import { SettingsSheet } from '@/components/SettingsSheet'
import { PiServerModal } from '@/components/SettingsSheet/PiServerModal'
import { server } from './msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetHomeLightStore } from '@/hooks/useHomeLight'
import { MIRA_SERVER_POLL_MS, __resetMiraServerState, getMiraServerState } from '@/hooks/useMiraServer'
import { __resetSettings, updateSettings } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'

// the Pi address of the profile seeded in the scenarios — single source of
// truth for the "alles tot" catch-all handler below
const PI_BASE = 'http://192.168.7.1:8080'

const mockPlaylists = [
  {
    id: 'pl-1',
    name: 'Road Trip',
    owner: { display_name: 'Mira Mix' },
    images: [{ url: 'http://img/roadtrip.jpg' }],
    tracks: { total: 12 },
    collaborative: false,
    uri: 'spotify:playlist:pl-1',
  },
  {
    id: 'pl-2',
    name: 'Liked Songs',
    owner: { display_name: 'Mira Mix' },
    images: [{ url: 'http://img/liked.jpg' }],
    tracks: { total: 501 },
    collaborative: false,
    uri: 'spotify:collection:tracks',
  },
]

const mockRecent = [
  {
    track: {
      id: 't-1',
      name: 'Siamese Dream',
      artists: [{ name: 'The Smashing Pumpkins' }],
      album: { name: 'Mellon Collie', images: [{ url: 'http://img/sd.jpg' }] },
      uri: 'spotify:track:t-1',
    },
    played_at: '2026-08-20T10:00:00Z',
  },
]

// like useMiraServer.test.ts: fake only the timer methods (Date stays real)
// so the 30 s poll and the modal's 2 s rhythm become fake timers
type FakeMethod = 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'
const FAKE_CLOCK: { toFake: FakeMethod[] } = {
  toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
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

// "alles tot" (ticket10-7 task 4): the Pi is unreachable and the daemon's
// Pi endpoints error out. The counters on the Pi catch-all handler are the
// assertion target for the "keine Pi-Requests" behavior — any request the
// app still sends to the Pi lands here.
function killPiEndpoints(counters: { capabilities: number; img: number }): void {
  server.use(
    http.get(`${PI_BASE}/*`, ({ request }) => {
      const path = new URL(request.url).pathname
      if (path === '/api/v1/capabilities') counters.capabilities += 1
      if (path.startsWith('/img/')) counters.img += 1
      return HttpResponse.error()
    }),
    http.post('*/api/setup-pi', () => new HttpResponse(null, { status: 500 })),
    http.get('*/api/setup-pi/status', () => new HttpResponse(null, { status: 500 })),
    http.get('*/api/pi/status', () => new HttpResponse(null, { status: 503 })),
    http.post('*/api/pi/tethering', () => new HttpResponse(null, { status: 503 })),
    http.get('*/api/pi/tethering/status', () => new HttpResponse(null, { status: 503 })),
    http.delete('*/api/pi/profile', () => new HttpResponse(null, { status: 503 })),
  )
}

// the profile the "Profil vorhanden"-scenarios seed
function seedProfile(): void {
  updateSettings({
    piProfiles: [
      { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
    ],
    activePiId: 'pi-1',
  })
}

// the error-state strings a dead Pi / dead daemon must NEVER surface in the
// Pi views (KR3: errors stay silent, status only in the Raspberry Pi menu).
// Note: 'Passwort-Login erforderlich' is NOT on this list — it is the
// per-profile key state the profile rows render from the settings store
// (legit while keyInstalled is false); only the header key LINE (a
// successful daemon read) and the error texts below must stay hidden.
const ERROR_STATE_TEXTS = [
  'Key-Setup fehlgeschlagen',
  'Nicht entfernt',
  'The setup failed',
  'could not be started',
  'Verbinde…',
]

function assertNoErrorState(): void {
  const bodyText = document.body.textContent ?? ''
  for (const text of ERROR_STATE_TEXTS) {
    expect(bodyText).not.toContain(text)
  }
}

beforeEach(() => {
  clearCache()
  clearRecentCache()
  clearTracksCache()
  __resetHomeLightStore()
  __resetMiraServerState()
  // the settings store persists to localStorage — start every test from the
  // pristine defaults (fresh install = no profile)
  localStorage.clear()
  __resetSettings()
  server.use(
    http.get('*/web-api/me/playlists', () =>
      HttpResponse.json({
        items: mockPlaylists,
        total: mockPlaylists.length,
        limit: 50,
        offset: 0,
      }),
    ),
    http.get('*/web-api/me/player/recently-played', () =>
      HttpResponse.json({ items: mockRecent }),
    ),
  )
})

describe('ticket10-7 task 4: no profile + all Pi endpoints dead', () => {
  it('the main menu renders and stays interactive with zero Pi requests and CDN artwork', async () => {
    const counters = { capabilities: 0, img: 0 }
    killPiEndpoints(counters)
    const onOpenPiServer = vi.fn()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const { container } = render(<MainMenuView onOpenPiServer={onOpenPiServer} />)
    // the playlist pane loads through the normal (CDN) path
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await screen.findByText('Road Trip')

    // artwork loads directly from the CDN — no Pi /img/ flavoring
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.some((img) => img.getAttribute('src') === 'http://img/roadtrip.jpg')).toBe(true)
    for (const img of imgs) {
      const src = img.getAttribute('src') ?? ''
      expect(src).not.toContain(':8080')
      expect(src).not.toContain('/160.jpg')
    }

    // the Raspberry Pi row shows the standalone state (the row only carries
    // role="button" while focused — address it via its aria-label)
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    const piRow = await screen.findByText('Raspberry Pi')
    expect(piRow.closest('[aria-label="Raspberry Pi"]')?.textContent).toContain('Standalone')

    // interactive: the dial descends into the settings sub-level and back
    confirmDial() // the focused 'Settings' row (index 0)
    await screen.findByText('Display Size')
    pressBack()
    screen.getByText('Raspberry Pi')

    // … and reaches the Raspberry Pi row, which opens the provisioning view
    for (let i = 0; i < 6; i += 1) wheel(-10) // 'Settings' (0) → 'Raspberry Pi' (6)
    confirmDial()
    expect(onOpenPiServer).toHaveBeenCalledTimes(1)

    // zero Pi traffic across the whole flow: no capability poll, no /img/
    expect(counters.capabilities).toBe(0)
    expect(counters.img).toBe(0)
    // … and no ambient 30 s poll started at all (fresh install stays
    // standalone WITHOUT polling, ticket10-5A)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), MIRA_SERVER_POLL_MS)
    setIntervalSpy.mockRestore()
  })

  it('hybrid disabled + no profile: fresh standalone with no poll and no Pi requests', async () => {
    // the deliberate end state of "Deaktivieren" (KR4): the flag is set and
    // no profile remains — nothing may poll or request
    const counters = { capabilities: 0, img: 0 }
    killPiEndpoints(counters)
    updateSettings({ hybridDisabled: true })
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await screen.findByText('Road Trip')
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    const piRow = await screen.findByText('Raspberry Pi')
    expect(piRow.closest('[aria-label="Raspberry Pi"]')?.textContent).toContain('Standalone')

    await new Promise((r) => setTimeout(r, 100))
    expect(counters.capabilities).toBe(0)
    expect(counters.img).toBe(0)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), MIRA_SERVER_POLL_MS)
    setIntervalSpy.mockRestore()
  })
})

describe('ticket10-7 task 4: profile exists + Pi dead', () => {
  it('SettingsSheet + PiServerModal open and close without an error-state flash and settle on standalone after the poll cycles', async () => {
    // The real timers come back in the finally — a mid-test assertion
    // failure must not leak the fake clock into the next test.
    vi.useFakeTimers(FAKE_CLOCK)
    const counters = { capabilities: 0, img: 0 }
    killPiEndpoints(counters)
    seedProfile()
    const onClose = vi.fn()
    const onCloseSheet = vi.fn()
    const modal = render(<PiServerModal onClose={onClose} onOpenKeyboard={vi.fn()} />)
    const sheet = render(<SettingsSheet open onClose={onCloseSheet} />)

    try {
      // the mount-time capabilities check (profile present) settles on the
      // dead Pi; the dead daemon probe (500) is caught — no key/session line
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('Getrennt (Standalone)')).toBeInTheDocument()
      assertNoErrorState()
      // the settings sheet itself is untouched by the Pi state
      expect(sheet.getByText('Settings')).toBeInTheDocument()
      expect(sheet.getByText('Display size')).toBeInTheDocument()

      // two ambient 30 s poll cycles over the dead Pi
      for (let i = 0; i < 2; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
        })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
      }

      // live store read (D.1-Quirk: the silent settle is NOT re-published,
      // so the rendered checking flag is not the observation channel)
      expect(getMiraServerState()).toEqual({
        mode: 'standalone',
        features: { diskCache: false, remoteColors: false, remoteBlur: false },
        checking: false,
      })
      // … and the UI never flashed an error state during the cycles
      expect(screen.getByText('Getrennt (Standalone)')).toBeInTheDocument()
      assertNoErrorState()

      // close both overlays without a crash: the modal's Close button fires
      // its callback, then the App would unmount (mirrored here)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      act(() => {
        sheet.rerender(<SettingsSheet open={false} onClose={onCloseSheet} />)
      })
      modal.unmount()
      sheet.unmount()
    } finally {
      vi.useRealTimers()
    }

    // exactly one capabilities request per ambient cycle: the mount check
    // + the two 30 s ticks — the poll is the only ambient Pi activity
    expect(counters.capabilities).toBe(3)
    // features stayed false, so no Pi artwork route was ever requested
    expect(counters.img).toBe(0)
  })
})

describe('ticket10-7 task 4: no unhandled rejections', () => {
  it('flows 1+2 leak no unhandled rejection (the dead fetches are caught by the app)', async () => {
    const windowRejections: unknown[] = []
    const processRejections: unknown[] = []
    const onWindowRejection = (e: PromiseRejectionEvent) => {
      windowRejections.push(e.reason)
    }
    const onProcessRejection = (reason: unknown) => {
      processRejections.push(reason)
    }
    window.addEventListener('unhandledrejection', onWindowRejection)
    process.on('unhandledRejection', onProcessRejection)

    try {
      // flow 1: no profile, interactive main menu (real timers)
      const counters1 = { capabilities: 0, img: 0 }
      killPiEndpoints(counters1)
      const menu = render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Raspberry Pi')
      confirmDial()
      await screen.findByText('Display Size')
      menu.unmount()
      // give any (bad) rejection time to surface on the event loop
      await new Promise((r) => setTimeout(r, 50))

      // flow 2: profile + dead Pi through the ambient poll cycles
      const counters2 = { capabilities: 0, img: 0 }
      killPiEndpoints(counters2)
      seedProfile()
      let modal: ReturnType<typeof render>
      try {
        vi.useFakeTimers(FAKE_CLOCK)
        modal = render(<PiServerModal onClose={vi.fn()} onOpenKeyboard={vi.fn()} />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
        })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        modal.unmount()
      } finally {
        vi.useRealTimers()
      }
    } finally {
      window.removeEventListener('unhandledrejection', onWindowRejection)
      process.off('unhandledRejection', onProcessRejection)
    }

    // final flush: an unhandled rejection reports on a later event-loop turn
    await new Promise((r) => setTimeout(r, 100))
    expect(windowRejections).toEqual([])
    expect(processRejections).toEqual([])
  })
})
