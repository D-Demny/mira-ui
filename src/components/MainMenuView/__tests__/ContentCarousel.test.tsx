import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'

const DEFAULT_RECENT_ITEMS = [
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

const hookState = vi.hoisted(() => ({
  toggle: vi.fn(),
  // bug39: per-test overridable recents fixture (default: the single track)
  recentItems: [
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
  // bug34: the main menu renders every configured light via useHomeLights()
  // (same entity list as the real hook's HOME_LIGHTS)
  lights: [
    { entityId: 'light.3er_stehlampe_gold_esszimmer', label: '3er Stehlampe Gold', room: 'Esszimmer' },
    { entityId: 'light.esstisch_hangelampe_3er', label: 'Esstisch Hängelampe', room: 'Esszimmer' },
    { entityId: 'light.3er_deko_esszimmer', label: '3er Deko', room: 'Esszimmer' },
    { entityId: 'light.kajplats_e27_ws_g60_clear_470lm', label: 'Stehlampe Gold', room: 'Wohnzimmer' },
    { entityId: 'light.kajplats_e14_ws_globe_806lm', label: 'Tischlampe', room: 'Gaderobe' },
    { entityId: 'light.gaderobe_lampe_3er', label: 'Lampe 3er', room: 'Gaderobe' },
    { entityId: 'light.kajplats_gu10_ws_575lm_3', label: 'Treppenspot Treppe', room: 'Flur Oben' },
    { entityId: 'light.kajplats_gu10_ws_575lm_5', label: 'Treppenspot Mitte', room: 'Flur Oben' },
    { entityId: 'light.kajplats_gu10_ws_575lm_6', label: 'Treppenspot Tür', room: 'Flur Oben' },
  ],
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
    // bug39: read through the hoisted state so tests can swap in long fixtures
    items: hookState.recentItems,
    loading: false,
    error: null,
    refetch: () => {},
    // bug37: the silent category-switch revalidation
    refresh: () => {},
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
  HOME_LIGHTS: hookState.lights,
  useHomeLights: () =>
    hookState.lights.map((light) => ({
      ...light,
      state: 'on',
      loading: false,
      error: null,
      toggling: false,
      toggle: hookState.toggle,
      refetch: () => {},
    })),
}))

vi.mock('@/settings', async (importOriginal) => {
  // the real constants + updateSettings stay in place; only the store values
  // are pinned for the assertions below
  const actual = (await importOriginal()) as typeof SettingsModule
  return {
    ...actual,
    useSettings: () => ({
      showLyrics: false,
      karaokeLyrics: false,
      lyricOffsetMs: 0,
      volumeStepPct: 5,
      autoBrightness: true,
      brightness: 7,
      voiceMic: false,
      uiScalePct: 100,
      presets: {},
      defaultDeviceId: null,
    }),
  }
})

import { ListFocusContext } from '@/navigation/listFocusContext'
import { MainMenuView } from '../MainMenuView'
import { ContentCarousel } from '../ContentCarousel'
import { carouselCardAreEqual } from '../carouselCardCompare'
import type { MenuCard } from '../mockData'
import type { ObserverStatusActive } from '@/api/types'
import type * as SettingsModule from '@/settings'

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
    // bug34: all nine lights render, each with the live on/off subtitle
    expect(screen.getAllByText('An')).toHaveLength(9)
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

  it('binds the Einstellungen category to the vertical settings list (bug25)', () => {
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
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // the mocked store has everything off
    const micRow = screen.getByText('Mic').closest('[aria-label]')
    expect(micRow?.textContent).toContain('Off')
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

  it('bug20: tapping Läuft gerade in the sidebar opens the queue pane, it no longer exits', () => {
    const onExit = vi.fn()
    render(<MainMenuView onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))
    // the sidebar item behaves like every other category: it switches to the
    // content pane (the queue) instead of jumping straight to the player
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByText('Nichts läuft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
      'aria-current',
      'true',
    )
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

describe('bug5/bug6/bug18: windowed rendering', () => {
  // 50 cards: long enough (> NO_WINDOW_THRESHOLD) that windowing applies.
  // In jsdom the carousel measures 0px wide, so the viewport safety guard is
  // disabled and the pure 16/16 index window is exercised.
  const MANY: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `m-${i}`,
    title: `Card ${i}`,
    subtitle: '',
  }))

  it('mounts the symmetrical 16/16 window around the focused card plus width spacers', () => {
    const { container } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={25} />,
    )
    // 16 before (9..24) + focused (25) + 16 after (26..41) = 33 cards
    expect(container.querySelectorAll('article')).toHaveLength(33)
    expect(screen.getByText('Card 9')).toBeInTheDocument()
    expect(screen.getByText('Card 41')).toBeInTheDocument()
    // off-screen cards are not mounted
    expect(screen.queryByText('Card 8')).not.toBeInTheDocument()
    expect(screen.queryByText('Card 42')).not.toBeInTheDocument()
    // invisible spacers keep the scroll width of the full list
    const spacers = container.querySelectorAll('.spacer')
    expect(spacers).toHaveLength(2)
    // 9 missing before: 9*(170+24)-24, 8 missing after: 8*170+7*24
    expect((spacers[0] as HTMLElement).style.width).toBe('1722px')
    expect((spacers[1] as HTMLElement).style.width).toBe('1528px')
  })

  it('clips at the start of the list (no leading spacer at focus 0)', () => {
    const { container } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={0} />,
    )
    // 0 before + focused (0) + 16 after (1..16) = 17 cards
    expect(container.querySelectorAll('article')).toHaveLength(17)
    expect(screen.getByText('Card 0')).toBeInTheDocument()
    expect(screen.queryByText('Card 17')).not.toBeInTheDocument()
    const spacers = container.querySelectorAll('.spacer')
    expect(spacers).toHaveLength(1)
    // 33 missing after: 33*170+32*24
    expect((spacers[0] as HTMLElement).style.width).toBe('6378px')
  })

  it('clips at the end of the list (no trailing spacer at the last card)', () => {
    const { container } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={49} />,
    )
    // 16 before (33..48) + focused (49) = 17 cards
    expect(container.querySelectorAll('article')).toHaveLength(17)
    expect(screen.getByText('Card 49')).toBeInTheDocument()
    expect(screen.getByText('Card 33')).toBeInTheDocument()
    const spacers = container.querySelectorAll('.spacer')
    expect(spacers).toHaveLength(1)
    // 33 missing before: 33*(170+24)-24
    expect((spacers[0] as HTMLElement).style.width).toBe('6378px')
  })

  it('renders short lists (< 40 items) in full without spacers (bug18)', () => {
    const SHORT: MenuCard[] = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${i}`,
      title: `Short ${i}`,
      subtitle: '',
    }))
    const { container } = render(
      <ContentCarousel cards={SHORT} categoryId="playlists" focusedIndex={10} />,
    )
    expect(container.querySelectorAll('article')).toHaveLength(20)
    expect(container.querySelectorAll('.spacer')).toHaveLength(0)
  })
})

describe('bug47: focusScrollBehavior per input type', () => {
  const FEW: MenuCard[] = [
    { id: 'f-1', title: 'First', subtitle: '' },
    { id: 'f-2', title: 'Second', subtitle: '' },
    { id: 'f-3', title: 'Third', subtitle: '' },
  ]

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dial ticks (behavior auto) scroll the focus into view instantly', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const { rerender } = render(
      <ContentCarousel
        cards={FEW}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
      />,
    )
    scrollIntoView.mockClear()

    // the wheel tick moves the focus — the scroll must be instant
    rerender(
      <ContentCarousel
        cards={FEW}
        categoryId="playlists"
        focusedIndex={1}
        focusScrollBehavior="auto"
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', inline: 'center' })
  })

  it('jumps (tap/confirm, behavior smooth) keep the smooth scroll', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const { rerender } = render(
      <ContentCarousel
        cards={FEW}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="smooth"
      />,
    )
    scrollIntoView.mockClear()

    rerender(
      <ContentCarousel
        cards={FEW}
        categoryId="playlists"
        focusedIndex={1}
        focusScrollBehavior="smooth"
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
  })

  it('defaults to the smooth scroll when no behavior prop is given (standalone usage)', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const { rerender } = render(<ContentCarousel cards={FEW} categoryId="playlists" focusedIndex={0} />)
    scrollIntoView.mockClear()

    rerender(<ContentCarousel cards={FEW} categoryId="playlists" focusedIndex={1} />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
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

describe('bug39: category switch purges window state & scroll offset', () => {
  const CARD_STEP = 194 // CARD_WIDTH + CARD_GAP
  const LONG_A: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `q-${i}`,
    title: `Queue ${i}`,
    subtitle: '',
  }))
  const LONG_C: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `rc-${i}`,
    title: `Recent ${i}`,
    subtitle: '',
  }))
  const SHORT_B: MenuCard[] = Array.from({ length: 8 }, (_, i) => ({
    id: `pl-${i}`,
    title: i === 0 ? 'Liked Songs' : `Playlist ${i}`,
    subtitle: '',
  }))

  function carouselEl(container: HTMLElement): HTMLElement {
    return container.querySelector('.carousel') as HTMLElement
  }

  // simulate the device viewport: a 550px-wide carousel settled deep into the
  // previous category's list (the smooth-scroll position at switch time)
  function setDeviceScroll(el: HTMLElement, scrollLeft: number, width = 550): void {
    el.scrollLeft = scrollLeft
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
  }

  // dial one tick so the metrics effect samples the simulated scroll position
  function sampleScroll(
    rerender: (ui: ReactElement) => void,
    cards: MenuCard[],
    categoryId: string,
    focus: number,
  ): void {
    rerender(<ContentCarousel cards={cards} categoryId={categoryId} focusedIndex={focus + 1} />)
  }

  it('switching from a long (windowed) list to a short one renders strictly the new cards from index 0', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={LONG_A} categoryId="now-playing" focusedIndex={30} />,
    )
    // the previous category settled at a deep scroll position
    setDeviceScroll(carouselEl(container), 30 * CARD_STEP - 24)
    sampleScroll(rerender, LONG_A, 'now-playing', 30)

    // switch to a short category (e.g. Playlists) at index 0
    rerender(<ContentCarousel cards={SHORT_B} categoryId="playlists" focusedIndex={0} />)

    // strictly the new cards — index 0 is the leftmost rendered card
    const articles = container.querySelectorAll('article')
    expect(articles).toHaveLength(8)
    expect(articles[0].textContent).toContain('Liked Songs')
    // no leftover card of the previous view, no residual width holder
    expect(screen.queryByText('Queue 31')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.spacer')).toHaveLength(0)
    // the viewport is reset to 0
    expect(carouselEl(container).scrollLeft).toBe(0)
  })

  it('switching between two long lists resets the window to the pure index-0 window', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={LONG_A} categoryId="now-playing" focusedIndex={30} />,
    )
    setDeviceScroll(carouselEl(container), 30 * CARD_STEP - 24)
    sampleScroll(rerender, LONG_A, 'now-playing', 30)
    // the bug18 guard has widened the window around the measured position
    expect(container.querySelectorAll('article')).toHaveLength(33)

    // switch to another long category at index 0
    rerender(<ContentCarousel cards={LONG_C} categoryId="recent" focusedIndex={0} />)

    // the fresh category starts at the pure index-0 window (17 cards + one
    // trailing spacer) — the old category's scroll offset must not expand it,
    // no stale cards or spacer widths may linger in the mounted buffer
    const articles = container.querySelectorAll('article')
    expect(articles).toHaveLength(17)
    expect(articles[0].textContent).toContain('Recent 0')
    const spacers = container.querySelectorAll('.spacer')
    expect(spacers).toHaveLength(1)
    // 33 missing after: 33*170+32*24
    expect((spacers[0] as HTMLElement).style.width).toBe('6378px')
    expect(carouselEl(container).scrollLeft).toBe(0)
  })

  it('within one category a measured scroll position never unmounts the visible cards', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={LONG_A} categoryId="now-playing" focusedIndex={25} />,
    )
    // the viewport has scrolled ahead of the focus (fast dial)
    setDeviceScroll(carouselEl(container), 40 * CARD_STEP - 24)
    rerender(<ContentCarousel cards={LONG_A} categoryId="now-playing" focusedIndex={26} />)

    // the guard widens the window so the cards at the physical position and
    // the focused card both stay mounted
    expect(screen.getByText('Queue 26')).toBeInTheDocument()
    expect(screen.getByText('Queue 40')).toBeInTheDocument()
    expect(screen.getByText('Queue 44')).toBeInTheDocument()
    expect(container.querySelectorAll('article').length).toBeGreaterThan(33)
  })
})

describe('bug39: strict category purge across the main menu (view level)', () => {
  // 45 recently played tracks — long enough to trigger windowing (>= 40)
  const LONG_RECENT = Array.from({ length: 45 }, (_, i) => ({
    track: {
      id: `rr-${i}`,
      name: i === 7 ? 'Thinking About You' : `Recent Track ${i}`,
      artists: [{ name: 'Someone' }],
      album: { name: 'An Album', images: [] },
      uri: `spotify:track:rr-${i}`,
    },
    played_at: '2026-08-20T10:00:00Z',
  }))
  // 45 upcoming queue tracks — the 'Läuft gerade' pane is windowed as well
  const LONG_QUEUE: ObserverStatusActive = {
    ...nowPlaying,
    next_tracks: Array.from({ length: 45 }, (_, i) => ({
      uri: `spotify:track:qq-${i}`,
      track_id: `qq-${i}`,
      name: `Queue Track ${i}`,
      artist: 'Someone',
      album: '',
      image_url: '',
    })),
  }

  beforeEach(() => {
    hookState.recentItems = LONG_RECENT
  })
  afterEach(() => {
    hookState.recentItems = DEFAULT_RECENT_ITEMS
  })

  function wheel(deltaX: number): void {
    act(() => {
      ListFocusContext.entry.onWheel({
        deltaX,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent)
    })
  }

  it('switching to Playlists after navigating long recents/queue shows strictly playlist cards from index 0', () => {
    const { container } = render(<MainMenuView nowPlaying={LONG_QUEUE} />)
    // navigate: 'Zuletzt' → dial to a mid-list track ...
    fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
    for (let i = 0; i < 20; i++) wheel(-2)
    // ... the viewport has settled deep into the list ...
    const carousel = container.querySelector('.carousel') as HTMLElement
    carousel.scrollLeft = 20 * 194
    Object.defineProperty(carousel, 'clientWidth', { value: 550, configurable: true })
    // ... one more tick samples the position into the guard's baseline
    wheel(-2)
    // ... select songs in 'Läuft gerade' ...
    fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))
    // the fresh category must start at the pure index-0 window, not at the
    // old category's measured position
    expect(container.querySelectorAll('article')).toHaveLength(17)
    expect((container.querySelector('.spacer') as HTMLElement).style.width).toBe('5602px')
    for (let i = 0; i < 5; i++) wheel(-2)
    // ... then switch to 'Playlists'
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))

    // strictly the playlist cards — index 0 is the leftmost rendered card
    const articles = container.querySelectorAll('article')
    expect(articles).toHaveLength(2)
    expect(articles[0].textContent).toContain('Road Trip')
    // no leftover track cards of the previous views, no residual width holders
    expect(screen.queryByText('Thinking About You')).not.toBeInTheDocument()
    expect(screen.queryByText('Queue Track 4')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.spacer')).toHaveLength(0)
    // the viewport was reset to index 0
    expect(carousel.scrollLeft).toBe(0)
  })
})

describe('bug41: active-track change resets the scroll within the same category', () => {
  let setLeft: MockInstance

  beforeEach(() => {
    setLeft = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resets the scroll to the first card when the active track key changes', () => {
    const { rerender } = render(
      <ContentCarousel
        cards={CARDS_A}
        categoryId="now-playing"
        activeTrackKey="track-a"
        focusedIndex={2}
      />,
    )
    setLeft.mockClear()

    // the queue skip lands: same category, a new current track, focus back at 0
    rerender(
      <ContentCarousel
        cards={CARDS_B}
        categoryId="now-playing"
        activeTrackKey="track-b"
        focusedIndex={0}
      />,
    )

    expect(setLeft).toHaveBeenCalledWith(0)
  })

  it('does not reset when the active track key is unchanged (observer re-projection)', () => {
    const { rerender } = render(
      <ContentCarousel
        cards={CARDS_A}
        categoryId="now-playing"
        activeTrackKey="track-a"
        focusedIndex={1}
      />,
    )
    setLeft.mockClear()

    // same category, same track — only the cards array identity churns
    rerender(
      <ContentCarousel
        cards={[...CARDS_A]}
        categoryId="now-playing"
        activeTrackKey="track-a"
        focusedIndex={1}
      />,
    )

    expect(setLeft).not.toHaveBeenCalled()
  })

  it('does not reset for categories without an active track key', () => {
    const { rerender } = render(
      <ContentCarousel cards={CARDS_A} categoryId="playlists" focusedIndex={1} />,
    )
    setLeft.mockClear()

    rerender(<ContentCarousel cards={CARDS_B} categoryId="playlists" focusedIndex={1} />)

    expect(setLeft).not.toHaveBeenCalled()
  })
})
