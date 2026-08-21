import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MainMenuView } from '../MainMenuView'
import { MENU_CATEGORIES } from '../mockData'
import type { ObserverStatusActive } from '@/api/types'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
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

  it('starts playback when the focused media card is confirmed', async () => {
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)

    wheel(-10)
    wheel(-10)
    confirmDial()
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    confirmDial()

    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl-1')
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('exposes carousel cards as accessible buttons', async () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Road Trip' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Road Trip' })).toHaveClass('card')
  })

  it('shows a blurred background of the focused card artwork in the content pane', async () => {
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())

    // the crossfade is a passive effect; wait for it to land on the artwork
    await waitFor(() => {
      expect(container.querySelector('.albumBg .show img')).toHaveAttribute(
        'src',
        'http://img/r.jpg',
      )
    })
  })

  it('falls back to the static category gradient when the focused card has no artwork', async () => {
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    await waitFor(() => expect(screen.getByText('Road Trip')).toBeInTheDocument())
    await waitFor(() => {
      expect(container.querySelector('.albumBg .show img')).toHaveAttribute(
        'src',
        'http://img/r.jpg',
      )
    })

    // rotate the dial onto "Workout" (images: [])
    wheel(-10)

    await waitFor(() => {
      const shown = container.querySelector('.albumBg .show')
      expect(shown).not.toBeNull()
      expect(shown?.querySelectorAll('img')).toHaveLength(0)
    })
  })

  it('keeps a static gradient background in the settings view', async () => {
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    await waitFor(() => expect(screen.getByText('Lautstärke')).toBeInTheDocument())
    expect(container.querySelector('.albumBg img')).toBeNull()
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
})
