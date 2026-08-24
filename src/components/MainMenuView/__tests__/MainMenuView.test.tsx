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
import { clearColorCache, seedColorCache, darkBg, rgba } from '@/hooks/useColorExtract'
import { __resetSettings, getSettings, updateSettings } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'

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

describe('MainMenuView', () => {
  beforeEach(() => {
    clearCache()
    clearRecentCache()
    clearTracksCache()
    clearColorCache()
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
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
      const lastEl = scrollSpy.mock.instances.at(-1)
      expect(lastEl).toBe(screen.getByText('Workout').closest('.card'))
      scrollSpy.mockRestore()
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

      // wait until the dynamic card data (playlists/recent) has arrived and
      // every dynamic cover is warmed (pl-2 has no images → no entry)
      await waitFor(() => {
        expect(new Set(created.map((img) => img.src))).toEqual(
          new Set(['http://img/h.jpg', 'http://img/r.jpg', 'http://img/s.jpg', 'http://img/liked.jpg']),
        )
      })

      const srcs = created.map((img) => img.src).sort()
      expect(srcs).toEqual(['http://img/h.jpg', 'http://img/liked.jpg', 'http://img/r.jpg', 'http://img/s.jpg'])
      // no duplicate warming: each URL is fetched exactly once
      expect(new Set(created.map((img) => img.src)).size).toBe(created.length)
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

    it('transitions to the new card color when the dial focus moves', async () => {
      seedColorCache('http://img/r.jpg', [245, 192, 74])
      seedColorCache('http://img/liked.jpg', [120, 60, 180])
      const { container } = render(<MainMenuView />)
      const view = container.firstElementChild as HTMLElement

      fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
      await screen.findByText('Road Trip')
      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([245, 192, 74]))

      // rotate past Workout (no art → static category colors) to the
      // Liked Songs card, whose seeded cover drives the ambient colors
      wheel(-10)
      wheel(-10)
      expect(view.style.getPropertyValue('--menu-bg')).toBe(darkBg([120, 60, 180]))
      expect(view.style.getPropertyValue('--menu-glow-a')).toBe(rgba([120, 60, 180], 0.5))
    })
  })

  describe('bug25: settings vertical list', () => {
    it('renders the six root rows instead of a carousel', async () => {
      render(<MainMenuView />)
      fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
      for (const label of [
        'Settings',
        'Show Lyrics',
        'Karaoke Lyrics',
        'Mic',
        'Devices',
        'Bluetooth Pairing',
      ]) {
        expect(await screen.findByText(label)).toBeInTheDocument()
      }
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
})
