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

  it('exits the menu immediately when Läuft gerade is confirmed', () => {
    const onExit = vi.fn()
    render(<MainMenuView onExit={onExit} />)

    wheel(-10)
    confirmDial()

    expect(onExit).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(screen.getByText('Lyrics')).toBeInTheDocument())

    // strictly the settings cards — no leftover track cards (bug15)
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

    it('exits the menu when the dial is confirmed on Läuft gerade', () => {
      const onExit = vi.fn()
      render(<MainMenuView nowPlaying={nowPlaying} onExit={onExit} />)

      wheel(-10)
      confirmDial()

      expect(onExit).toHaveBeenCalledTimes(1)
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
          new Set(['http://img/h.jpg', 'http://img/r.jpg', 'http://img/s.jpg']),
        )
      })

      const srcs = created.map((img) => img.src).sort()
      expect(srcs).toEqual(['http://img/h.jpg', 'http://img/r.jpg', 'http://img/s.jpg'])
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
    const queueNowPlaying: ObserverStatusActive = {
      ...nowPlaying,
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

      expect(onPlay).toHaveBeenCalledTimes(2)
      expect(onPlay).toHaveBeenLastCalledWith('spotify:track:t-10')
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

      fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
      const retry = await screen.findByText('Erneut versuchen')
      expect(calls).toBe(1)

      // confirming the error card triggers a refetch
      fireEvent.click(retry)
      await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
    })
  })
})
