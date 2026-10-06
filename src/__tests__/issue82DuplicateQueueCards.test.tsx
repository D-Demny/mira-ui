// issue #82: BUG: Card Carousel and cache broken — "phantom" song cards that
// keep accumulating ahead of every card list (Playlists, track sub-menus),
// "worse the more I use it".
//
// Root cause: Spotify Connect can deliver a queue in which the same tracks
// repeat many times (a re-queued playlist arrives as a repeating loop in
// next_tracks; observed live on the device: 80 entries, 73 duplicates). Each
// duplicate entry builds a card whose id equals another card's id in the same
// list, and those ids become React keys in ContentCarousel
// (`${categoryId}:${card.id}`). Duplicate-key reconciliation corrupts React's
// commit: some card DOM nodes are unlinked from fiber management but never
// removed from the shared carousel div. The div survives category switches
// (single component instance), so the orphaned 'Läuft gerade' cards resurface
// as a phantom prefix in every later view, and each further queue render adds
// more orphans.
//
// Fix under test (two layers):
//   1. MainMenuView's bug28 sanitization now dedupes the queue by
//      track_id||uri, keeping only the first occurrence (the earliest
//      position stays bug26's in-queue skip target).
//   2. ContentCarousel disambiguates colliding keys with the absolute index —
//      no data source can ever hand its children duplicate React keys again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { NavigationProvider } from '@/navigation/NavigationProvider'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { server } from './msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'
import type { ObserverStatusActive, QueueTrack } from '@/api/types'
import { ContentCarousel } from '@/components/MainMenuView/ContentCarousel'
import type { MenuCard } from '@/components/MainMenuView/mockData'

const q = (trackId: string, name: string, artist: string): QueueTrack => ({
  uri: `spotify:track:${trackId}`,
  track_id: trackId,
  name,
  artist,
  album: '',
  image_url: '',
})

// the real device queue shape: an echo of the active track, a ghost slot, and
// a small loop repeated three times (live observation: 80 entries / 73 dups)
const DUP_STATUS: ObserverStatusActive = {
  active: true,
  device_id: 'dev-1',
  device_name: 'Test PC',
  device_type: 'COMPUTER',
  track_id: 'cur-1',
  track_uri: 'spotify:track:cur-1',
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
  lyrics_url: '/lyrics/cur-1',
  raw_metadata: null,
  received_at: Date.now(),
  next_tracks: [
    q('cur-1', 'Current Track', 'Current Artist'), // echo of the active track (bug28)
    q('a', 'Alpha', 'AA'),
    { uri: 'spotify:track:ghost', track_id: '', name: '', artist: '', album: '', image_url: '' },
    q('b', 'Bravo', 'BB'),
    q('a', 'Alpha', 'AA'), // duplicate of #2
    q('c', 'Charlie', 'CC'),
    q('b', 'Bravo', 'BB'), // duplicate of #4
    q('a', 'Alpha', 'AA'), // third occurrence
  ],
}

// sanitized result: active + one card per unique track, first-occurrence order
const EXPECTED_TITLES = ['Current Track', 'Alpha', 'Bravo', 'Charlie']

let rootEl: HTMLDivElement
let stopSync: (() => void) | null = null
// React's duplicate-key warning (dev builds only) — the exact signature of the
// corrupted reconciliation from issue #82
let keyWarnings: string[] = []

function renderApp() {
  render(
    <NavigationProvider>
      <NotifyProvider>
        <App />
      </NotifyProvider>
    </NavigationProvider>,
    { container: rootEl },
  )
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
  keyWarnings = []
  const realError = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = args.map(String).join(' ')
    if (msg.includes('same key')) {
      keyWarnings.push(msg)
      return
    }
    realError(...args)
  })
  server.use(
    http.get('*/observer/status', () => HttpResponse.json(DUP_STATUS)),
    http.get('*/connect/devices', () => HttpResponse.json([])),
    http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
    http.get('*/lyrics/*', () => new HttpResponse(null, { status: 404 })),
    http.get('*/web-api/me/playlists', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
    ),
    http.get('*/web-api/me/player/recently-played', () => HttpResponse.json({ items: [] })),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  stopSync?.()
  stopSync = null
  rootEl.remove()
})

describe('issue #82: duplicate queue entries must not produce phantom cards', () => {
  it("dedupes 'Läuft gerade' to one card per unique track", { timeout: 30_000 }, async () => {
    renderApp()
    // the app boots into the now-playing screen; both view layers (lyrics +
    // standard) stay mounted for the cross-fade, so the track name matches
    // twice
    await screen.findAllByText('Current Track', undefined, { timeout: 5000 })
    // Escape on the now-playing screen → library menu
    fireEvent.keyDown(window, { key: 'Escape' })
    const nowPlayingBtn = await screen.findByRole('button', { name: 'Läuft gerade' })
    fireEvent.click(nowPlayingBtn)
    await screen.findByText('Alpha')
    for (const title of EXPECTED_TITLES) {
      // exactly one card per unique track — the pre-fix build rendered
      // 'Alpha' three times and 'Bravo' twice
      expect(screen.getAllByText(title)).toHaveLength(1)
    }
    expect(keyWarnings).toEqual([])
  })

  it('never emits duplicate React keys even when a list contains colliding card ids', () => {
    // defense in depth: a data source that ships duplicate ids must not be
    // able to corrupt the carousel's children, so no DOM cards can ever be
    // orphaned again (the phantom prefix from issue #82)
    const cards: MenuCard[] = [
      { id: 'dup', title: 'One', subtitle: 's1' },
      { id: 'dup', title: 'Two', subtitle: 's2' },
      { id: 'solo', title: 'Three', subtitle: 's3' },
    ]
    const view = render(<ContentCarousel cards={cards} categoryId="test" focusedIndex={0} />)
    // re-render so the update reconciliation path is exercised as well
    view.rerender(<ContentCarousel cards={cards} categoryId="test" focusedIndex={1} />)
    expect(screen.getByText('One')).toBeTruthy()
    expect(screen.getByText('Two')).toBeTruthy()
    expect(screen.getByText('Three')).toBeTruthy()
    expect(keyWarnings).toEqual([])
  })
})
