// issue #56: confirming a Liked Songs track in the main menu must never leave
// the user staring at stale 'Läuft gerade' cards when the daemon refuses the
// play (unresolved liked-songs context). App.onPlayFromMenu now toasts the
// failure and keeps the rejection, and MainMenuView only switches to the
// Now-Playing pane once the play request actually resolved.
//
// Flow under test: now-playing screen → Escape opens the library menu →
// Playlists → Liked Songs track list → confirm 'Faded' → POST /player/play.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { NavigationProvider } from '@/navigation/navigationContext'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { server } from './msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'
import type { ObserverStatusActive } from '@/api/types'

// an active session so the app boots straight into the now-playing screen
// (the default /observer/status stub reports no session)
const ACTIVE_STATUS: ObserverStatusActive = {
  active: true,
  device_id: 'dev-1',
  device_name: 'Test PC',
  device_type: 'COMPUTER',
  track_id: 'np-1',
  track_uri: 'spotify:track:np-1',
  track_name: 'Current Track',
  track_artist: 'Current Artist',
  track_album: 'Current Album',
  track_image: 'http://img/np.jpg',
  context_uri: 'spotify:playlist:np-ctx',
  context_name: 'Now Playing Context',
  duration: 200000,
  position: 60000,
  is_playing: true,
  is_paused: false,
  shuffle: false,
  repeat_context: false,
  repeat_track: false,
  lyrics_url: '/lyrics/np-1',
  raw_metadata: null,
  received_at: Date.now(),
}

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
    {
      is_local: false,
      track: {
        id: 'lk-2',
        name: 'Lean On',
        uri: 'spotify:track:lk-2',
        artists: [{ name: 'Major Lazer' }],
        album: { name: 'Peace Is the Mission', images: [{ url: 'http://img/lk2.jpg' }] },
        position: 1,
      },
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
  next: null,
}

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

// Escape on the now-playing screen → App.goBack opens the library menu, then
// walk Playlists → Liked Songs until 'Faded' is confirmable in the track list
async function openLikedSongsTrack() {
  fireEvent.keyDown(window, { key: 'Escape' })
  const playlistsBtn = await screen.findByRole('button', { name: 'Playlists' })
  fireEvent.click(playlistsBtn)
  fireEvent.click(await screen.findByText('Liked Songs'))
  await screen.findByText('Faded')
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  clearCache()
  clearRecentCache()
  clearTracksCache()
  rootEl = document.createElement('div')
  rootEl.id = 'root'
  document.body.appendChild(rootEl)
  stopSync = startUiScaleSync()
  server.use(
    http.get('*/observer/status', () => HttpResponse.json(ACTIVE_STATUS)),
    http.get('*/connect/devices', () => HttpResponse.json([])),
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
})

describe('issue #56: Liked Songs play failure surfaces in the main menu', () => {
  // the full App boots through status polling before the flow starts, so the
  // per-test budget needs headroom (vitest 4 takes options as second arg)
  it(
    'toasts the failure and stays in the track sub-menu when POST /player/play fails',
    { timeout: 30_000 },
    async () => {
      let playHits = 0
      server.use(
        http.post('*/player/play', () => {
          playHits++
          return new HttpResponse(null, { status: 500 })
        }),
      )

      renderApp()
      // the app boots straight into the now-playing screen for the active session;
      // both view layers (lyrics + standard) stay mounted for the cross-fade, so
      // the track name appears twice — AllBy* is required
      await screen.findAllByText('Current Track', undefined, { timeout: 5000 })
      await openLikedSongsTrack()
      fireEvent.click(screen.getByText('Faded'))

      // the play request lands and is refused by the daemon
      await waitFor(() => expect(playHits).toBeGreaterThan(0))
      // App.onPlayFromMenu surfaces the failure like the preset buttons do
      await screen.findByText("Couldn't start playback", undefined, { timeout: 5000 })
      // and the menu must NOT have flipped to the 'Läuft gerade' pane — the
      // track sub-menu (stale-queue risk) stays on screen
      expect(screen.getByText('Faded')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Läuft gerade' })).not.toHaveAttribute(
        'aria-current',
        'true',
      )
    },
  )

  it(
    'switches to Now Playing without a failure toast when POST /player/play succeeds',
    { timeout: 30_000 },
    async () => {
      server.use(http.post('*/player/play', () => HttpResponse.json({})))

      renderApp()
      // both view layers stay mounted (cross-fade) → the track name matches twice
      await screen.findAllByText('Current Track', undefined, { timeout: 5000 })
      await openLikedSongsTrack()
      fireEvent.click(screen.getByText('Faded'))

      // the pane follows the successful play request
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
            'aria-current',
            'true',
          )
        },
        { timeout: 5000 },
      )
      // no failure toast on the happy path
      expect(screen.queryByText("Couldn't start playback")).not.toBeInTheDocument()
    },
  )
})
