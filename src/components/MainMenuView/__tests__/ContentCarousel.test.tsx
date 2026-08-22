import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const hookState = vi.hoisted(() => ({
  toggle: vi.fn(),
}))

vi.mock('@/hooks/usePlaylists', () => ({
  usePlaylists: () => ({
    items: [
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
    ],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))

vi.mock('@/hooks/useRecent', () => ({
  useRecent: () => ({
    items: [
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
    ],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))

vi.mock('@/hooks/usePlaylistTracks', () => ({
  // bug4: the track sub-menu data, one page of one track per playlist
  usePlaylistTracks: (playlistId: string | null) => ({
    tracks: playlistId
      ? [
           {
            id: `tr-${playlistId}-1`,
            name: 'First Track',
            uri: `spotify:track:tr-${playlistId}-1`,
            artists: [{ name: 'Someone' }],
            album: { name: 'An Album', images: [{ url: 'http://img/tr.jpg' }] },
            position: 0,
          },
        ]
      : [],
    total: playlistId ? 1 : 0,
    loading: false,
    loadingMore: false,
    error: null,
    loadMore: () => {},
    refetch: () => {},
  }),
  clearTracksCache: () => {},
}))

vi.mock('@/hooks/useHomeLight', () => ({
  HOME_LIGHT_LABEL: '3er Stehlampe Gold',
  useHomeLight: () => ({
    state: 'on',
    loading: false,
    error: null,
    toggling: false,
    toggle: hookState.toggle,
  }),
}))

vi.mock('@/settings', () => ({
  useSettings: () => ({
    showLyrics: false,
    karaokeLyrics: false,
    lyricOffsetMs: 0,
    volumeStepPct: 5,
    autoBrightness: true,
    brightness: 70,
    voiceMic: false,
    uiScalePct: 100,
    presets: {},
    defaultDeviceId: null,
  }),
}))

import { MainMenuView } from '../MainMenuView'
import { ContentCarousel } from '../ContentCarousel'
import { carouselCardAreEqual } from '../carouselCardCompare'
import type { MenuCard } from '../mockData'
import type { ObserverStatusActive } from '@/api/types'

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
  next_tracks: [
    {
      uri: 'spotify:track:t-10',
      track_id: 't-10',
      name: 'Next Song',
      artist: 'Someone',
      album: 'An Album',
      image_url: '',
    },
  ],
}

describe('ContentCarousel', () => {
  beforeEach(() => {
    hookState.toggle.mockClear()
  })

  it('binds the Home category to the live light state', () => {
    render(<MainMenuView />)
    expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
    expect(screen.getByText('An')).toBeInTheDocument()
  })

  it('binds the Playlists category to the fetched playlists, title only (bug2.3)', () => {
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(screen.getByText('Road Trip')).toBeInTheDocument()
    // owner name and track count are no longer rendered on playlist cards
    expect(screen.queryByText('Mira Mix · 12 Titel')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.subtitle')).toHaveLength(0)
    expect(screen.getByText('Workout')).toBeInTheDocument()
    expect(container.querySelectorAll('.card')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Road Trip' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Road Trip' })).toHaveClass('card')
  })

  it('binds the Zuletzt category to recently played tracks', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
    expect(screen.getByText('Siamese Dream')).toBeInTheDocument()
    expect(screen.getByText('The Smashing Pumpkins')).toBeInTheDocument()
  })

  it('binds the Einstellungen category to live settings values', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    expect(screen.getByText('Lyrics')).toBeInTheDocument()
    expect(screen.getByText('Auto · 70%')).toBeInTheDocument()
    expect(screen.getByText('+5% pro Schritt')).toBeInTheDocument()
    expect(screen.getByText('Sprach-Mikrofon')).toBeInTheDocument()
  })

  it('tapping a playlist card opens its track list without starting playback (bug4)', () => {
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    fireEvent.click(screen.getByText('Road Trip'))
    // the sub-menu shows the playlist's tracks, playback is not triggered yet
    expect(onPlay).not.toHaveBeenCalled()
    expect(screen.getByText('First Track')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Playlists' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('tapping a track card in the sub-menu plays the playlist context at the track offset (bug4, bug16)', () => {
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    fireEvent.click(screen.getByText('Road Trip'))
    fireEvent.click(screen.getByText('First Track'))
    // the parent playlist context is played starting at the track's position,
    // so the rest of the playlist stays in the queue (bug16)
    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl-1', {
      position: 0,
      uri: 'spotify:track:tr-pl-1-1',
    })
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText('Nichts läuft')).toBeInTheDocument()
  })

  it('tapping the light action card toggles the light without leaving the menu', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByText('3er Stehlampe Gold'))
    expect(hookState.toggle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('shows the current track and queue in the Läuft gerade category after starting playback', () => {
    render(<MainMenuView nowPlaying={nowPlaying} />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    fireEvent.click(screen.getByText('Road Trip'))
    fireEvent.click(screen.getByText('First Track'))
    expect(screen.getByText('Heat Waves')).toBeInTheDocument()
    expect(screen.getByText('Glass Animals')).toBeInTheDocument()
    expect(screen.getByText('Next Song')).toBeInTheDocument()
  })

  it('tapping Läuft gerade in the sidebar exits the menu', () => {
    const onExit = vi.fn()
    render(<MainMenuView onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})

// stable card fixtures so re-renders can be told apart from data changes
const CARDS_A: MenuCard[] = [
  { id: 'a-1', title: 'Alpha', subtitle: 'One' },
  { id: 'a-2', title: 'Beta', subtitle: 'Two' },
  { id: 'a-3', title: 'Gamma', subtitle: 'Three' },
]
const CARDS_B: MenuCard[] = [
  { id: 'b-1', title: 'Delta', subtitle: 'Four' },
  { id: 'b-2', title: 'Epsilon', subtitle: 'Five' },
]

describe('bug8.1: scroll reset scoped to category changes', () => {
  let setLeft: MockInstance

  beforeEach(() => {
    setLeft = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
    vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not reset the scroll when the focus moves within the same category', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={CARDS_A} categoryId="playlists" focusedIndex={0} />,
    )
    setLeft.mockClear()
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    rerender(<ContentCarousel cards={CARDS_A} categoryId="playlists" focusedIndex={1} />)

    // the dial tick only centers the new card — no jump back to card 0
    expect(setLeft).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('article')).toHaveLength(3)
  })

  it('does not reset the scroll when the cards array identity changes within the same category', () => {
    const { rerender } = render(
      <ContentCarousel cards={CARDS_A} categoryId="playlists" focusedIndex={0} />,
    )
    setLeft.mockClear()

    // the parent rebuilds the cards array on every render (memo identity churn)
    rerender(<ContentCarousel cards={[...CARDS_A]} categoryId="playlists" focusedIndex={0} />)

    expect(setLeft).not.toHaveBeenCalled()
  })

  it('resets the scroll to the first card when the category changes', () => {
    const { rerender } = render(
      <ContentCarousel cards={CARDS_A} categoryId="playlists" focusedIndex={2} />,
    )
    setLeft.mockClear()

    rerender(<ContentCarousel cards={CARDS_B} categoryId="recent" focusedIndex={0} />)

    expect(setLeft).toHaveBeenCalledWith(0)
  })
})

describe('bug5/bug6: windowed rendering', () => {
  // 20 cards: window is 3 before + focused + 8 after = 12 mounted cards
  const MANY: MenuCard[] = Array.from({ length: 20 }, (_, i) => ({
    id: `m-${i}`,
    title: `Card ${i}`,
    subtitle: '',
  }))

  it('mounts only the window around the focused card plus width spacers', () => {
    const { container } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={10} />,
    )
    // 3 before (7..9) + focused (10) + 8 after (11..18) = 12 cards
    expect(container.querySelectorAll('article')).toHaveLength(12)
    expect(screen.getByText('Card 7')).toBeInTheDocument()
    expect(screen.getByText('Card 18')).toBeInTheDocument()
    // off-screen cards are not mounted
    expect(screen.queryByText('Card 6')).not.toBeInTheDocument()
    expect(screen.queryByText('Card 19')).not.toBeInTheDocument()
    // invisible spacers keep the scroll width of the full list
    const spacers = container.querySelectorAll('.spacer')
    expect(spacers).toHaveLength(2)
    // 7 missing before: 7*(170+24)-24, 1 missing after: 170
    expect((spacers[0] as HTMLElement).style.width).toBe('1334px')
    expect((spacers[1] as HTMLElement).style.width).toBe('170px')
  })

  it('moves the window as the focus moves and keeps the focused card mounted', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={0} />,
    )
    expect(screen.getByText('Card 0')).toBeInTheDocument()
    expect(screen.queryByText('Card 12')).not.toBeInTheDocument()

    rerender(<ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={19} />)

    expect(screen.getByText('Card 19')).toBeInTheDocument()
    expect(screen.getByText('Card 16')).toBeInTheDocument()
    expect(screen.queryByText('Card 0')).not.toBeInTheDocument()
    // at the end of the list the window is clipped to the available cards
    expect(container.querySelectorAll('article')).toHaveLength(4)
    // only the leading spacer remains
    expect(container.querySelectorAll('.spacer')).toHaveLength(1)
    expect((container.querySelector('.spacer') as HTMLElement).style.width).toBe('3080px')
  })

  it('renders short lists in full without spacers', () => {
    const { container } = render(
      <ContentCarousel cards={CARDS_A} categoryId="recent" focusedIndex={0} />,
    )
    expect(container.querySelectorAll('article')).toHaveLength(3)
    expect(container.querySelectorAll('.spacer')).toHaveLength(0)
  })
})

describe('bug8.2: carousel card memo comparator', () => {
  const base = {
    card: CARDS_A[0],
    index: 0,
    isFocused: false,
    interactive: true,
  }

  it('keeps a card when its focus state is unchanged', () => {
    expect(carouselCardAreEqual(base, base)).toBe(true)
  })

  it('re-renders when the focus state flips', () => {
    expect(carouselCardAreEqual(base, { ...base, isFocused: true })).toBe(false)
  })

  it('re-renders when the card data identity changes', () => {
    expect(carouselCardAreEqual(base, { ...base, card: { ...CARDS_A[0] } })).toBe(false)
  })

  it('re-renders when the interactivity changes', () => {
    expect(carouselCardAreEqual(base, { ...base, interactive: false })).toBe(false)
  })
})
