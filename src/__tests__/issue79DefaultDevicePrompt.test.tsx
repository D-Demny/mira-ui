// issue #79: with a default device configured, playback interactions (pause /
// play / track selection) must open the default-device prompt BEFORE running.
// Yes = run + transfer to the default; No = run only, suppress 10 minutes;
// Back/close = nothing runs.
//
// Setup: active session on 'dev-1' (Office PC), stored default is 'dev-2'
// (Living Room), so every interaction defers behind the prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { NavigationProvider } from '@/navigation/NavigationProvider'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { ListFocusContext } from '@/navigation/listFocusContext'
import { server } from './msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings, updateSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'
import type { ConnectDevice, ObserverStatusActive } from '@/api/types'

const ACTIVE_STATUS: ObserverStatusActive = {
  active: true,
  device_id: 'dev-1',
  device_name: 'Office PC',
  device_type: 'COMPUTER',
  track_id: 'np-1',
  track_uri: 'spotify:track:np-1',
  track_name: 'Current Track',
  track_artist: 'Current Artist',
  track_album: 'Current Album',
  track_image: 'http://img/np.jpg',
  context_uri: 'spotify:playlist:np-ctx',
  context_name: 'Now Playing Context',
  duration: 200_000,
  position: 60_000,
  is_playing: true,
  is_paused: false,
  shuffle: false,
  repeat_context: false,
  repeat_track: false,
  lyrics_url: '/lyrics/np-1',
  raw_metadata: null,
  received_at: Date.now(),
}

const DEVICES_FIXTURE: ConnectDevice[] = [
  {
    id: 'dev-1',
    name: 'Office PC',
    type: 'COMPUTER',
    volume: 60,
    volume_steps: 100,
    volume_disabled: false,
    is_active: true,
    is_offline: false,
    can_transfer: true,
  },
  {
    id: 'dev-2',
    name: 'Living Room',
    type: 'SPEAKER',
    volume: 50,
    volume_steps: 10,
    volume_disabled: false,
    is_active: false,
    is_offline: false,
    can_transfer: true,
  },
]

const PLAYLISTS_FIXTURE = {
  items: [
    {
      id: 'spotify:collection:tracks',
      name: 'Liked Songs',
      owner: { display_name: 'Spotify' },
      images: [{ url: 'http://img/liked.jpg' }],
      tracks: { total: 2 },
      collaborative: false,
      uri: 'spotify:collection:tracks',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
}

const LIKED_TRACKS_FIXTURE = {
  items: [
    {
      is_local: false,
      track: {
        id: 'lk-1',
        name: 'Faded',
        uri: 'spotify:track:lk-1',
        artists: [{ name: 'Alan Walker' }],
        album: { name: 'Faded', images: [{ url: 'http://img/lk.jpg' }] },
        position: 0,
      },
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
  next: null,
}

const PROMPT_TEXT = 'Continue playing on Living Room?'

let rootEl: HTMLDivElement
let stopSync: (() => void) | null = null

function renderApp() {
  return render(
    <NavigationProvider>
      <NotifyProvider>
        <App />
      </NotifyProvider>
    </NavigationProvider>,
    { container: rootEl },
  )
}

// Escape on the now-playing screen → library menu → Playlists → Liked Songs
async function openLikedSongsTrack() {
  fireEvent.keyDown(window, { key: 'Escape' })
  const playlistsBtn = await screen.findByRole('button', { name: 'Playlists' })
  fireEvent.click(playlistsBtn)
  fireEvent.click(await screen.findByText('Liked Songs'))
  await screen.findByText('Faded')
}

function dialWheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({
      deltaX,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent)
  })
}

function dialConfirm() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  updateSettings({ defaultDeviceId: 'dev-2' })
  clearCache()
  clearRecentCache()
  clearTracksCache()
  rootEl = document.createElement('div')
  rootEl.id = 'root'
  document.body.appendChild(rootEl)
  stopSync = startUiScaleSync()
  server.use(
    http.get('*/observer/status', () => HttpResponse.json(ACTIVE_STATUS)),
    http.get('*/settings', () => HttpResponse.json({ v: 3, defaultDeviceId: 'dev-2' })),
    http.get('*/connect/devices', () => HttpResponse.json({ devices: DEVICES_FIXTURE })),
    http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
    http.get('*/lyrics/*', () => new HttpResponse(null, { status: 404 })),
    http.get('*/web-api/me/playlists', () => HttpResponse.json(PLAYLISTS_FIXTURE)),
    http.get('*/web-api/me/player/recently-played', () => HttpResponse.json({ items: [] })),
    http.get('*/web-api/me/tracks', () => HttpResponse.json(LIKED_TRACKS_FIXTURE)),
  )
})

afterEach(() => {
  stopSync?.()
  stopSync = null
  rootEl.remove()
  ListFocusContext.setActive(null)
})

describe('issue #79: default device switch prompt', () => {
  // the full App boots through status polling before the flow starts, so the
  // per-test budget needs headroom (vitest 4 takes options as second arg)
  it(
    'defers pause behind the prompt; Yes runs the command AND transfers to the default',
    { timeout: 30_000 },
    async () => {
      let pauseHits = 0
      const transfers: string[] = []
      server.use(
        http.post('*/player/pause', () => {
          pauseHits++
          return HttpResponse.json({})
        }),
        http.post('*/connect/transfer', async ({ request }) => {
          // the hook sends exactly this shape; validated field at the boundary
          const body = (await request.json()) as { device_id?: string }
          transfers.push(body.device_id ?? '')
          return HttpResponse.json({ ok: true })
        }),
      )

      renderApp()
      // both view layers (lyrics + standard) stay mounted for the cross-fade
      await screen.findAllByText('Current Track', undefined, { timeout: 5000 })

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
      await screen.findByText(PROMPT_TEXT, undefined, { timeout: 5000 })
      // deferred: nothing was sent while the user decides
      expect(pauseHits).toBe(0)

      // focus starts on 'Yes' — one dial press accepts (run + switch)
      dialConfirm()
      await waitFor(() => expect(pauseHits).toBeGreaterThan(0))
      await waitFor(() => expect(transfers).toEqual(['dev-2']))
      expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument()
    },
  )

  it(
    'No runs the command without a transfer and suppresses the prompt',
    { timeout: 30_000 },
    async () => {
      let pauseHits = 0
      let resumeHits = 0
      const transfers: string[] = []
      server.use(
        http.post('*/player/pause', () => {
          pauseHits++
          return HttpResponse.json({})
        }),
        http.post('*/player/resume', () => {
          resumeHits++
          return HttpResponse.json({})
        }),
        http.post('*/connect/transfer', async ({ request }) => {
          transfers.push(request.url)
          return HttpResponse.json({ ok: true })
        }),
      )

      renderApp()
      await screen.findAllByText('Current Track', undefined, { timeout: 5000 })

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
      await screen.findByText(PROMPT_TEXT, undefined, { timeout: 5000 })
      dialWheel(-10) // down to 'No'
      dialConfirm()

      // decline: the interaction still runs, but playback stays on dev-1
      await waitFor(() => expect(pauseHits).toBeGreaterThan(0))
      expect(transfers).toEqual([])
      expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument()

      // inside the 10-minute window the next press goes straight through —
      // the optimistic flip already shows 'Play'
      fireEvent.click(screen.getByRole('button', { name: 'Play' }))
      await waitFor(() => expect(resumeHits).toBeGreaterThan(0))
      expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument()
    },
  )

  it('closing the prompt (back) runs nothing', { timeout: 30_000 }, async () => {
    let pauseHits = 0
    server.use(
      http.post('*/player/pause', () => {
        pauseHits++
        return HttpResponse.json({})
      }),
    )

    renderApp()
    await screen.findAllByText('Current Track', undefined, { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await screen.findByText(PROMPT_TEXT, undefined, { timeout: 5000 })
    act(() => {
      ListFocusContext.entry.onBack?.()
    })

    expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument()
    // a close is not a decline: the deferred pause never happened
    expect(pauseHits).toBe(0)
  })

  it(
    'a menu track selection defers behind the prompt; cancel plays nothing',
    { timeout: 30_000 },
    async () => {
      let playHits = 0
      server.use(
        http.post('*/player/play', () => {
          playHits++
          return HttpResponse.json({})
        }),
      )

      renderApp()
      await screen.findAllByText('Current Track', undefined, { timeout: 5000 })
      await openLikedSongsTrack()
      fireEvent.click(screen.getByText('Faded'))

      await screen.findByText(PROMPT_TEXT, undefined, { timeout: 5000 })
      expect(playHits).toBe(0)

      act(() => {
        ListFocusContext.entry.onBack?.()
      })
      expect(screen.queryByText(PROMPT_TEXT)).not.toBeInTheDocument()

      // still nothing played — and (issue #56 contract) the menu pane has not
      // switched to 'Läuft gerade', it stays on the track list
      expect(playHits).toBe(0)
      expect(screen.getByText('Faded')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Läuft gerade' })).not.toHaveAttribute(
        'aria-current',
        'true',
      )
    },
  )
})
