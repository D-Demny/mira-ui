import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MainMenuView } from '../MainMenuView'
import { MENU_CATEGORIES } from '../mockData'
import type { ObserverStatusActive } from '@/api/types'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { HOME_LIGHTS, __resetHomeLightStore } from '@/hooks/useHomeLight'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import { __resetHomeEntityStores, SELECTION_LS_KEY } from '@/hooks/useHomeEntities'
import { __resetMiraServerState, checkMiraServer } from '@/hooks/useMiraServer'
import { clearColorCache, seedColorCache, darkBg, rgba } from '@/hooks/useColorExtract'
import { __resetSettings, getSettings, updateSettings } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'
import { __resetWarmedArt, hasWarmedArt } from '../warmedArt'
import { dialScrollLeft } from '../carouselWindow'

const mockPlaylists = [
  {
    id: 'pl-1',
    name: 'Road Trip',
    owner: { display_name: 'Mira Mix' },
    images: [{ url: 'http://img/r.jpg' }],
    tracks: { total: 12 },
    collaborative: false,
    uri: 'spotify:playlist:pl-1',
  },
  {
    id: 'pl-2',
    name: 'Workout',
    owner: { display_name: 'Mira Mix' },
    images: [],
    tracks: { total: 8 },
    collaborative: false,
    uri: 'spotify:playlist:pl-2',
  },
  // bug22: the Liked Songs pseudo-playlist (kept last so the playlist-card
  // focus math of the existing tests stays unchanged)
  {
    id: 'spotify:collection:tracks',
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
      album: { name: 'Mellon Collie', images: [{ url: 'http://img/s.jpg' }] },
      uri: 'spotify:track:t-1',
    },
    played_at: '2026-08-20T10:00:00Z',
  },
]

const nowPlaying: ObserverStatusActive = {
  active: true,
  device_id: 'device-1',
  device_name: 'Mira',
  device_type: 'speaker',
  track_id: 't-9',
  track_uri: 'spotify:track:t-9',
  track_name: 'Heat Waves',
  track_artist: 'Glass Animals',
  track_album: 'Heat Waves',
  track_image: 'http://img/h.jpg',
  context_uri: 'spotify:context:1',
  context_name: 'Chill',
  duration: 200,
  position: 10,
  is_playing: true,
  is_paused: false,
  shuffle: false,
  repeat_context: false,
  repeat_track: false,
  lyrics_url: '',
  received_at: 0,
  next_tracks: [],
}

// the 'Läuft gerade' fixture with an upcoming queue (bug3) — the queue belongs
// to a playlist context so bug26's in-queue skip can be asserted
const queueNowPlaying: ObserverStatusActive = {
  ...nowPlaying,
  context_uri: 'spotify:playlist:queue-pl',
  next_tracks: [
    {
      uri: 'spotify:track:t-10',
      track_id: 't-10',
      name: 'Next Song',
      artist: 'Someone',
      album: '',
      image_url: '',
    },
    {
      uri: 'spotify:track:t-11',
      track_id: 't-11',
      name: 'Song After',
      artist: 'Another',
      album: '',
      image_url: '',
    },
  ],
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

// jsdom gives every element a zero-sized rect and no pointer capture, so the
// NotchedSlider drag handlers need both patched (same approach as
// SettingsSheet.test.tsx)
function stubBar(el: HTMLElement, left = 100, width = 300): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      width,
      right: left + width,
      top: 0,
      bottom: 40,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  el.setPointerCapture = () => undefined
  el.releasePointerCapture = () => undefined
  el.hasPointerCapture = () => false
}

describe('MainMenuView', () => {
  beforeEach(() => {
    clearCache()
    clearRecentCache()
    clearTracksCache()
    clearColorCache()
    // bug46: the per-entity home-light store (incl. its in-flight dedup) is
    // module-level — a fast-unmounted previous test can leave a fetch in
    // flight that resolves against the PREVIOUS test's MSW handlers and
    // re-seeds the store (stale dimmable capability)
    __resetHomeLightStore()
    // ticket 9.3: the entity selection/catalog/state stores are module-level
    // (the selection falls back to localStorage) — reset both so every test
    // starts from the default HOME_LIGHTS selection
    __resetHomeEntityStores()
    // bug45 option C: the warmed-art set is module-level — reset it per test
    // so the bug8.2 pre-decode assertions start from a fresh session
    __resetWarmedArt()
    // epic10: the Pi server store is module-level — reset it per test so the
    // 'Raspberry Pi' row starts from the standalone default
    __resetMiraServerState()
    // bug25: the settings store persists to localStorage — start every test
    // from the pristine defaults
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
      http.get('*/web-api/playlists/:id/tracks', ({ params }) =>
        HttpResponse.json({
          items: [
            {
              is_local: false,
              track: {
                id: `tr-${params.id}-1`,
                name: `Track 1 of ${params.id}`,
                uri: `spotify:track:tr-${params.id}-1`,
                artists: [{ name: 'Someone' }],
                album: { name: 'An Album', images: [{ url: 'http://img/tr.jpg' }] },
                position: 0,
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          next: null,
        }),
      ),
      // bug22: Liked Songs pages from me/tracks
      http.get('*/web-api/me/tracks', () =>
        HttpResponse.json({
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
        }),
      ),
    )
  })

  it('renders the split-screen shell with sidebar and content panes', () => {
    render(<MainMenuView />)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders every sidebar category label', () => {
    render(<MainMenuView />)
    for (const category of MENU_CATEGORIES) {
      expect(screen.getByRole('button', { name: category.label })).toBeInTheDocument()
    }
  })

  it('marks the active item with aria-current and a white pill', () => {
    const { container } = render(<MainMenuView />)
    const home = screen.getByRole('button', { name: 'Home' })
    expect(home).toHaveAttribute('aria-current', 'true')
    expect(container.querySelector('.pill')).not.toBeNull()
    const playlists = screen.getByRole('button', { name: 'Playlists' })
    expect(playlists).not.toHaveAttribute('aria-current')
  })

  it('moves the active indicator when another category is selected', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(screen.getByRole('button', { name: 'Playlists' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('starts in the sidebar pane with the first sidebar item focused', () => {
    const { container } = render(<MainMenuView />)
    expect(container.querySelector('.sidebarFocus')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveClass('itemFocused')
  })

  it('rotates the dial vertically while in the sidebar pane', () => {
    render(<MainMenuView />)

    wheel(-10)
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveClass('itemFocused')

    wheel(-10)
    expect(screen.getByRole('button', { name: 'Playlists' })).toHaveClass('itemFocused')

    wheel(10)
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveClass('itemFocused')
  })

  it('switches from the sidebar pane to the content pane on dial confirm', async () => {
    const { container } = render(<MainMenuView />)

    wheel(-10)
    wheel(-10)
    confirmDial()

    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
    expect(container.querySelector('.contentFocus')).not.toBeNull()
    expect(screen.getByText('Road Trip').closest('.card')).toHaveClass('cardFocused')
  })

  it('rotates the dial horizontally while in the content pane', async () => {
    render(<MainMenuView />)

    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    wheel(-10)

    expect(screen.getByText('Workout').closest('.card')).toHaveClass('cardFocused')
    expect(screen.getByText('Road Trip').closest('.card')).not.toHaveClass('cardFocused')
  })

  it('bug20: confirming Läuft gerade in the sidebar opens the queue pane instead of exiting', async () => {
    const onExit = vi.fn()
    const { container } = render(<MainMenuView onExit={onExit} />)

    wheel(-10) // focus 'Läuft gerade'
    confirmDial()

    expect(onExit).not.toHaveBeenCalled()
    expect(container.querySelector('.contentFocus')).not.toBeNull()
    // no session: the queue pane shows the idle placeholder
    expect(await screen.findByText('Nichts läuft')).toBeInTheDocument()
  })

  it('returns from content to sidebar on back and exits on the second back', () => {
    const onExit = vi.fn()
    const { container } = render(<MainMenuView onExit={onExit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(container.querySelector('.contentFocus')).not.toBeNull()

    pressBack()
    expect(onExit).not.toHaveBeenCalled()
    expect(container.querySelector('.sidebarFocus')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Playlists' })).toHaveClass('itemFocused')

    pressBack()
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('opens the track list when a playlist is confirmed and plays the focused track with playlist context (bug4, bug16)', async () => {
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)

    wheel(-10)
    wheel(-10)
    confirmDial()
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    // confirming the playlist opens its track list instead of playing it
    confirmDial()
    await waitFor(() => expect(screen.getByText('Track 1 of pl-1')).toBeInTheDocument())
    expect(onPlay).not.toHaveBeenCalled()

    // confirming the focused track plays the parent playlist context starting at
    // the track's position, keeping the rest of the playlist in the queue (bug16)
    confirmDial()
    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl-1', {
      position: 0,
      uri: 'spotify:track:tr-pl-1-1',
    })
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('plays a later track of the playlist at its absolute position instead of track #1 (bug29)', async () => {
    server.use(
      http.get('*/web-api/playlists/pl-1/tracks', () =>
        HttpResponse.json({
          items: [
            {
              is_local: false,
              track: {
                id: 'lp-1',
                name: 'Numb',
                uri: 'spotify:track:lp-1',
                artists: [{ name: 'Linkin Park' }],
                position: 0,
              },
            },
            {
              is_local: false,
              track: {
                id: 'lp-2',
                name: 'Faint',
                uri: 'spotify:track:lp-2',
                artists: [{ name: 'Linkin Park' }],
                position: 1,
              },
            },
            {
              is_local: false,
              track: {
                id: 'lp-3',
                name: 'In the End',
                uri: 'spotify:track:lp-3',
                artists: [{ name: 'Linkin Park' }],
                position: 2,
              },
            },
          ],
          total: 3,
          limit: 50,
          offset: 0,
          next: null,
        }),
      ),
    )
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)

    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await screen.findByText('Road Trip')
    fireEvent.click(screen.getByText('Road Trip'))
    await screen.findByText('In the End')
    fireEvent.click(screen.getByText('In the End'))

    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl-1', {
      position: 2,
      uri: 'spotify:track:lp-3',
    })
  })

  it('does not leak track cards into other categories after closing the track sub-menu (bug15)', async () => {
    render(<MainMenuView />)

    // enter the playlists content pane
    wheel(-10)
    wheel(-10)
    confirmDial()
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    // open the playlist's track sub-menu
    confirmDial()
    await waitFor(() => expect(screen.getByText('Track 1 of pl-1')).toBeInTheDocument())

    // back out of the track sub-menu (returns to the playlist list)
    pressBack()
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    // back to the sidebar, then move over to 'Einstellungen'
    pressBack()
    wheel(-10)
    wheel(-10)
    confirmDial()
    await waitFor(() => expect(screen.getByText('Show Lyrics')).toBeInTheDocument())

    // strictly the settings rows — no leftover track cards (bug15)
    expect(screen.queryByText('Track 1 of pl-1')).not.toBeInTheDocument()
  })

  it('exposes carousel cards as accessible buttons', async () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Road Trip' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Road Trip' })).toHaveClass('card')
  })

  describe('bug8: lightweight category background', () => {
    it('drives the background from the static category colors, not the focused card art', async () => {
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const home = MENU_CATEGORIES[0]

      expect(view.style.getPropertyValue('--menu-bg')).toBe(home.bg)
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(home.accent.a)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

      const playlists = MENU_CATEGORIES.find((category) => category.id === 'playlists')!
      expect(view.style.getPropertyValue('--menu-bg')).toBe(playlists.bg)
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(playlists.accent.a)

      // rotating within the category never touches the background (no per-card repaint)
      wheel(-10)
      expect(view.style.getPropertyValue('--menu-bg')).toBe(playlists.bg)
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(playlists.accent.a)
    })

    it('keeps the static slate background in the settings view', () => {
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const settingsCategory = MENU_CATEGORIES.find((category) => category.id === 'settings')!

      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))

      expect(view.style.getPropertyValue('--menu-bg')).toBe(settingsCategory.bg)
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(settingsCategory.accent.a)
    })
  })

  describe('bug1: live sidebar preview', () => {
    it('updates the carousel immediately while rotating the sidebar dial, without confirming', async () => {
      render(<MainMenuView />)
      expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()

      // rotate down to 'Playlists' (no dial press)
      wheel(-10)
      wheel(-10)

      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      expect(screen.queryByText('3er Stehlampe Gold')).not.toBeInTheDocument()

      // focus stayed strictly on the sidebar
      expect(screen.getByRole('button', { name: 'Playlists' })).toHaveClass('itemFocused')
    })

    it('previews Läuft gerade with the currently playing track while keeping sidebar focus', async () => {
      const { container } = render(<MainMenuView nowPlaying={nowPlaying} />)

      wheel(-10)

      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(container.querySelector('.sidebarFocus')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveClass('itemFocused')
    })

    it('bug20: confirming Läuft gerade opens the queue pane with the current track', async () => {
      const onExit = vi.fn()
      const { container } = render(<MainMenuView nowPlaying={nowPlaying} onExit={onExit} />)

      wheel(-10)
      confirmDial()

      expect(onExit).not.toHaveBeenCalled()
      expect(container.querySelector('.contentFocus')).not.toBeNull()
      expect(await screen.findByText('Heat Waves')).toBeInTheDocument()
    })

    it('bug20: confirming card 0 inside the Läuft gerade queue exits to the player', async () => {
      const onExit = vi.fn()
      const onPlay = vi.fn()
      render(<MainMenuView nowPlaying={nowPlaying} onPlay={onPlay} onExit={onExit} />)

      // enter the now-playing content pane via the sidebar
      wheel(-10)
      confirmDial()
      expect(onExit).not.toHaveBeenCalled()

      // confirming the focused current-track card (index 0) exits to the player
      confirmDial()
      expect(onExit).toHaveBeenCalledTimes(1)
      expect(onPlay).not.toHaveBeenCalled()
    })

    it('keeps content focus on the first card when the sidebar item changes', async () => {
      render(<MainMenuView />)

      // enter Playlists, move the content focus to the second card
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      wheel(-10)
      expect(screen.getByText('Workout').closest('.card')).toHaveClass('cardFocused')

      // back to the sidebar, then focus 'Zuletzt'
      pressBack()
      wheel(-10)

      // the preview shows the recent tracks again, starting at the first card
      expect(screen.getByText('Siamese Dream')).toBeInTheDocument()
      expect(screen.queryByText('Workout')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Zuletzt' })).toHaveClass('itemFocused')
    })
  })

  describe('bug2: card spacing & centering', () => {
    it('centers the focused card with inline center while dialing through the carousel', async () => {
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
      render(<MainMenuView />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

      wheel(-10)
      expect(screen.getByText('Workout').closest('.card')).toHaveClass('cardFocused')
      // bug47: wheel ticks scroll the focus into view INSTANTLY — restarting
      // a smooth animation on every 35 ms tick was the sustained-jank root
      // cause (and kept the scroll far behind the focus, bug48)
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'auto', inline: 'center' })
      const lastEl = scrollSpy.mock.instances.at(-1)
      expect(lastEl).toBe(screen.getByText('Workout').closest('.card'))
      scrollSpy.mockRestore()
    })
  })

  describe('bug47: dial scrolls instantly, tap & confirm keep the smooth scroll', () => {
    it('a wheel tick in the content pane scrolls the focus in with behavior auto', async () => {
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      scrollSpy.mockClear()

      wheel(-10)
      expect(screen.getByText('Workout').closest('.card')).toHaveClass('cardFocused')
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'auto', inline: 'center' })

      // consecutive ticks stay instant
      scrollSpy.mockClear()
      wheel(-10)
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'auto', inline: 'center' })
      scrollSpy.mockRestore()
    })

    it('a card tap keeps the smooth scroll', async () => {
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
      render(<MainMenuView />)
      // enter the Home content pane (action cards: a tap toggles, no navigation)
      fireEvent.click(screen.getByRole('button', { name: 'Home' }))
      await waitFor(() =>
        expect(screen.getByText('Esstisch Hängelampe')).toBeInTheDocument(),
      )
      scrollSpy.mockClear()

      // tap the (non-focused) second light card
      fireEvent.click(screen.getByText('Esstisch Hängelampe'))
      expect(screen.getByText('Esstisch Hängelampe').closest('.card')).toHaveClass('cardFocused')
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
      scrollSpy.mockRestore()
    })

    it('a category switch (sidebar confirm) keeps the smooth scroll', async () => {
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      // back to the sidebar ...
      pressBack()
      scrollSpy.mockClear()
      // ... and re-confirm the sidebar selection: the category entry is a jump
      confirmDial()
      expect(screen.getByText('Road Trip').closest('.card')).toHaveClass('cardFocused')
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
      scrollSpy.mockRestore()
    })
  })

  describe('bug48: pre-decode limited to the focus band (PREDECODE_RADIUS 20)', () => {
    // 100 tracks for pl-1 — long enough that the ±20 band is a strict subset
    // of the list (the device's 501-track Liked Songs list, scaled down)
    const LONG_TRACKS = Array.from({ length: 100 }, (_, i) => ({
      is_local: false,
      track: {
        id: `lt-${i}`,
        name: `Band Track ${i}`,
        uri: `spotify:track:lt-${i}`,
        artists: [{ name: 'Someone' }],
        album: { name: 'An Album', images: [{ url: `http://img/band-${i}.jpg` }] },
        position: i,
      },
    }))

    it('warms only focus ± 20 of the displayed track list, not the whole list', async () => {
      server.use(
        http.get('*/web-api/playlists/pl-1/tracks', () =>
          HttpResponse.json({
            items: LONG_TRACKS,
            total: 100,
            limit: 50,
            offset: 0,
            next: null,
          }),
        ),
      )
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      fireEvent.click(screen.getByText('Road Trip'))
      await screen.findByText('Band Track 0')

      // focus is on track 0: the warmed band is [0, 21) — the pre-decode no
      // longer front-loads all 100 covers into Chromium's image cache
      await waitFor(() => expect(hasWarmedArt('http://img/band-20.jpg')).toBe(true))
      expect(hasWarmedArt('http://img/band-21.jpg')).toBe(false)
      expect(hasWarmedArt('http://img/band-99.jpg')).toBe(false)
    })

    it('the band follows the dial focus (new edge covers get warmed on the move)', async () => {
      server.use(
        http.get('*/web-api/playlists/pl-1/tracks', () =>
          HttpResponse.json({
            items: LONG_TRACKS,
            total: 100,
            limit: 50,
            offset: 0,
            next: null,
          }),
        ),
      )
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      fireEvent.click(screen.getByText('Road Trip'))
      await screen.findByText('Band Track 0')

      // dial to track 50: the band slides to [30, 71) — the mounted window
      // (16/16 around 50) sits inside the warmed band, so dialing still never
      // meets an undecoded cover (bug8.2 behavior preserved)
      for (let i = 0; i < 50; i++) wheel(-10)
      await waitFor(() => expect(hasWarmedArt('http://img/band-70.jpg')).toBe(true))
      expect(hasWarmedArt('http://img/band-71.jpg')).toBe(false)
      // the focused card is mounted and in view
      expect(screen.getByText('Band Track 50').closest('.card')).toHaveClass('cardFocused')
    })

    it('warms the entire list for categories below the band span (bug8.2 behavior unchanged)', async () => {
      // 10 tracks: 2*20+1 = 41 > 10 → the focus band covers the whole list
      server.use(
        http.get('*/web-api/playlists/pl-2/tracks', () =>
          HttpResponse.json({
            items: Array.from({ length: 10 }, (_, i) => ({
              is_local: false,
              track: {
                id: `st-${i}`,
                name: `Short Track ${i}`,
                uri: `spotify:track:st-${i}`,
                artists: [{ name: 'Someone' }],
                album: { name: 'An Album', images: [{ url: `http://img/short-${i}.jpg` }] },
                position: i,
              },
            })),
            total: 10,
            limit: 50,
            offset: 0,
            next: null,
          }),
        ),
      )
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      fireEvent.click(screen.getByText('Workout'))
      await screen.findByText('Short Track 0')

      await waitFor(() => expect(hasWarmedArt('http://img/short-9.jpg')).toBe(true))
    })
  })

  describe('bug47 R2 (F3): pre-decode is incremental (band diff per tick)', () => {
    // 100 tracks for pl-1 — the same fixture shape as the bug48 band describe
    const LONG_TRACKS = Array.from({ length: 100 }, (_, i) => ({
      is_local: false,
      track: {
        id: `lt-${i}`,
        name: `Band Track ${i}`,
        uri: `spotify:track:lt-${i}`,
        artists: [{ name: 'Someone' }],
        album: { name: 'An Album', images: [{ url: `http://img/band-${i}.jpg` }] },
        position: i,
      },
    }))

    function trackListFixture(): void {
      server.use(
        http.get('*/web-api/playlists/pl-1/tracks', () =>
          HttpResponse.json({
            items: LONG_TRACKS,
            total: 100,
            limit: 50,
            offset: 0,
            next: null,
          }),
        ),
      )
    }

    // the pre-decode creates the only `new Image()` calls in these tests —
    // seed the color cache so useColorExtract never creates its own Image
    // for the focused cover (it would pollute the pre-decode count)
    function seedColors(): void {
      for (const item of LONG_TRACKS) {
        seedColorCache(item.track.album.images[0].url, [10, 20, 30])
      }
      seedColorCache('http://img/s.jpg', [10, 20, 30])
      seedColorCache('http://img/r.jpg', [10, 20, 30])
      seedColorCache('http://img/liked.jpg', [10, 20, 30])
    }

    async function enterTrackList(): Promise<void> {
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      fireEvent.click(screen.getByText('Road Trip'))
      await screen.findByText('Band Track 0')
      // focus 0: the entry band [0,21) is fully warmed
      await waitFor(() => expect(hasWarmedArt('http://img/band-20.jpg')).toBe(true))
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a dial tick warms only the new band edge, not the whole category bands', async () => {
      const created: HTMLImageElement[] = []
      const RealImage = window.Image
      vi.stubGlobal('Image', function () {
        const img = new RealImage()
        created.push(img)
        return img
      })
      trackListFixture()
      seedColors()

      render(<MainMenuView />)
      await enterTrackList()
      const preTick = created.length

      // simulate a warmed-set eviction (bug45 option C FIFO bound): the
      // warmer must NOT re-walk the stable band interior — only the new edge
      // of the sliding band gets warmed
      __resetWarmedArt()
      wheel(-10) // focus 1: the band slides to [0,22)
      await waitFor(() => expect(hasWarmedArt('http://img/band-21.jpg')).toBe(true))

      // exactly ONE new cover — the band edge — instead of the ~235 warmArt
      // lookups (and their new Images for the evicted urls) the old loop did
      // on every focus change
      const fresh = created.slice(preTick)
      expect(fresh).toHaveLength(1)
      expect(fresh[0].src).toBe('http://img/band-21.jpg')
      // the stable band interior is NOT re-warmed
      expect(created.filter((img) => img.src === 'http://img/band-5.jpg')).toHaveLength(1)
    })

    it('a category switch warms the full entry band of the rebuilt category', async () => {
      const created: HTMLImageElement[] = []
      const RealImage = window.Image
      vi.stubGlobal('Image', function () {
        const img = new RealImage()
        created.push(img)
        return img
      })
      trackListFixture()
      seedColors()

      render(<MainMenuView />)
      await enterTrackList()
      // dial 50 ticks: the band slides to [30,71) (one edge cover per tick)
      for (let i = 0; i < 50; i++) wheel(-10)
      await waitFor(() => expect(hasWarmedArt('http://img/band-70.jpg')).toBe(true))
      const beforeSwitch = created.length

      // simulate an eviction, then leave the track sub-menu: the 'playlists'
      // category reverts to the playlist cards (rebuilt card list) — the full
      // band of the rebuilt categories is re-warmed
      __resetWarmedArt()
      pressBack()
      const afterLeave = created.slice(beforeSwitch)
      // ticket 9.3: scope to the network covers — the rebuilt home category
      // re-warms its self-contained data-URI entity art, which the pre-decode
      // assertion does not concern (and jsdom resolves a cleaned-up img src to
      // the document url)
      const afterLeaveNet = afterLeave
        .map((img) => img.src)
        .filter((src) => src.startsWith('http://img/'))
      // Road Trip + Liked Songs (Workout has no image) + the recent track
      expect(new Set(afterLeaveNet)).toEqual(
        new Set(['http://img/r.jpg', 'http://img/liked.jpg', 'http://img/s.jpg']),
      )
      // the deep band the dial had warmed (band-30..70) is NOT re-warmed —
      // it is outside the entry band of every rebuilt category
      expect(afterLeave.some((img) => img.src.startsWith('http://img/band-'))).toBe(false)

      // re-enter the track list: the rebuilt track cards' full entry band is
      // re-warmed again (the focus is back at track 0)
      const beforeReopen = created.length
      fireEvent.click(screen.getByText('Road Trip'))
      await screen.findByText('Band Track 0')
      await waitFor(() => expect(hasWarmedArt('http://img/band-20.jpg')).toBe(true))
      // ticket 9.3: scope to the network covers — the rebuilt home category's
      // data-URI entity art is already in the warmed set (warmArt de-dupes)
      // and the seeded color cache keeps useColorExtract from creating images,
      // so the network covers of the rebuilt band are exactly 21
      const afterReopen = created
        .slice(beforeReopen)
        .map((img) => img.src)
        .filter((src) => src.startsWith('http://img/'))
      expect(afterReopen).toHaveLength(21)
      expect(new Set(afterReopen)).toEqual(
        new Set(Array.from({ length: 21 }, (_, i) => `http://img/band-${i}.jpg`)),
      )
    })
  })

  describe('bug8.2: pre-decoded covers', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('warms every menu cover once with AlbumArt cache attributes', async () => {
      const created: HTMLImageElement[] = []
      const RealImage = window.Image
      vi.stubGlobal('Image', function () {
        const img = new RealImage()
        created.push(img)
        return img
      })

      render(<MainMenuView nowPlaying={nowPlaying} />)

      // ticket 9.3: the home entity cards carry self-contained data-URI art
      // (which flips with the entity state), and the color extractor's img
      // cleanup resets its src — which jsdom resolves to the document url.
      // The pre-decode assertion concerns the network covers only.
      const netSrcs = () => created.map((img) => img.src).filter((src) => src.startsWith('http://img/'))

      // wait until the dynamic card data (playlists/recent) has arrived and
      // every dynamic cover is warmed (pl-2 has no images → no entry)
      await waitFor(() => {
        expect(new Set(netSrcs())).toEqual(
          new Set(['http://img/h.jpg', 'http://img/r.jpg', 'http://img/s.jpg', 'http://img/liked.jpg']),
        )
      })

      const srcs = netSrcs().sort()
      expect(srcs).toEqual(['http://img/h.jpg', 'http://img/liked.jpg', 'http://img/r.jpg', 'http://img/s.jpg'])
      // no duplicate warming: each cover URL is fetched exactly once
      expect(new Set(netSrcs()).size).toBe(netSrcs().length)
      // same fetch attributes as AlbumArt so the browser reuses one cache entry
      for (const img of created) {
        expect(img.crossOrigin).toBe('anonymous')
        expect(img.referrerPolicy).toBe('no-referrer')
      }
    })
  })

  describe('bug2.6: zuletzt empty state', () => {
    it('shows a placeholder card when there is no recent history', async () => {
      server.use(
        http.get('*/web-api/me/player/recently-played', () =>
          HttpResponse.json({ items: [] }),
        ),
      )
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))

      expect(await screen.findByText('Noch nichts abgespielt')).toBeInTheDocument()
    })
  })

  describe('bug3: interactive queue & smart select', () => {
    it('shows every upcoming queue track as a card', () => {
      render(<MainMenuView nowPlaying={queueNowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(screen.getByText('Next Song')).toBeInTheDocument()
      expect(screen.getByText('Song After')).toBeInTheDocument()
    })

    it('confirming the current track exits to the player without a play call', async () => {
      const onPlay = vi.fn()
      const onExit = vi.fn()
      render(<MainMenuView nowPlaying={queueNowPlaying} onPlay={onPlay} onExit={onExit} />)

      // land in the now-playing content pane via a recent track
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))
      expect(onPlay).toHaveBeenCalledTimes(1)

      // the current track card is focused; confirming must only exit
      confirmDial()
      expect(onExit).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenCalledTimes(1)
    })

    it('confirming an upcoming queue track plays that track', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView nowPlaying={queueNowPlaying} onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      wheel(-10) // focus the first upcoming track
      confirmDial()

      // bug26: the track plays inside the live queue context, not as an
      // isolated single track (queue index 1 = first upcoming card)
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:queue-pl', {
        position: 1,
        uri: 'spotify:track:t-10',
      })
    })
  })

  describe('bug26: full queue & in-queue skip', () => {
    // more than the three cards the bug reported — the whole queue feeds the
    // cards (daemon delivers it, the UI no longer truncates it)
    const longQueueNowPlaying: ObserverStatusActive = {
      ...queueNowPlaying,
      next_tracks: Array.from({ length: 10 }, (_, i) => ({
        uri: `spotify:track:q-${i}`,
        track_id: `q-${i}`,
        name: `Queue Song ${i + 1}`,
        artist: 'Someone',
        album: '',
        image_url: '',
      })),
    }

    it('shows every upcoming queue track as a card, far beyond three', () => {
      render(<MainMenuView nowPlaying={longQueueNowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      for (let i = 1; i <= 10; i++) {
        expect(screen.getByText(`Queue Song ${i}`)).toBeInTheDocument()
      }
    })

    it('skips directly to a deeper queue track via the context offset', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView nowPlaying={longQueueNowPlaying} onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      wheel(-10) // focus 'Queue Song 1' (queue index 1)
      wheel(-10) // focus 'Queue Song 2' (queue index 2)
      confirmDial()

      // the live context starts at the selected track; the remaining queue
      // items keep playing after it
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:queue-pl', {
        position: 2,
        uri: 'spotify:track:q-1',
      })
    })

    it('plays the bare track uri when the queue has no shared context', async () => {
      const onPlay = vi.fn()
      render(
        <MainMenuView
          nowPlaying={{ ...queueNowPlaying, context_uri: 'spotify:track:t-9' }}
          onPlay={onPlay}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      wheel(-10) // focus the first upcoming track
      confirmDial()

      // single-track context: the offset trick would restart the first track,
      // so fall back to the direct track play
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:track:t-10')
    })

    it('still exits on the current track card without a play call', async () => {
      const onPlay = vi.fn()
      const onExit = vi.fn()
      render(
        <MainMenuView nowPlaying={longQueueNowPlaying} onPlay={onPlay} onExit={onExit} />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      // the focused card is the current track (index 0): exit only
      confirmDial()
      expect(onExit).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenCalledTimes(1)
    })
  })

  describe('bug27: artwork fallback — no black boxes', () => {
    it('queue cards without image urls render the music-note placeholder, not an empty img', () => {
      render(<MainMenuView nowPlaying={queueNowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      // the current track carries a cover, the two upcoming queue tracks do
      // not (connect queue items often ship no image metadata at all)
      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(screen.getByText('Next Song')).toBeInTheDocument()
      expect(screen.getByText('Song After')).toBeInTheDocument()

      const content = document.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      const images = content.querySelectorAll('img')
      expect(images).toHaveLength(1)
      expect(images[0]).toHaveAttribute('src', 'http://img/h.jpg')
      // every image-less queue card shows the styled music-note placeholder
      expect(content.querySelectorAll('.placeholder svg').length).toBeGreaterThanOrEqual(2)
    })

    it('a playlist without cover images renders the music-note placeholder in its card', async () => {
      render(<MainMenuView />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Workout')

      const content = document.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      // only Road Trip and Liked Songs carry covers in the fixture
      expect(content.querySelectorAll('img')).toHaveLength(2)
      // the image-less 'Workout' card renders the placeholder, no empty <img>
      const workoutCard = screen.getByText('Workout').closest('.card')
      expect(workoutCard).not.toBeNull()
      expect(workoutCard?.querySelector('img')).toBeNull()
      expect(workoutCard?.querySelector('.placeholder svg')).not.toBeNull()
    })
  })

  describe('bug42: upcoming queue artwork — real covers for every queue card', () => {
    it('queue cards with image urls render their own cover, not the placeholder', () => {
      // the daemon maps item album artwork into next_tracks[].image_url (bug42);
      // the view must hand every url through to the card, not just card 1
      const artQueueNowPlaying: ObserverStatusActive = {
        ...queueNowPlaying,
        next_tracks: [
          {
            uri: 'spotify:track:t-10',
            track_id: 't-10',
            name: 'Next Song',
            artist: 'Someone',
            album: '',
            image_url: 'http://img/q10.jpg',
          },
          {
            uri: 'spotify:track:t-11',
            track_id: 't-11',
            name: 'Song After',
            artist: 'Another',
            album: '',
            image_url: 'http://img/q11.jpg',
          },
        ],
      }
      render(<MainMenuView nowPlaying={artQueueNowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(screen.getByText('Next Song')).toBeInTheDocument()
      expect(screen.getByText('Song After')).toBeInTheDocument()

      const content = document.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      // card 1 (current) + both upcoming queue cards carry a real <img> with
      // their own src — no card falls back to the placeholder
      const images = Array.from(content.querySelectorAll('img'))
      expect(images.map((img) => img.getAttribute('src'))).toEqual([
        'http://img/h.jpg',
        'http://img/q10.jpg',
        'http://img/q11.jpg',
      ])
    })
  })

  describe('bug28: single-track queue — no ghost cards', () => {
    // the reported ghost payload: a single isolated track (context = the track
    // itself) whose Connect next_tracks ship a metadata-less ghost slot (uri
    // without a name → blank card) plus an echo of the current track
    const ghostQueueNowPlaying: ObserverStatusActive = {
      ...nowPlaying,
      context_uri: 'spotify:track:t-9',
      next_tracks: [
        { uri: 'spotify:track:t-9', track_id: 't-9', name: '', artist: '', album: '', image_url: '' },
        {
          uri: 'spotify:track:t-9',
          track_id: 't-9',
          name: 'Heat Waves',
          artist: 'Glass Animals',
          album: '',
          image_url: '',
        },
      ],
    }

    it('renders exactly one card for a single track with an empty upcoming queue', () => {
      const { container } = render(<MainMenuView nowPlaying={nowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      const content = container.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      expect(content.querySelectorAll('.card')).toHaveLength(1)
      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
    })

    it('drops the ghost slot and the current-track echo, keeping exactly one card', () => {
      const { container } = render(<MainMenuView nowPlaying={ghostQueueNowPlaying} />)

      wheel(-10) // focus 'Läuft gerade' in the sidebar (live preview)

      const content = container.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      const cards = content.querySelectorAll('.card')
      // the reported [active, blank, duplicate] collapses to the active track
      expect(cards).toHaveLength(1)
      const titles = Array.from(cards).map((card) => card.querySelector('h3')?.textContent)
      expect(titles).toEqual(['Heat Waves'])
    })

    it('drops the current-track echo in a real queue and keeps the in-queue skip positions (bug26)', async () => {
      const onPlay = vi.fn()
      render(
        <MainMenuView
          nowPlaying={{
            ...queueNowPlaying,
            next_tracks: [
              {
                uri: 'spotify:track:t-9',
                track_id: 't-9',
                name: 'Heat Waves',
                artist: 'Glass Animals',
                album: '',
                image_url: '',
              },
              {
                uri: 'spotify:track:t-10',
                track_id: 't-10',
                name: 'Next Song',
                artist: 'Someone',
                album: '',
                image_url: '',
              },
              {
                uri: 'spotify:track:t-11',
                track_id: 't-11',
                name: 'Song After',
                artist: 'Another',
                album: '',
                image_url: '',
              },
            ],
          }}
          onPlay={onPlay}
        />,
      )

      // land in the now-playing pane via a recent track
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      // the echo must not render a second 'Heat Waves' card
      expect(screen.getAllByText('Heat Waves')).toHaveLength(1)
      expect(screen.getByText('Next Song')).toBeInTheDocument()
      expect(screen.getByText('Song After')).toBeInTheDocument()

      wheel(-10) // focus 'Next Song' (the first upcoming card)
      confirmDial()

      // the offset refers to the SPOTIFY queue (t-9=0, echo=1, t-10=2) —
      // removing the echo card must not shift the positions
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:queue-pl', {
        position: 2,
        uri: 'spotify:track:t-10',
      })
    })

    it('drops metadata-less ghost slots and keeps the in-queue skip positions (bug26)', async () => {
      const onPlay = vi.fn()
      render(
        <MainMenuView
          nowPlaying={{
            ...queueNowPlaying,
            next_tracks: [
              { uri: 'spotify:track:t-99', track_id: 't-99', name: '', artist: '', album: '', image_url: '' },
              {
                uri: 'spotify:track:t-10',
                track_id: 't-10',
                name: 'Next Song',
                artist: 'Someone',
                album: '',
                image_url: '',
              },
              {
                uri: 'spotify:track:t-11',
                track_id: 't-11',
                name: 'Song After',
                artist: 'Another',
                album: '',
                image_url: '',
              },
            ],
          }}
          onPlay={onPlay}
        />,
      )

      // land in the now-playing pane via a recent track
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      // the empty slot renders no card at all
      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(screen.getByText('Next Song')).toBeInTheDocument()
      expect(screen.getByText('Song After')).toBeInTheDocument()

      wheel(-10) // focus 'Next Song'
      confirmDial()

      // the ghost slot still occupies position 1 in the Spotify queue
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:queue-pl', {
        position: 2,
        uri: 'spotify:track:t-10',
      })
    })
  })

  describe('bug32: full queue windowing — infinite scroll beyond item #3', () => {
    // 12 upcoming tracks → 13 cards total, below the carousel's
    // NO_WINDOW_THRESHOLD: every card is mounted at once, no 3-item cap
    const twelveQueueNowPlaying: ObserverStatusActive = {
      ...queueNowPlaying,
      next_tracks: Array.from({ length: 12 }, (_, i) => ({
        uri: `spotify:track:b32-${i}`,
        track_id: `b32-${i}`,
        name: `Track ${i + 1}`,
        artist: 'Someone',
        album: '',
        image_url: '',
      })),
    }

    // 60 upcoming tracks → 61 cards, above NO_WINDOW_THRESHOLD: the carousel
    // mounts a window around the focus (bug5/6/18) and scrolling right must
    // keep revealing upcoming tracks
    const sixtyQueueNowPlaying: ObserverStatusActive = {
      ...queueNowPlaying,
      next_tracks: Array.from({ length: 60 }, (_, i) => ({
        uri: `spotify:track:w32-${i}`,
        track_id: `w32-${i}`,
        name: `Window ${i + 1}`,
        artist: 'Someone',
        album: '',
        image_url: '',
      })),
    }

    it('renders every card of a 12-track queue at once (no 3-item cap)', () => {
      render(<MainMenuView nowPlaying={twelveQueueNowPlaying} />)

      // tapping the sidebar item enters the now-playing content pane
      fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))

      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      for (let i = 1; i <= 12; i++) {
        expect(screen.getByText(`Track ${i}`)).toBeInTheDocument()
      }
    })

    it('scrolls right through a 60-track queue, mounting upcoming tracks beyond item #3', () => {
      render(<MainMenuView nowPlaying={sixtyQueueNowPlaying} />)

      fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))

      // the initial window around the focused current track already reaches
      // well past the reported 3-item cap
      expect(screen.getByText('Heat Waves')).toBeInTheDocument()
      expect(screen.getByText('Window 1')).toBeInTheDocument()
      expect(screen.getByText('Window 3')).toBeInTheDocument()
      expect(screen.getByText('Window 15')).toBeInTheDocument()
      // the window is bounded, not the full list (windowed rendering)
      expect(screen.queryByText('Window 40')).not.toBeInTheDocument()

      // dial right past the initial window — the window follows the focus
      for (let i = 0; i < 25; i++) wheel(-10)
      expect(screen.getByText('Window 25')).toBeInTheDocument()

      // and keep going all the way to the last track of the queue
      for (let i = 0; i < 35; i++) wheel(-10)
      expect(screen.getByText('Window 60')).toBeInTheDocument()
    })
  })

  // ticket 9.3: the home cards render the user-selected entities (default
  // selection = the HOME_LIGHTS); ticket 9.5: no manage card — the picker is
  // reached via Einstellungen → Home
  describe('bug34: every selected entity renders as a home card', () => {
    it('renders a card for every selected entity (default = HOME_LIGHTS), no manage card', () => {
      const { container } = render(<MainMenuView />)

      const content = container.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      // the default selection's 9 lights — nothing else in the home carousel
      expect(content.querySelectorAll('.card')).toHaveLength(HOME_LIGHTS.length)
      // the card order follows the selection (default = HOME_LIGHTS menu order)
      const titles = Array.from(content.querySelectorAll('.card h3')).map((el) => el.textContent)
      expect(titles).toEqual(HOME_LIGHTS.map((light) => light.label))
    })

    it('does not render the removed manage card ("Entitäten wählen")', () => {
      render(<MainMenuView />)
      expect(screen.queryByText('Entitäten wählen')).not.toBeInTheDocument()
    })

    it('shows the live on/off subtitle per light (default mock: all off)', async () => {
      render(<MainMenuView />)

      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })
    })

    it('shows "An" only for the light that is on, independently of the others', async () => {
      server.use(
        http.get('*/ha-api/states/light.kajplats_gu10_ws_575lm_3', () =>
          HttpResponse.json({
            entity_id: 'light.kajplats_gu10_ws_575lm_3',
            state: 'on',
            attributes: {},
          }),
        ),
      )
      render(<MainMenuView />)

      await screen.findByText('Treppenspot Treppe')
      await waitFor(() => {
        const card = screen.getByText('Treppenspot Treppe').closest('.card')
        expect(card?.querySelector('.subtitle')?.textContent).toBe('An')
      })
      // the neighboring lights keep their own (off) state
      const middle = screen.getByText('Treppenspot Mitte').closest('.card')
      expect(middle?.querySelector('.subtitle')?.textContent).toBe('Aus')
    })

    it('tapping a light card sends a toggle request for that exact entity', async () => {
      const toggled: string[] = []
      server.use(
        http.post('*/ha-api/services/light/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          return HttpResponse.json([
            { entity_id: body.entity_id, state: 'on', attributes: {} },
          ])
        }),
      )
      render(<MainMenuView />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      fireEvent.click(screen.getByText('Esstisch Hängelampe'))

      await waitFor(() => expect(toggled).toEqual(['light.esstisch_hangelampe_3er']))
      // the card reflects the toggle result
      const card = screen.getByText('Esstisch Hängelampe').closest('.card')
      expect(card?.querySelector('.subtitle')?.textContent).toBe('An')
    })

    it('the primary light card keeps its behavior: tap toggles the primary entity, stays in Home', async () => {
      const toggled: string[] = []
      server.use(
        http.post('*/ha-api/services/light/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          return HttpResponse.json([
            { entity_id: body.entity_id, state: 'on', attributes: {} },
          ])
        }),
      )
      render(<MainMenuView />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      fireEvent.click(screen.getByText('3er Stehlampe Gold'))

      await waitFor(() => expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer']))
      // no view transition — the home category stays active
      expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'true')
      const card = screen.getByText('3er Stehlampe Gold').closest('.card')
      expect(card?.querySelector('.subtitle')?.textContent).toBe('An')
    })

    // ticket 9.5: the picker opener moved from the home carousel to the
    // 'Home' row of the Einstellungen list (row 8, after 'Home Assistant')
    it('the Home settings row opens the entity picker', async () => {
      const onOpenEntityPicker = vi.fn()
      render(<MainMenuView onOpenEntityPicker={onOpenEntityPicker} />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')

      // the row value mirrors the live selection count (default = 9 lights)
      expect(screen.getByText(`${HOME_LIGHTS.length} Entitäten`)).toBeInTheDocument()

      wheel(-10) // 1 Show Lyrics
      wheel(-10) // 2 Karaoke Lyrics
      wheel(-10) // 3 Mic
      wheel(-10) // 4 Devices
      wheel(-10) // 5 Bluetooth Pairing
      wheel(-10) // 6 Raspberry Pi
      wheel(-10) // 7 Home Assistant
      wheel(-10) // 8 Home
      confirmDial()

      expect(onOpenEntityPicker).toHaveBeenCalledTimes(1)
    })

    it('tapping a switch card sends a switch/toggle request for that entity', async () => {
      const switched: string[] = []
      localStorage.setItem(
        SELECTION_LS_KEY,
        JSON.stringify([...HOME_LIGHTS.map((light) => light.entityId), 'switch.wasserpumpe']),
      )
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({
            entity_id: 'switch.wasserpumpe',
            state: 'off',
            attributes: {},
          }),
        ),
        http.post('*/ha-api/services/switch/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          switched.push(body.entity_id ?? '')
          return HttpResponse.json([{ entity_id: body.entity_id, state: 'on', attributes: {} }])
        }),
      )
      render(<MainMenuView />)
      const title = await screen.findByText('Wasserpumpe')
      await waitFor(() => {
        expect(title.closest('.card')?.querySelector('.subtitle')?.textContent).toBe('Aus')
      })

      fireEvent.click(title)

      await waitFor(() => expect(switched).toEqual(['switch.wasserpumpe']))
      // the card reflects the toggle result
      const card = screen.getByText('Wasserpumpe').closest('.card')
      expect(card?.querySelector('.subtitle')?.textContent).toBe('An')
    })

    it('tapping a scene card sends a scene/turn_on request for that entity', async () => {
      const scenes: string[] = []
      localStorage.setItem(
        SELECTION_LS_KEY,
        JSON.stringify([...HOME_LIGHTS.map((light) => light.entityId), 'scene.abendstimmung']),
      )
      server.use(
        http.get('*/ha-api/states/scene.abendstimmung', () =>
          HttpResponse.json({
            entity_id: 'scene.abendstimmung',
            state: 'none',
            attributes: {},
          }),
        ),
        http.post('*/ha-api/services/scene/turn_on', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          scenes.push(body.entity_id ?? '')
          return HttpResponse.json([{ entity_id: body.entity_id, state: 'none', attributes: {} }])
        }),
      )
      render(<MainMenuView />)
      const title = await screen.findByText('Abendstimmung')
      await waitFor(() => {
        expect(title.closest('.card')?.querySelector('.subtitle')?.textContent).toBe('Szene')
      })

      fireEvent.click(title)

      await waitFor(() => expect(scenes).toEqual(['scene.abendstimmung']))
      // scenes are stateless — the card keeps its fixed 'Szene' subtitle
      const card = screen.getByText('Abendstimmung').closest('.card')
      expect(card?.querySelector('.subtitle')?.textContent).toBe('Szene')
    })

    // ticket 9.5: the empty selection keeps only the inert placeholder — the
    // manage card is gone, the hint points to Einstellungen → Home
    it('an empty selection shows the inert placeholder pointing to the settings', () => {
      localStorage.setItem(SELECTION_LS_KEY, '[]')
      const { container } = render(<MainMenuView />)

      expect(screen.getByText('Keine Entitäten gewählt')).toBeInTheDocument()
      expect(screen.getByText('In den Einstellungen wählen')).toBeInTheDocument()
      const content = container.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement
      expect(content.querySelectorAll('.card')).toHaveLength(1)
    })
  })

  // bug57 v2: the 3s HA poll runs only while the Home carousel is the
  // visible (confirmed) category — no daemon traffic in the other menus,
  // and (re-)entering 'Home' triggers an immediate fresh read (no waiting
  // for the next 3s tick)
  describe('bug57 v2: HA poll gated on the Home carousel visibility', () => {
    it('polls only while Home is visible: other categories = no requests, re-entering Home = immediate read + 3s rhythm', async () => {
      vi.useFakeTimers()
      let stateGets = 0
      server.use(
        http.get('*/ha-api/states/light.*', ({ request }) => {
          stateGets += 1
          const path = new URL(request.url).pathname
          const entityId = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
          return HttpResponse.json({ entity_id: entityId, state: 'off', attributes: {} })
        }),
      )
      const { unmount } = render(<MainMenuView />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      // Home is the initial (visible) category: one mount fetch per selected
      // light (the visibility read dedupes on the in-flight mount reads)
      const afterMount = stateGets
      expect(afterMount).toBe(HOME_LIGHTS.length)

      // Home visible for 6.5s: exactly two poll ticks at the 3s rhythm
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6500)
      })
      expect(stateGets).toBe(afterMount + 2 * HOME_LIGHTS.length)

      // switch to Playlists: the poll stops — no further state requests
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const afterSwitch = stateGets
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6500)
      })
      expect(stateGets).toBe(afterSwitch)

      // back to Home: an immediate fresh read for every selected light,
      // then the 3s rhythm resumes
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Home' }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(stateGets).toBe(afterSwitch + HOME_LIGHTS.length)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(stateGets).toBe(afterSwitch + 2 * HOME_LIGHTS.length)

      unmount()
      vi.useRealTimers()
    })
  })

  describe('bug4: track sub-menu back behavior', () => {
    it('back inside the track list returns to the playlist list without exiting', async () => {
      const onExit = vi.fn()
      render(<MainMenuView onExit={onExit} />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Road Trip'))
      await waitFor(() => expect(screen.getByText('Track 1 of pl-1')).toBeInTheDocument())

      pressBack()
      expect(onExit).not.toHaveBeenCalled()
      // the playlist list is shown again, focused on the opened playlist
      expect(screen.getByText('Road Trip').closest('.card')).toHaveClass('cardFocused')
    })

    it('selecting another sidebar category closes the track list', async () => {
      render(<MainMenuView />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Road Trip'))
      await waitFor(() => expect(screen.getByText('Track 1 of pl-1')).toBeInTheDocument())

      pressBack() // track list closes, playlist list visible in the content pane
      expect(screen.getByText('Road Trip')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      expect(screen.queryByText('Track 1 of pl-1')).not.toBeInTheDocument()
    })
  })

  describe('bug19: recently played context & error state', () => {
    it('plays the context uri when the track was played from a context', async () => {
      server.use(
        http.get('*/web-api/me/player/recently-played', () =>
          HttpResponse.json({
            items: [
              {
                track: {
                  id: 't-ctx',
                  name: 'Contexted',
                  artists: [{ name: 'Someone' }],
                  album: { name: 'An Album', images: [{ url: 'http://img/c.jpg' }] },
                  uri: 'spotify:track:t-ctx',
                },
                played_at: '2026-08-21T10:00:00Z',
                context_uri: 'spotify:playlist:ctx-1',
              },
            ],
          }),
        ),
      )
      const onPlay = vi.fn()
      render(<MainMenuView onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await screen.findByText('Contexted')
      fireEvent.click(screen.getByText('Contexted'))

      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:ctx-1')
    })

    it('falls back to the track uri when no context is known', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await screen.findByText('Siamese Dream')
      fireEvent.click(screen.getByText('Siamese Dream'))

      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:track:t-1')
    })

    it('shows an error card and retries the recents fetch on confirm', async () => {
      let calls = 0
      server.use(
        http.get('*/web-api/me/player/recently-played', () => {
          calls += 1
          return new HttpResponse(null, { status: 500 })
        }),
      )
      render(<MainMenuView />)

      // bug30: the switch to 'Zuletzt' itself triggers a fresh fetch, so by
      // the time the error card is visible the mount fetch and the switch
      // refetch have both failed
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      const retry = await screen.findByText('Erneut versuchen')
      expect(calls).toBeGreaterThanOrEqual(2)

      // confirming the error card triggers a refetch
      const callsBeforeRetry = calls
      fireEvent.click(retry)
      await waitFor(() => expect(calls).toBeGreaterThan(callsBeforeRetry))
    })
  })

  describe('bug30: dynamic recently-played refresh', () => {
    function recentItem(id: string, name: string, artist: string, playedAt: string) {
      return {
        track: {
          id,
          name,
          artists: [{ name: artist }],
          album: { name: `${name} Album`, images: [] },
          uri: `spotify:track:${id}`,
        },
        played_at: playedAt,
      }
    }

    it('refetches the play history when "Zuletzt" is confirmed and renders the newer items', async () => {
      const stale = recentItem('t-stale', 'Stale Track', 'Old Band', '2026-08-24T09:00:00Z')
      const fresh = recentItem('t-fresh', 'Fresh Track', 'New Band', '2026-08-24T10:00:00Z')
      let calls = 0
      server.use(
        http.get('*/web-api/me/player/recently-played', () => {
          calls += 1
          return HttpResponse.json({ items: calls === 1 ? [stale] : [fresh] })
        }),
      )
      render(<MainMenuView />)

      // the mount fetch delivers the stale history (call 1)
      await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1))

      // confirming "Zuletzt" must bypass the fresh cache and fetch again
      // (call 2) even though nothing has expired
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      // bug37: cache-first — the cached history is still rendered on the very
      // first render after the switch (no loading state, no 'Lade…' card)
      // while the revalidation runs silently in the background
      expect(screen.getByText('Stale Track')).toBeInTheDocument()
      expect(screen.queryByText('Lade…')).not.toBeInTheDocument()
      expect(await screen.findByText('Fresh Track')).toBeInTheDocument()
      expect(screen.queryByText('Stale Track')).not.toBeInTheDocument()
      expect(calls).toBe(2)
    })

    it('does not fetch recents while lingering in other categories or previewing "Zuletzt"', async () => {
      let calls = 0
      server.use(
        http.get('*/web-api/me/player/recently-played', () => {
          calls += 1
          return HttpResponse.json({ items: mockRecent })
        }),
      )
      render(<MainMenuView />)
      await waitFor(() => expect(calls).toBe(1))

      // confirm other categories — none of them involve the recents fetch
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await waitFor(() => expect(screen.getByText('Show Lyrics')).toBeInTheDocument())

      // back to the sidebar and dial UP to "Zuletzt" (one above the last
      // item) without confirming: the live preview shows the already-loaded
      // history, still no new fetch
      pressBack()
      wheel(10)

      expect(screen.getByText('Siamese Dream')).toBeInTheDocument()
      expect(calls).toBe(1)
    })

    it('refetches again when "Zuletzt" is re-entered', async () => {
      const pages = [
        recentItem('t-1', 'First Entry', 'Band 1', '2026-08-24T09:00:00Z'),
        recentItem('t-2', 'Second Entry', 'Band 2', '2026-08-24T09:30:00Z'),
        recentItem('t-3', 'Third Entry', 'Band 3', '2026-08-24T10:00:00Z'),
      ]
      let calls = 0
      server.use(
        http.get('*/web-api/me/player/recently-played', () => {
          calls += 1
          return HttpResponse.json({ items: [pages[Math.min(calls, pages.length) - 1]] })
        }),
      )
      render(<MainMenuView />)

      // first confirmed entry (mount = page 1, switch = page 2)
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      expect(await screen.findByText('Second Entry')).toBeInTheDocument()

      // leave for another category, then come back
      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))

      expect(await screen.findByText('Third Entry')).toBeInTheDocument()
      expect(screen.queryByText('Second Entry')).not.toBeInTheDocument()
      expect(calls).toBe(3)
    })
  })

  describe('bug37: cache-first rendering & silent revalidation', () => {
    function recentItem(id: string, name: string, artist: string, playedAt: string) {
      return {
        track: {
          id,
          name,
          artists: [{ name: artist }],
          album: { name: `${name} Album`, images: [] },
          uri: `spotify:track:${id}`,
        },
        played_at: playedAt,
      }
    }

    it('switching to "Zuletzt" renders the cached items instantly; the fresh page lands silently in the background', async () => {
      const stale = recentItem('t-stale', 'Stale Track', 'Old Band', '2026-08-24T09:00:00Z')
      const fresh = recentItem('t-fresh', 'Fresh Track', 'New Band', '2026-08-24T10:00:00Z')
      let calls = 0
      let releaseFresh: () => void = () => {}
      const freshPending = new Promise<void>((resolve) => {
        releaseFresh = resolve
      })
      server.use(
        http.get('*/web-api/me/player/recently-played', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ items: [stale] })
          await freshPending
          return HttpResponse.json({ items: [fresh] })
        }),
      )
      render(<MainMenuView />)

      // the mount fetch (call 1) delivers the stale history into state/cache
      await waitFor(() => expect(calls).toBe(1))

      // confirming "Zuletzt" renders the cached history IMMEDIATELY on the
      // very first render after the switch (cache-first — no loading state,
      // no 'Lade…' card), and starts the background revalidation (call 2)
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      expect(screen.getByText('Stale Track')).toBeInTheDocument()
      expect(screen.queryByText('Lade…')).not.toBeInTheDocument()
      await waitFor(() => expect(calls).toBe(2))
      // the stale items stay rendered while the revalidation is in flight
      expect(screen.getByText('Stale Track')).toBeInTheDocument()
      expect(screen.queryByText('Lade…')).not.toBeInTheDocument()

      // the fresh page swaps in on arrival, still without any loading state
      releaseFresh()
      expect(await screen.findByText('Fresh Track')).toBeInTheDocument()
      expect(screen.queryByText('Stale Track')).not.toBeInTheDocument()
      expect(screen.queryByText('Lade…')).not.toBeInTheDocument()
    })

    it('keeps the stale history rendered when the background revalidation fails', async () => {
      const stale = recentItem('t-stale', 'Stale Track', 'Old Band', '2026-08-24T09:00:00Z')
      let calls = 0
      let releaseFailure: () => void = () => {}
      const failurePending = new Promise<void>((resolve) => {
        releaseFailure = resolve
      })
      server.use(
        http.get('*/web-api/me/player/recently-played', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ items: [stale] })
          await failurePending
          return new HttpResponse(null, { status: 500 })
        }),
      )
      render(<MainMenuView />)

      // the mount fetch (call 1) delivers the stale history into state/cache
      await waitFor(() => expect(calls).toBe(1))

      // confirming "Zuletzt" renders the cached history instantly (cache-first)
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      expect(screen.getByText('Stale Track')).toBeInTheDocument()
      await waitFor(() => expect(calls).toBe(2))

      releaseFailure()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      // a failed revalidation keeps the stale history on screen — no error
      // card, no loading flash
      expect(screen.getByText('Stale Track')).toBeInTheDocument()
      expect(screen.queryByText('Erneut versuchen')).not.toBeInTheDocument()
      expect(screen.queryByText('Lade…')).not.toBeInTheDocument()
    })
  })

  describe('bug22: Liked Songs opens the track sub-menu', () => {
    it('does not play track 1 immediately; the sub-menu lists the saved tracks', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Liked Songs')
      fireEvent.click(screen.getByText('Liked Songs'))

      expect(onPlay).not.toHaveBeenCalled()
      expect(await screen.findByText('Faded')).toBeInTheDocument()
      expect(screen.getByText('Lean On')).toBeInTheDocument()
    })

    it('plays the collection context at the track position when a saved track is confirmed', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView onPlay={onPlay} />)

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Liked Songs')
      fireEvent.click(screen.getByText('Liked Songs'))
      await screen.findByText('Faded')
      fireEvent.click(screen.getByText('Faded'))

      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenCalledWith('spotify:collection:tracks', {
        position: 0,
        uri: 'spotify:track:lk-1',
      })
      expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  })

  describe('bug24: dynamic artwork-based ambient background', () => {
    it('derives the background from the focused card artwork when its color is known', async () => {
      seedColorCache('http://img/r.jpg', [245, 192, 74])
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')

      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([245, 192, 74]))
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(rgba([245, 192, 74], 0.5))
      expect(view.style.getPropertyValue('--menu-glow-b')).toBe(rgba([245, 192, 74], 0.42))
    })

    it('keeps the static category colors for cards without artwork', () => {
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement

      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))

      const settings = MENU_CATEGORIES.find((category) => category.id === 'settings')!
      expect(view.style.getPropertyValue('--menu-bg')).toBe(settings.bg)
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(settings.accent.a)
      expect(view.style.getPropertyValue('--menu-glow-b')).toBe(settings.accent.b)
    })

    it('transitions to the new card color once the dial burst ends', async () => {
      seedColorCache('http://img/r.jpg', [245, 192, 74])
      seedColorCache('http://img/liked.jpg', [120, 60, 180])
      // first track of the Liked Songs sub-menu (opened on confirm) — same
      // seeded palette so the post-freeze commit is the expected value
      seedColorCache('http://img/lk.jpg', [120, 60, 180])
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([245, 192, 74]))

      // rotate past Workout (no art → static category colors) to the
      // Liked Songs card, whose seeded cover drives the ambient colors
      wheel(-10)
      wheel(-10)
      // bug58: while dial ticks are in progress (contentMoveKind 'dial') the
      // previously committed ambient values stay frozen — no per-tick rewrite
      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([245, 192, 74]))

      // confirming the focused card is a 'jump' move (opens the track
      // sub-menu), which releases the freeze: the ambient colors commit from
      // the newly focused track's seeded artwork
      confirmDial()
      await screen.findByText('Faded')
      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([120, 60, 180]))
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(rgba([120, 60, 180], 0.5))
    })
  })

  describe('bug25: settings vertical list', () => {
    it('renders the root rows instead of a carousel', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      for (const label of [
        'Settings',
        'Show Lyrics',
        'Karaoke Lyrics',
        'Mic',
        'Devices',
        'Bluetooth Pairing',
        // epic10 task 4
        'Raspberry Pi',
        // ticket 9.4
        'Home Assistant',
      ]) {
        expect(await screen.findByText(label)).toBeInTheDocument()
      }
    })

    it('the Home Assistant row sits directly after the Raspberry Pi row (Default value)', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      const piRow = (await screen.findByText('Raspberry Pi')).closest('.row')
      expect(piRow).toBeTruthy()
      // the row right after 'Raspberry Pi' is the new 'Home Assistant' row
      const haRow = piRow!.nextElementSibling
      expect(haRow?.textContent).toContain('Home Assistant')
      // empty settings store → the daemon's build-time defaults apply
      expect(haRow?.textContent).toContain('Default')
    })

    it('the Home Assistant row value flips to Konfiguriert when url+token are stored', async () => {
      updateSettings({
        ha: {
          url: 'http://10.10.1.104:8123',
          username: 'mira',
          password: '',
          token: 'long-lived-token',
          tokenSource: 'login',
        },
      })
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      const row = (await screen.findByText('Home Assistant')).closest('.row')
      expect(row?.textContent).toContain('Konfiguriert')
    })

    it('confirming Show Lyrics flips the live value', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Show Lyrics')
      expect(getSettings().showLyrics).toBe(true)

      wheel(-10) // from 'Settings' (0) to 'Show Lyrics' (1)
      confirmDial()

      expect(getSettings().showLyrics).toBe(false)
      expect(screen.getByText('Show Lyrics').closest('[role="button"]')?.textContent).toContain(
        'Off',
      )
    })

    it('Settings opens the sub-level and back returns to the root rows', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // the focused 'Settings' row (index 0) descends

      expect(await screen.findByText('Default Device')).toBeInTheDocument()
      expect(screen.getByText('Display Size')).toBeInTheDocument()
      expect(screen.getByText('Lyric Sync')).toBeInTheDocument()
      expect(screen.getByText('Volume per turn')).toBeInTheDocument()
      expect(screen.getByText('Brightness')).toBeInTheDocument()
      expect(screen.queryByText('Bluetooth Pairing')).not.toBeInTheDocument()

      pressBack()
      expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
      expect(screen.queryByText('Display Size')).not.toBeInTheDocument()
    })

    it('confirming a slider row toggles its adjust mode', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10) // to 'Display Size' (1)

      confirmDial() // enter adjust mode
      const row = screen.getByText('Display Size').closest('[role="button"]')
      expect(row?.className).toContain('rowAdjusting')

      confirmDial() // leave it again
      expect(screen.getByText('Display Size').closest('[role="button"]')?.className).not.toContain(
        'rowAdjusting',
      )
    })

    it('the wheel adjusts the slider value while adjust mode is active', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10) // to 'Display Size' (1), value 100
      confirmDial() // enter adjust mode

      wheel(-10) // consumed by the slider: 100 → 105, the focus stays
      expect(getSettings().uiScalePct).toBe(105)
      wheel(10) // 105 → 100
      expect(getSettings().uiScalePct).toBe(100)
    })

    it('turning past the slider boundary leaves adjust mode and moves the focus', async () => {
      updateSettings({ uiScalePct: 115 })
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10) // to 'Display Size' (1, already at the 115 max)
      confirmDial() // enter adjust mode

      wheel(-10) // boundary: adjust mode ends and the focus moves to 'Lyric Sync'
      expect(getSettings().uiScalePct).toBe(115)
      expect(screen.getByText('Lyric Sync').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )
      wheel(-10) // plain navigation on again: to 'Volume per turn'
      expect(screen.getByText('Volume per turn').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )
    })

    it('Devices and Bluetooth Pairing open their panels', async () => {
      const onOpenDevices = vi.fn()
      const onOpenBluetooth = vi.fn()
      render(
        <MainMenuView onOpenDevices={onOpenDevices} onOpenBluetooth={onOpenBluetooth} />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')

      wheel(-10) // 1 Show Lyrics
      wheel(-10) // 2 Karaoke Lyrics
      wheel(-10) // 3 Mic
      wheel(-10) // 4 Devices
      confirmDial()
      expect(onOpenDevices).toHaveBeenCalledTimes(1)

      wheel(-10) // 5 Bluetooth Pairing
      confirmDial()
      expect(onOpenBluetooth).toHaveBeenCalledTimes(1)
    })

    it('Default Device in the sub-level opens the default device panel', async () => {
      const onOpenDefaultDevice = vi.fn()
      render(<MainMenuView onOpenDefaultDevice={onOpenDefaultDevice} />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      confirmDial()
      expect(onOpenDefaultDevice).toHaveBeenCalledTimes(1)
    })

    it('Raspberry Pi opens the Pi server panel', async () => {
      const onOpenPiServer = vi.fn()
      render(<MainMenuView onOpenPiServer={onOpenPiServer} />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')

      wheel(-10) // 1 Show Lyrics
      wheel(-10) // 2 Karaoke Lyrics
      wheel(-10) // 3 Mic
      wheel(-10) // 4 Devices
      wheel(-10) // 5 Bluetooth Pairing
      wheel(-10) // 6 Raspberry Pi
      confirmDial()
      expect(onOpenPiServer).toHaveBeenCalledTimes(1)
    })

    it('Home Assistant opens the HA settings modal', async () => {
      const onOpenHaSettings = vi.fn()
      const onOpenPiServer = vi.fn()
      render(<MainMenuView onOpenHaSettings={onOpenHaSettings} onOpenPiServer={onOpenPiServer} />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')

      wheel(-10) // 1 Show Lyrics
      wheel(-10) // 2 Karaoke Lyrics
      wheel(-10) // 3 Mic
      wheel(-10) // 4 Devices
      wheel(-10) // 5 Bluetooth Pairing
      wheel(-10) // 6 Raspberry Pi
      wheel(-10) // 7 Home Assistant
      confirmDial()
      expect(onOpenHaSettings).toHaveBeenCalledTimes(1)
      // the neighbouring row keeps its own target
      expect(onOpenPiServer).not.toHaveBeenCalled()
    })

    it('the Raspberry Pi row value mirrors the live Pi server mode', async () => {
      // the default capabilities handler keeps the app in standalone mode
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      // only the dial-focused row carries role="button" — take the row div
      const row = (await screen.findByText('Raspberry Pi')).closest('.row')
      // the mount-time check settles to standalone; let it settle explicitly
      await act(async () => {
        await checkMiraServer('192.168.7.1')
      })
      expect(row?.textContent).toContain('Standalone')

      server.use(
        http.get('*/api/v1/capabilities', () =>
          HttpResponse.json({ tier: 'compute', disk_cache: true, remote_colors: true, remote_blur: true }),
        ),
      )
      await act(async () => {
        await checkMiraServer('192.168.7.1')
      })
      // the re-render keeps the row element — its value cell flips to the
      // live mode
      expect(row?.textContent).toContain('Compute Mode')
    })

    it('adjust mode does not survive leaving the sub-level', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10) // to 'Display Size' (1)
      confirmDial() // enter adjust mode
      expect(screen.getByText('Display Size').closest('[role="button"]')?.className).toContain(
        'rowAdjusting',
      )

      pressBack() // back to the root rows
      confirmDial() // 'Settings' again — a fresh sub-level
      wheel(-10) // to 'Display Size'
      expect(screen.getByText('Display Size').closest('[role="button"]')?.className).not.toContain(
        'rowAdjusting',
      )
    })

    it('the wheel navigates freely through the sub-level rows', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)

      wheel(-10) // 1 Display Size
      wheel(-10) // 2 Lyric Sync
      wheel(-10) // 3 Volume per turn
      wheel(-10) // 4 Brightness
      expect(screen.getByText('Brightness').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )
    })

    it('the sun chip toggles auto brightness and reveals the level value', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)

      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)
      fireEvent.click(screen.getByRole('switch', { name: 'Auto brightness' }))

      expect(getSettings().autoBrightness).toBe(false)
      expect(screen.getByText('Brightness').closest('[role="button"]')?.textContent).toContain(
        '50%',
      )
    })
  })

  describe('bug35: brightness dual-mode', () => {
    it('dial confirm on the brightness row toggles auto brightness without an adjust mode', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4), auto ON by default → 'Auto'

      const row = () => screen.getByText('Brightness').closest('[role="button"]')
      expect(row()?.textContent).toContain('Auto')

      confirmDial() // bug35: toggles auto brightness OFF (no adjust mode)
      expect(getSettings().autoBrightness).toBe(false)
      expect(row()?.textContent).toContain('50%')
      expect(row()?.className).not.toContain('rowAdjusting')

      confirmDial() // ...and back ON
      expect(getSettings().autoBrightness).toBe(true)
      expect(row()?.textContent).toContain('Auto')
    })

    it('a click on the brightness row also toggles auto brightness', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)

      fireEvent.click(screen.getByRole('button', { name: 'Brightness' }))
      expect(getSettings().autoBrightness).toBe(false)
      expect(screen.getByText('Brightness').closest('[role="button"]')?.textContent).toContain(
        '50%',
      )
    })

    it('the wheel adjusts the manual brightness directly while auto is off', async () => {
      updateSettings({ autoBrightness: false })
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)
      expect(getSettings().brightness).toBe(5)
      const row = () => screen.getByText('Brightness').closest('[role="button"]')

      wheel(-10) // +1 step: 50% → 60%, the focus stays on the row
      expect(getSettings().brightness).toBe(6)
      expect(row()?.textContent).toContain('60%')
      expect(row()?.className).toContain('rowFocused')

      wheel(10) // -1 step: back to 50%
      expect(getSettings().brightness).toBe(5)
      expect(row()?.textContent).toContain('50%')
    })

    it('turning past the brightness bounds clamps the value and keeps row navigation', async () => {
      updateSettings({ autoBrightness: false, brightness: 1 })
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4), at the 10% minimum

      wheel(10) // value stays clamped, the focus moves up to 'Volume per turn'
      expect(getSettings().brightness).toBe(1)
      expect(screen.getByText('Volume per turn').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )

      updateSettings({ brightness: 10 })
      wheel(-10) // back down to Brightness (4), at the 100% maximum
      expect(screen.getByText('Brightness').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )
      wheel(-10) // value stays clamped, the focus moves on to the appended
      // 'Menü-Hintergrund' row (bug54: the row is APPENDED — index 5, the
      // old end-of-list was Brightness)
      expect(
        screen.getByText('Menü-Hintergrund').closest('[role="button"]')?.className,
      ).toContain('rowFocused')
      wheel(-10) // at the new end of the list: the focus clamps on the row
      expect(
        screen.getByText('Menü-Hintergrund').closest('[role="button"]')?.className,
      ).toContain('rowFocused')
    })

    it('the wheel never changes the level while auto is on (row navigation stays)', async () => {
      render(<MainMenuView />) // auto ON by default
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)

      wheel(10) // plain row navigation: up to 'Volume per turn'
      expect(getSettings().brightness).toBe(5)
      expect(screen.getByText('Volume per turn').closest('[role="button"]')?.className).toContain(
        'rowFocused',
      )
      wheel(-10) // back to Brightness
      wheel(-10) // to the appended 'Menü-Hintergrund' row (bug54)
      wheel(-10) // at the end of the list: the focus stays on the row
      expect(getSettings().brightness).toBe(5)
      expect(
        screen.getByText('Menü-Hintergrund').closest('[role="button"]')?.className,
      ).toContain('rowFocused')
    })

    it('the slider drag stays locked while auto is on and adjusts the level when auto is off', async () => {
      render(<MainMenuView />) // auto ON by default
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)
      const slider = screen.getByRole('slider', { name: 'Brightness' })
      expect(slider).toHaveAttribute('aria-disabled', 'true')
      stubBar(slider)

      fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 400, pointerId: 1 })
      expect(getSettings().brightness).toBe(5) // locked

      confirmDial() // auto OFF → the slider unlocks
      expect(slider).toHaveAttribute('aria-disabled', 'false')
      const unlocked = screen.getByRole('slider', { name: 'Brightness' })
      stubBar(unlocked)
      fireEvent.pointerDown(unlocked, { clientX: 400, pointerId: 1 }) // 100%
      expect(getSettings().brightness).toBe(10)
      fireEvent.pointerMove(unlocked, { clientX: 190, pointerId: 1 })
      fireEvent.pointerUp(unlocked, { clientX: 190, pointerId: 1 })
      expect(getSettings().brightness).toBe(4) // 40%
      expect(screen.getByText('Brightness').closest('[role="button"]')?.textContent).toContain(
        '40%',
      )
    })

    it('clicking the brightness slider adjusts the value but never toggles auto brightness', async () => {
      updateSettings({ autoBrightness: false })
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Brightness (4)
      const slider = screen.getByRole('slider', { name: 'Brightness' })
      stubBar(slider)

      fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 400, pointerId: 1 })
      expect(getSettings().brightness).toBe(10)
      // the touch release fires a click on the bar — it must adjust the value
      // only, never toggle auto brightness (which the row tap would do)
      fireEvent.click(slider)
      expect(getSettings().autoBrightness).toBe(false)
      expect(screen.getByRole('switch', { name: 'Auto brightness' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    })

    it('the other slider rows keep confirm = adjust mode (volume per turn)', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10) // Volume per turn (3)
      const row = () => screen.getByText('Volume per turn').closest('[role="button"]')

      confirmDial() // enter adjust mode
      expect(row()?.className).toContain('rowAdjusting')

      wheel(-10) // consumed by the slider: 2 → 3, the focus stays
      expect(getSettings().volumeStepPct).toBe(3)
      expect(row()?.className).toContain('rowFocused')

      confirmDial() // leave adjust mode again
      expect(row()?.className).not.toContain('rowAdjusting')
    })
  })

  describe('bug54/bug58: configurable menu background (Schwarz / Halbdurchsichtig / Durchsichtig / Unschärfe)', () => {
    // the 'Menü-Hintergrund' row is APPENDED to the 'Settings' sub-level
    // (Einstellungen → Settings, index 5) — existing row indices stay stable
    function toSidebarBackgroundRow() {
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    }

    // the row's right-aligned value span (exact value text — 'Durchsichtig'
    // is a substring of 'Halbdurchsichtig', so row-level textContent
    // matching would not distinguish the two)
    function rowValue(row: Element | null): string | undefined {
      return row?.querySelector('[class*="value"]')?.textContent
    }

    it('renders the "Menü-Hintergrund" row last in the sub-level with the default value', async () => {
      render(<MainMenuView />)
      toSidebarBackgroundRow()
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10)
      wheel(-10) // 'Menü-Hintergrund' (5, the new last row)

      const row = screen.getByText('Menü-Hintergrund').closest('[role="button"]')
      expect(row).not.toBeNull()
      expect(row?.textContent).toContain('Schwarz')
    })

    it('confirming the row cycles all four options (store, row value, sidebar modifier)', async () => {
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const nav = container.querySelector('nav') as HTMLElement
      expect(view.className).not.toContain('viewUnderflow')
      expect(nav.className).not.toContain('glass')
      expect(nav.className).not.toContain('clear')

      toSidebarBackgroundRow()
      await screen.findByText('Settings')
      confirmDial() // sub-level
      for (let i = 0; i < 5; i++) wheel(-10) // to 'Menü-Hintergrund' (5)
      confirmDial()

      // 1: Schwarz → Halbdurchsichtig
      expect(getSettings().sidebarBackground).toBe('translucent')
      const row = screen.getByText('Menü-Hintergrund').closest('[role="button"]')
      expect(rowValue(row)).toBe('Halbdurchsichtig')
      // 08.09 user change (incl. v2): only the panel's look changes (the
      // glass class) — the layout stays solid (no underflow), so no view
      // modifier is added
      expect(view.className).not.toContain('viewUnderflow')
      expect(nav.className).toContain('glass')
      expect(nav.className).not.toContain('clear')

      // 2: Halbdurchsichtig → Durchsichtig (100% transparent, v2)
      confirmDial()
      expect(getSettings().sidebarBackground).toBe('clear')
      expect(rowValue(row)).toBe('Durchsichtig')
      expect(view.className).not.toContain('viewUnderflow')
      expect(nav.className).toContain('clear')
      expect(nav.className).not.toContain('glass')

      // 3: Durchsichtig → Unschärfe (bug58)
      confirmDial()
      expect(getSettings().sidebarBackground).toBe('blur')
      expect(rowValue(row)).toBe('Unschärfe')
      // T1/T4: the panel look is the glass one (blur reuses .glass — no own
      // class, SidebarNav unchanged); T2: the underflow layout is ACTIVE —
      // the content pane spans the full screen and the carousel slides under
      // the sidebar (carousel + settings-list assertions in the dedicated
      // test below; the per-card blur follows in T3)
      expect(view.className).toContain('viewUnderflow')
      expect(nav.className).toContain('glass')
      expect(nav.className).not.toContain('clear')

      // 4: Unschärfe → Schwarz (full cycle closed)
      confirmDial()
      expect(getSettings().sidebarBackground).toBe('solid')
      expect(rowValue(row)).toBe('Schwarz')
      expect(view.className).not.toContain('viewUnderflow')
      expect(nav.className).not.toContain('glass')
      expect(nav.className).not.toContain('clear')
    })

    it('keeps the solid carousel geometry in translucent mode (cards clipped at the menu edge, not under it)', async () => {
      // 08.09 user change: the acceptance criteria flipped — 'translucent'
      // must NOT reveal the cards under the menu. The carousel keeps the
      // solid layout: no .underflow padding on the scroll port, no negative
      // margin on the content pane (.viewUnderflow), so the pane's
      // overflow:hidden clips the cards at the sidebar's right edge exactly
      // like solid mode
      updateSettings({ sidebarBackground: 'translucent' })
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const carousel = container.querySelector('.carousel') as HTMLElement
      expect(carousel).not.toBeNull()
      expect(view.className).not.toContain('viewUnderflow')
      expect(carousel.className).not.toContain('underflow')

      // toggling back to solid changes nothing about the carousel layout
      act(() => {
        updateSettings({ sidebarBackground: 'solid' })
      })
      expect((container.firstElementChild as HTMLElement).className).not.toContain('viewUnderflow')
      expect((container.querySelector('.carousel') as HTMLElement).className).not.toContain(
        'underflow',
      )
    })

    it('keeps the solid carousel geometry in clear mode (cards clipped at the menu edge, not under it)', async () => {
      // v2: the 100% transparent mode clips the cards at the menu edge just
      // like 'solid' and 'translucent' — only the panel background is gone
      // (.clear instead of .glass on the nav)
      updateSettings({ sidebarBackground: 'clear' })
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const nav = container.querySelector('nav') as HTMLElement
      const carousel = container.querySelector('.carousel') as HTMLElement
      expect(carousel).not.toBeNull()
      expect(nav.className).toContain('clear')
      expect(nav.className).not.toContain('glass')
      expect(view.className).not.toContain('viewUnderflow')
      expect(carousel.className).not.toContain('underflow')

      // toggling to another mode changes nothing about the carousel layout
      act(() => {
        updateSettings({ sidebarBackground: 'translucent' })
      })
      expect((container.firstElementChild as HTMLElement).className).not.toContain('viewUnderflow')
      expect((container.querySelector('.carousel') as HTMLElement).className).not.toContain(
        'underflow',
      )
    })

    it('the settings list keeps the solid layout in translucent mode (no underflow inset)', async () => {
      updateSettings({ sidebarBackground: 'translucent' })
      const { container } = render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      const list = container.querySelector('[aria-label="Einstellungen"]') as HTMLElement
      expect(list.parentElement?.className).not.toContain('settingsUnderflow')
    })

    it('the three non-blur modes render the identical solid carousel layout (blur underflows)', async () => {
      // geometry contract: 'solid' / 'translucent' / 'clear' drive the
      // carousel with underflowPx=0 (the default dialScrollLeft path,
      // bit-exact the solid formula — pinned in carouselWindow.test.ts), so
      // card positioning, the centering target and the scroll clamps are
      // identical; the only DOM difference is the sidebar's background
      // class. bug58 T2: 'blur' DIVERGES — underflowPx=SIDEBAR_WIDTH (the
      // cards pass under the sidebar), pinned in the dedicated test below.
      updateSettings({ sidebarBackground: 'translucent' })
      const { container } = render(<MainMenuView />)
      const layout = () =>
        [
          (container.firstElementChild as HTMLElement).className,
          (container.querySelector('.carousel') as HTMLElement).className,
          (container.querySelector('[aria-label="Menü-Inhalt"]') as HTMLElement).className,
        ].join('|')
      const solidLayout = layout()
      act(() => {
        updateSettings({ sidebarBackground: 'clear' })
      })
      expect(layout()).toBe(solidLayout)
      act(() => {
        updateSettings({ sidebarBackground: 'solid' })
      })
      expect(layout()).toBe(solidLayout)
      // blur diverges: the underflow geometry is active (see below)
      act(() => {
        updateSettings({ sidebarBackground: 'blur' })
      })
      expect(layout()).not.toBe(solidLayout)
      expect((container.firstElementChild as HTMLElement).className).toContain('viewUnderflow')
      expect((container.querySelector('.carousel') as HTMLElement).className).toContain('underflow')
    })

    it('enables the under-the-menu geometry in blur mode (cards pass under the sidebar)', async () => {
      // bug58 T2: 'Unschärfe' re-activates the Bug54-gated underflow
      // mechanism — the content pane spans the full screen (.viewUnderflow,
      // clipped at the SCREEN edge), the carousel viewport starts under the
      // sidebar (underflowPx=SIDEBAR_WIDTH → the .underflow padding + the
      // underflow dial centering geometry) and the settings list keeps its
      // left inset (.settingsUnderflow). The per-card blur itself follows in
      // T3.
      updateSettings({ sidebarBackground: 'blur' })
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement
      const carousel = container.querySelector('.carousel') as HTMLElement
      expect(carousel).not.toBeNull()
      expect(view.className).toContain('viewUnderflow')
      expect(carousel.className).toContain('underflow')

      // the settings list gets the underflow inset (display:block + padding)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      await screen.findByText('Settings')
      confirmDial() // sub-level, focus on 'Default Device' (0)
      const list = container.querySelector('[aria-label="Einstellungen"]') as HTMLElement
      expect(list.parentElement?.className).toContain('settingsUnderflow')

      // toggling to a non-blur mode disables the underflow again (solid
      // layout: no pane margin, no carousel padding, display:contents list)
      act(() => {
        updateSettings({ sidebarBackground: 'translucent' })
      })
      expect((container.firstElementChild as HTMLElement).className).not.toContain('viewUnderflow')
      expect(list.parentElement?.className).not.toContain('settingsUnderflow')
    })
  })

  describe('bug41: queue selection resets focus & scroll to index 0', () => {
    // 100 upcoming tracks — long enough that the carousel is windowed both
    // before and after the skip (bug5/6/18, like the bug32/bug39 fixtures)
    const hundredQueue = Array.from({ length: 100 }, (_, i) => ({
      uri: `spotify:track:b41-${i}`,
      track_id: `b41-${i}`,
      name: `Queue ${i + 1}`,
      artist: 'Someone',
      album: '',
      image_url: '',
    }))
    const hundredQueueNowPlaying: ObserverStatusActive = {
      ...queueNowPlaying,
      next_tracks: hundredQueue,
    }

    function enterNowPlaying(): void {
      fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))
    }

    function carouselEl(container: HTMLElement): HTMLElement {
      return container.querySelector('.carousel') as HTMLElement
    }

    // simulate the device viewport settled deep into the queue (like bug39)
    function setDeviceScroll(container: HTMLElement, scrollLeft: number, width = 550): void {
      const carousel = carouselEl(container)
      carousel.scrollLeft = scrollLeft
      Object.defineProperty(carousel, 'clientWidth', { value: width, configurable: true })
    }

    it('selecting an upcoming queue track keeps the bug26 context skip and resets the focus to index 0', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView nowPlaying={queueNowPlaying} onPlay={onPlay} />)

      // land in the now-playing content pane via a recent track
      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      await waitFor(() => expect(screen.getByText('Siamese Dream')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Siamese Dream'))

      wheel(-10) // focus 'Next Song' (index 1)
      confirmDial()

      // bug26 unchanged: the live context plays starting at the selected track
      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:playlist:queue-pl', {
        position: 1,
        uri: 'spotify:track:t-10',
      })
      // bug41: the focus went back to index 0 (the current track card) instead
      // of staying stuck at the selected card
      expect(screen.getByText('Heat Waves').closest('.card')).toHaveClass('cardFocused')
      expect(screen.getByText('Next Song').closest('.card')).not.toHaveClass('cardFocused')
    })

    it('a deep queue skip (index N > 1) also resets the focus to index 0', async () => {
      const onPlay = vi.fn()
      render(<MainMenuView nowPlaying={hundredQueueNowPlaying} onPlay={onPlay} />)

      enterNowPlaying()
      for (let i = 0; i < 5; i++) wheel(-10) // focus 'Queue 6' (index 5)
      confirmDial()

      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenCalledWith('spotify:playlist:queue-pl', {
        position: 5,
        uri: 'spotify:track:b41-4',
      })
      // the current track card is focused again, the selected one is not
      expect(screen.getByText('Heat Waves').closest('.card')).toHaveClass('cardFocused')
      expect(screen.getByText('Queue 6').closest('.card')).not.toHaveClass('cardFocused')
    })

    it('resets the carousel scroll to index 0 when the active track changes via queue selection', async () => {
      const onPlay = vi.fn()
      const { container, rerender } = render(
        <MainMenuView nowPlaying={hundredQueueNowPlaying} onPlay={onPlay} />,
      )

      // settle deep into the queue: focus at 'Queue 41' (index 41) and the
      // viewport measured at the matching deep offset
      enterNowPlaying()
      for (let i = 0; i < 40; i++) wheel(-10)
      setDeviceScroll(container, 40 * 194 - 24)
      wheel(-10) // one more tick samples the deep offset into the guard's baseline

      // skip to 'Queue 41' (index 41 = queue position 41)
      confirmDial()
      expect(onPlay).toHaveBeenCalledTimes(1)
      expect(onPlay).toHaveBeenCalledWith('spotify:playlist:queue-pl', {
        position: 41,
        uri: 'spotify:track:b41-40',
      })
      // the focus is already back at index 0, but the list — and the physical
      // scroll position — are still the old ones until the observer arrives
      expect(screen.getByText('Heat Waves').closest('.card')).toHaveClass('cardFocused')

      // the observer poll lands: the selected track is the new current track
      // and the queue re-orders WITHOUT a category change
      const afterSkip: ObserverStatusActive = {
        ...hundredQueueNowPlaying,
        track_id: 'b41-40',
        track_uri: 'spotify:track:b41-40',
        track_name: 'Queue 41',
        track_artist: 'Someone',
        track_image: '',
        next_tracks: hundredQueue.slice(41),
      }
      rerender(<MainMenuView nowPlaying={afterSkip} onPlay={onPlay} />)

      // bug41: the viewport is back at 0 and the new current track ('Queue 41')
      // sits at index 0 under the active focus — the pure index-0 window, no
      // stale cards from the old deep position
      expect(carouselEl(container).scrollLeft).toBe(0)
      const articles = container.querySelectorAll('article')
      expect(articles).toHaveLength(17)
      expect(articles[0].textContent).toContain('Queue 41')
      expect(screen.getByText('Queue 41').closest('.card')).toHaveClass('cardFocused')
      // windowed at index 0: nothing past the 17-card window is mounted
      expect(screen.queryByText('Queue 58')).not.toBeInTheDocument()
    })

    it('an observer re-projection without a track change does NOT reset the scroll', async () => {
      const { container, rerender } = render(
        <MainMenuView nowPlaying={hundredQueueNowPlaying} />,
      )

      enterNowPlaying()
      for (let i = 0; i < 20; i++) wheel(-10)
      // a measured device viewport so the dial ticks scroll for real:
      // bug47 R2 (F2) centers the focus arithmetically on every tick
      setDeviceScroll(container, 20 * 194 - 24)
      wheel(-10) // focus 21 — the tick wrote the exact centering offset

      // the 3s observer poll hands over a fresh object with the SAME scalars
      // (new array identity, same active track and queue)
      const repolled: ObserverStatusActive = {
        ...hundredQueueNowPlaying,
        next_tracks: hundredQueue.map((track) => ({ ...track })),
      }
      rerender(<MainMenuView nowPlaying={repolled} />)

      // no track change → the dial-centered deep position is preserved
      // (bug8.1: a focus move never resets, and neither does a same-track
      // re-projection) — 101 cards (1 current + 100 queue), focus 21, 550px
      expect(carouselEl(container).scrollLeft).toBe(dialScrollLeft(101, 21, 550))
      // the window still covers the deep position, not the index-0 window
      expect(screen.getByText('Queue 22')).toBeInTheDocument()
    })
  })

  describe('bug53: light-card press/hold (press = toggle, hold = dim view)', () => {
    // the live HA facts: the first light (card 0 of the Home carousel)
    // reports dimmable color modes; the toggle POSTs are counted. The toggle
    // response must ECHO the color-mode attributes — the view trusts the
    // service answer over the store (useHomeEntities.actuate) and an
    // empty-attributes answer would wipe the dimmable capability right after
    // the first actuation (a subsequent hold would then actuate instead of
    // opening the dim view)
    function seedDimmableFirstLight() {
      const toggled: string[] = []
      const attributes = {
        supported_color_modes: ['color_temp', 'xy'],
        min_color_temp_kelvin: 2202,
        max_color_temp_kelvin: 6535,
      }
      server.use(
        http.get('*/ha-api/states/light.3er_stehlampe_gold_esszimmer', () =>
          HttpResponse.json({
            entity_id: 'light.3er_stehlampe_gold_esszimmer',
            state: 'off',
            attributes,
          }),
        ),
        http.post('*/ha-api/services/light/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          return HttpResponse.json([{ entity_id: body.entity_id, state: 'on', attributes }])
        }),
      )
      return toggled
    }

    it('a dial press on a dimmable light card actuates (toggle POST), the dim view does NOT open', async () => {
      const onOpenLightControl = vi.fn()
      const toggled = seedDimmableFirstLight()
      render(<MainMenuView onOpenLightControl={onOpenLightControl} />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      // Home is the focused sidebar item — confirm enters the content pane
      // with card 0 (the dimmable light) focused
      confirmDial()
      // single press (dial) → actuate for ALL domains, dimmable lights included
      confirmDial()

      await waitFor(() => expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer']))
      expect(onOpenLightControl).not.toHaveBeenCalled()
    })

    it('a dial hold on a dimmable light card opens the dim view without toggling', async () => {
      const onOpenLightControl = vi.fn()
      const toggled = seedDimmableFirstLight()
      render(<MainMenuView onOpenLightControl={onOpenLightControl} />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      confirmDial() // enter the Home content pane, card 0 focused

      // the hardware layer fires entry.onHold for a press held ≥ CARD_HOLD_MS
      act(() => {
        ListFocusContext.entry.onHold?.()
      })

      expect(onOpenLightControl).toHaveBeenCalledWith(
        'light.3er_stehlampe_gold_esszimmer',
        '3er Stehlampe Gold',
      )
      // a hold must NOT actuate
      expect(toggled).toEqual([])
    })

    it('a press AND a hold on a non-dimmable switch card actuate (like a press)', async () => {
      // the default selection is the 9 lights — make the switch the ONLY card
      window.localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(['switch.wasserpumpe']))
      const toggled: string[] = []
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: 'switch.wasserpumpe', state: 'off' }),
        ),
        http.post('*/ha-api/services/switch/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          return HttpResponse.json([{ entity_id: body.entity_id, state: 'on', attributes: {} }])
        }),
      )
      render(<MainMenuView />)
      await screen.findByText('Wasserpumpe') // the switch card (card 0)

      confirmDial() // enter the Home content pane
      confirmDial() // press → actuate
      await waitFor(() => expect(toggled).toEqual(['switch.wasserpumpe']))

      // holding a non-dimmable entity behaves like a press (no dead gesture,
      // no dim view exists for it)
      act(() => {
        ListFocusContext.entry.onHold?.()
      })
      await waitFor(() => expect(toggled).toEqual(['switch.wasserpumpe', 'switch.wasserpumpe']))
    })

    it('a light without brightness/color_temp support keeps the direct toggle on press', async () => {
      const onOpenLightControl = vi.fn()
      const toggled: string[] = []
      server.use(
        http.get('*/ha-api/states/light.esstisch_hangelampe_3er', () =>
          HttpResponse.json({
            entity_id: 'light.esstisch_hangelampe_3er',
            state: 'off',
            attributes: { supported_color_modes: [] },
          }),
        ),
        http.post('*/ha-api/services/light/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          return HttpResponse.json([{ entity_id: body.entity_id, state: 'on', attributes: {} }])
        }),
      )
      render(<MainMenuView onOpenLightControl={onOpenLightControl} />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      fireEvent.click(screen.getByText('Esstisch Hängelampe'))

      await waitFor(() => expect(toggled).toEqual(['light.esstisch_hangelampe_3er']))
      expect(onOpenLightControl).not.toHaveBeenCalled()
    })

    it('a light advertising only the legacy SUPPORT_BRIGHTNESS bit: press toggles, hold opens the dim view', async () => {
      const onOpenLightControl = vi.fn()
      const toggled: string[] = []
      server.use(
        http.get('*/ha-api/states/light.3er_deko_esszimmer', () =>
          HttpResponse.json({
            entity_id: 'light.3er_deko_esszimmer',
            state: 'off',
            // no supported_color_modes at all, but the legacy feature bit
            // SUPPORT_BRIGHTNESS = 1 (bit 0) is set
            attributes: { supported_features: 1 },
          }),
        ),
        http.post('*/ha-api/services/light/toggle', async ({ request }) => {
          const body = (await request.json()) as { entity_id?: string }
          toggled.push(body.entity_id ?? '')
          // echo the legacy capability bit — the view trusts the service
          // answer over the store (empty attributes would wipe dimmable)
          return HttpResponse.json([
            { entity_id: body.entity_id, state: 'on', attributes: { supported_features: 1 } },
          ])
        }),
      )
      render(<MainMenuView onOpenLightControl={onOpenLightControl} />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      // press (tap) → toggle, no dim view
      fireEvent.click(screen.getByText('3er Deko'))
      await waitFor(() => expect(toggled).toEqual(['light.3er_deko_esszimmer']))
      expect(onOpenLightControl).not.toHaveBeenCalled()

      // hold (dial) on the same card (HOME_LIGHTS[2] → card index 2) → dim
      // view. The tap did not change the active pane (selectContent only
      // moves the content index), so confirm enters the content pane first
      // and the two wheel ticks land the focus back on card 2
      confirmDial()
      wheel(-10)
      wheel(-10)
      act(() => {
        ListFocusContext.entry.onHold?.()
      })
      expect(onOpenLightControl).toHaveBeenCalledWith('light.3er_deko_esszimmer', '3er Deko')
      // the hold must not actuate a second time
      expect(toggled).toEqual(['light.3er_deko_esszimmer'])
    })

    it('touch: a tap toggles, a held pointer opens the dim view, a drag (slop) does neither', async () => {
      const onOpenLightControl = vi.fn()
      const toggled = seedDimmableFirstLight()
      render(<MainMenuView onOpenLightControl={onOpenLightControl} />)
      await waitFor(() => {
        expect(screen.getAllByText('Aus')).toHaveLength(HOME_LIGHTS.length)
      })

      const card = screen.getByText('3er Stehlampe Gold').closest('.card') as HTMLElement

      // (a) short press: pointerdown → pointerup inside the threshold → the
      // browser click that follows is a plain TAP (actuate)
      vi.useFakeTimers()
      fireEvent.pointerDown(card, { clientX: 10, clientY: 10, pointerId: 1 })
      vi.advanceTimersByTime(200) // < CARD_HOLD_MS
      fireEvent.pointerUp(card, { pointerId: 1 })
      vi.useRealTimers()
      fireEvent.click(card)
      await waitFor(() => expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer']))
      expect(onOpenLightControl).not.toHaveBeenCalled()

      // (b) held pointer: pointerdown → ≥ CARD_HOLD_MS → onCardHold (dim
      // view); the browser click that follows the long press is suppressed
      vi.useFakeTimers()
      fireEvent.pointerDown(card, { clientX: 20, clientY: 20, pointerId: 1 })
      vi.advanceTimersByTime(CARD_HOLD_MS + 50)
      fireEvent.pointerUp(card, { pointerId: 1 })
      vi.useRealTimers()
      fireEvent.click(card) // must be suppressed by the held flag
      expect(onOpenLightControl).toHaveBeenCalledWith(
        'light.3er_stehlampe_gold_esszimmer',
        '3er Stehlampe Gold',
      )
      expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer'])

      // (c) drag: movement beyond the slop before release cancels the hold —
      // a swipe is never a hold (useSwipeGestures territory)
      vi.useFakeTimers()
      fireEvent.pointerDown(card, { clientX: 30, clientY: 30, pointerId: 1 })
      fireEvent.pointerMove(card, { clientX: 80, clientY: 30, pointerId: 1 })
      vi.advanceTimersByTime(CARD_HOLD_MS + 50)
      fireEvent.pointerUp(card, { pointerId: 1 })
      vi.useRealTimers()
      expect(onOpenLightControl).toHaveBeenCalledTimes(1) // no second dim view
      expect(toggled).toHaveLength(1) // and no second toggle
    })
  })
})
