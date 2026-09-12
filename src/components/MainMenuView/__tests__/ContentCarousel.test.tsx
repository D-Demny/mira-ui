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
  // ticket 9.3: the main menu renders the user-selected entities via
  // useHomeSelectedEntities() (here: the default selection, the same entity
  // list as the real hook's HOME_LIGHTS)
  lights: [
    {
      entityId: 'light.3er_stehlampe_gold_esszimmer',
      label: '3er Stehlampe Gold',
      room: 'Esszimmer',
    },
    { entityId: 'light.esstisch_hangelampe_3er', label: 'Esstisch Hängelampe', room: 'Esszimmer' },
    { entityId: 'light.3er_deko_esszimmer', label: '3er Deko', room: 'Esszimmer' },
    {
      entityId: 'light.kajplats_e27_ws_g60_clear_470lm',
      label: 'Stehlampe Gold',
      room: 'Wohnzimmer',
    },
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

vi.mock('@/hooks/useHomeEntities', () => ({
  // ticket 9.3: the main menu renders the user-selected entities via
  // useHomeSelectedEntities() (here: the default selection, the same entity
  // list as the real hook's HOME_LIGHTS); actuate stands in for the light
  // toggle the card action runs (dimmable false → direct actuation)
  useHomeSelectedEntities: () =>
    hookState.lights.map((light) => ({
      ...light,
      domain: 'light',
      state: 'on',
      loading: false,
      error: null,
      actuating: false,
      active: true,
      dimmable: false,
      brightnessPct: null,
      actuate: hookState.toggle,
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
      // ticket 9.4: the v3 store always coerces the ha object — the pinned
      // mock mirrors the pristine default (empty = build-time defaults)
      ha: { url: '', username: '', password: '', token: '', tokenSource: 'default' },
    }),
  }
})

import { ListFocusContext } from '@/navigation/listFocusContext'
import { MainMenuView } from '../MainMenuView'
import { ContentCarousel } from '../ContentCarousel'
import { carouselCardAreEqual } from '../carouselCardCompare'
import {
  ANIM_SETTLE_MS,
  CARD_GAP,
  CARD_WIDTH,
  CAROUSEL_EDGE_PADDING,
  dialScrollLeft,
  sidebarOverlap,
  sidebarOverlapAt,
  windowRange,
} from '../carouselWindow'
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

  it('tapping the light tile on the home dashboard sends the toggle (actuate)', () => {
    // ticket 9.6 W1: the Home category renders the dashboard grid
    // (HomeDashboardView) instead of the content carousel — the label still
    // comes from the same selection source as before. W2: a tap runs
    // view.actuate() (the mocked actuate IS hookState.toggle); the state here
    // is pinned by the mock, so the assertions cover the request + no view
    // transition only
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByText('3er Stehlampe Gold'))

    expect(hookState.toggle).toHaveBeenCalledTimes(1)
    const tile = container.querySelector('[data-entity-id="light.3er_stehlampe_gold_esszimmer"]')
    expect(tile?.querySelector('.state')?.textContent).toBe('An')
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'true')
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

  it('bug50: the rendered window reproduces the full list scroll width (margin pitch)', () => {
    // the flex-gap-x margin layout (Chromium 69 ignores flex `gap`): every
    // child after the first carries a CARD_GAP margin, so the mounted content
    // width is [leading spacer + margin] + cards at the (CARD_WIDTH +
    // CARD_GAP) pitch + [margin + trailing spacer] — and must equal the
    // unwindowed total (the 501-track device case: 97202 px scroll width
    // incl. edge padding, the value dialScrollLeft's end clamp is derived
    // from)
    const cases: [number, number][] = [
      [25, 50], // mid window: both spacers
      [0, 50], // list start: trailing spacer only
      [49, 50], // list end: leading spacer only
    ]
    for (const [focusedIndex, count] of cases) {
      const { container } = render(
        <ContentCarousel
          cards={MANY.slice(0, count)}
          categoryId="playlists"
          focusedIndex={focusedIndex}
        />,
      )
      const spacers = Array.from(container.querySelectorAll('.spacer')) as HTMLElement[]
      const { start, end } = windowRange(count, focusedIndex, null)
      const cardCount = container.querySelectorAll('article').length
      const leading = start > 0 ? parseFloat(spacers[0].style.width) : 0
      const trailing = end < count ? parseFloat(spacers[spacers.length - 1].style.width) : 0
      const contentWidth =
        (leading > 0 ? leading + CARD_GAP : 0) +
        cardCount * CARD_WIDTH +
        Math.max(0, cardCount - 1) * CARD_GAP +
        (trailing > 0 ? CARD_GAP + trailing : 0)
      expect(contentWidth, `focus ${focusedIndex} of ${count}`).toBe(
        count * CARD_WIDTH + (count - 1) * CARD_GAP,
      )
    }
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
    const { rerender } = render(
      <ContentCarousel cards={FEW} categoryId="playlists" focusedIndex={0} />,
    )
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

  it('bug58 T3: re-renders when the blur flag flips (the card crossed the sidebar edge)', () => {
    expect(carouselCardAreEqual(base, { ...base, blurred: true })).toBe(false)
    // ...and stays quiet while the card keeps its blur state
    expect(carouselCardAreEqual({ ...base, blurred: true }, { ...base, blurred: true })).toBe(true)
  })

  it('bug59b A: re-renders when the settle-handoff epoch flips (stale-blur guard), stays quiet otherwise', () => {
    expect(carouselCardAreEqual(base, { ...base, blurEpoch: 1 })).toBe(false)
    // ...and stays quiet while the epoch is unchanged (dial ticks)
    expect(carouselCardAreEqual({ ...base, blurEpoch: 0 }, { ...base, blurEpoch: 0 })).toBe(true)
    expect(carouselCardAreEqual({ ...base, blurEpoch: 3 }, { ...base, blurEpoch: 3 })).toBe(true)
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

// bug47 R2: the dial path must be layout-read-free — the bug39 metrics
// sampler (F1) is skipped in 'auto' mode and the focus centering (F2) is a
// pure arithmetic scrollLeft write instead of scrollIntoView's geometry read.
describe('bug47 R2 (F1/F2): dial mode is read-free and centers arithmetically', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 50 cards: long enough for windowing, short enough to assert the pure
  // 16/16 index window (33 cards)
  const MANY: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `d-${i}`,
    title: `Dial ${i}`,
    subtitle: '',
  }))
  const VIEWPORT_W = 550 // the device's content-pane carousel width

  function carouselEl(container: HTMLElement): HTMLElement {
    return container.querySelector('.carousel') as HTMLElement
  }

  // instrument the carousel: count layout reads, capture scrollLeft writes
  function instrument(el: HTMLElement): {
    reads: { width: number; left: number }
    left: { value: number }
  } {
    const reads = { width: 0, left: 0 }
    const left = { value: -1 }
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => {
        reads.width++
        return VIEWPORT_W
      },
    })
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => {
        reads.left++
        return left.value
      },
      set: (v: number) => {
        left.value = v
      },
    })
    return { reads, left }
  }

  it('F1+F2: a dial tick measures the viewport exactly once, never reads scrollLeft, and writes the centering offset', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={25}
        focusScrollBehavior="auto"
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    // the mount-time measure saw 0 (jsdom, before instrumentation) → the
    // first tick must measure once and then stay read-free
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    // tick 1: one-time viewport measure (F2 lazy), then the arithmetic write
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={26}
        focusScrollBehavior="auto"
      />,
    )
    expect(reads.width).toBe(1) // the one-shot measure — the sampler (F1) adds nothing
    expect(reads.left).toBe(0) // the sampler no longer reads scrollLeft in dial mode
    expect(left.value).toBe(dialScrollLeft(50, 26, VIEWPORT_W))
    expect(scrollIntoView).not.toHaveBeenCalled() // F2 replaced the native call

    // tick 2: fully read-free, next centering offset
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={27}
        focusScrollBehavior="auto"
      />,
    )
    expect(reads.width).toBe(1) // never re-measured
    expect(reads.left).toBe(0)
    expect(left.value).toBe(dialScrollLeft(50, 27, VIEWPORT_W))

    // the guard is bypassed in dial mode — the focus is centered by
    // construction, so no physical widening: the window stays the pure 16/16
    // index window
    expect(container.querySelectorAll('article')).toHaveLength(33)
  })

  it('F2: the dial centering clamps at the list ends like scrollIntoView(inline: center)', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    // card 1: the first card whose center is not clamped (card 0's is)
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={1}
        focusScrollBehavior="auto"
      />,
    )
    expect(left.value).toBe(dialScrollLeft(50, 1, VIEWPORT_W))
    expect(left.value).toBeGreaterThan(0)

    // the last card: clamped to the maximum scroll offset (the native call
    // stops there too — the list is too short to reach the viewport center)
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={49}
        focusScrollBehavior="auto"
      />,
    )
    const maxScroll = 2 * CAROUSEL_EDGE_PADDING + 50 * CARD_WIDTH + 49 * CARD_GAP - VIEWPORT_W
    expect(left.value).toBe(maxScroll)
    expect(left.value).toBeLessThan(
      CAROUSEL_EDGE_PADDING + 49 * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2 - VIEWPORT_W / 2,
    )

    // dialing back to the first card clamps to 0
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
      />,
    )
    expect(left.value).toBe(0)
    expect(reads.width).toBe(1) // still the single one-shot measure
    expect(reads.left).toBe(0)
  })

  it('F1: the smooth mode keeps sampling the physical position (bug18 guard alive for taps/jumps)', () => {
    const { container, rerender } = render(
      <ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={25} />,
    )
    const { reads } = instrument(carouselEl(container))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    // a jump (default behavior 'smooth'): the sampler reads the position
    rerender(<ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={26} />)
    expect(reads.width).toBe(1) // the bug18 sampler read
    expect(reads.left).toBe(1)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', inline: 'center' })
  })
})

// bug54: the underflow geometry — underflowPx > 0 means the carousel
// viewport spans the FULL screen (the content pane slides under the 250px
// sidebar). The dial centering must use the underflow geometry (first card's
// rest position at 266, left boundary at the sidebar's right edge, centering
// target in the visible zone at 525) and the scroll port must apply the
// .underflow padding.
// bug54 (08.09.2026 user change): no menu background mode currently passes a
// positive underflowPx — 'translucent' was changed to the solid layout (cards
// clipped at the menu edge). This suite pins the GATED mechanism that the
// upcoming 'blur' mode (Bug58) will re-enable.
describe('bug54: underflow geometry (translucent menu background)', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 50 cards: long enough for windowing (same shape as the bug47 R2 suite)
  const MANY: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `u-${i}`,
    title: `Under ${i}`,
    subtitle: '',
  }))
  const SCREEN_W = 800 // the device's full screen (the pane slides under)
  const UNDERFLOW_PX = 250 // the sidebar width
  const GEO = {
    leftInset: CAROUSEL_EDGE_PADDING + UNDERFLOW_PX, // 266
    minVisibleX: UNDERFLOW_PX,
    centerTarget: UNDERFLOW_PX + (SCREEN_W - UNDERFLOW_PX) / 2, // 525
  }

  function carouselEl(container: HTMLElement): HTMLElement {
    return container.querySelector('.carousel') as HTMLElement
  }

  // instrument the carousel: count layout reads, capture scrollLeft writes
  function instrument(el: HTMLElement): {
    reads: { width: number; left: number }
    left: { value: number }
  } {
    const reads = { width: 0, left: 0 }
    const left = { value: -1 }
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => {
        reads.width++
        return SCREEN_W
      },
    })
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => {
        reads.left++
        return left.value
      },
      set: (v: number) => {
        left.value = v
      },
    })
    return { reads, left }
  }

  it('dial ticks center the focus in the visible zone (525), not the screen middle', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    // the mount-time measure saw 0 (jsdom, before instrumentation) → the
    // first tick measures once (the full-screen viewport), then stays
    // read-free and writes the underflow centering offset
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={25}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(reads.width).toBe(1)
    expect(reads.left).toBe(0)
    expect(left.value).toBe(dialScrollLeft(50, 25, SCREEN_W, GEO))
    // ...which is NOT the solid geometry's centering (the target moved from
    // the screen middle to the visible zone's middle)
    expect(left.value).not.toBe(dialScrollLeft(50, 25, SCREEN_W))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('clamps to 0 for card 0 and to maxScroll at the end, like the solid path', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { left } = instrument(carouselEl(container))

    // card 1: the first card whose center is not clamped
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={1}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(left.value).toBe(dialScrollLeft(50, 1, SCREEN_W, GEO))
    expect(left.value).toBeGreaterThan(0)

    // the last card: clamped to the underflow maxScroll (left edge padding
    // 266 + right edge padding 16, viewport 800)
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={49}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const maxScroll =
      GEO.leftInset + CAROUSEL_EDGE_PADDING + 50 * CARD_WIDTH + 49 * CARD_GAP - SCREEN_W
    expect(left.value).toBe(maxScroll)

    // dialing back to the first card clamps to 0
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(left.value).toBe(0)
  })

  it('re-measures the viewport when the underflow toggles at runtime (re-centering)', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={25}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    // mount measured 0 (jsdom) and fell back to the native call
    scrollIntoView.mockClear()

    // runtime toggle to solid: the viewport is re-measured and the focus
    // re-centers with the plain (no-geometry) arithmetic
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={25}
        focusScrollBehavior="auto"
        underflowPx={0}
      />,
    )
    expect(reads.width).toBe(1)
    expect(left.value).toBe(dialScrollLeft(50, 25, SCREEN_W))
    expect(scrollIntoView).not.toHaveBeenCalled()

    // and back to translucent: re-measured again, visible-zone geometry
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={25}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(reads.width).toBe(2)
    expect(left.value).toBe(dialScrollLeft(50, 25, SCREEN_W, GEO))
  })

  it('applies the .underflow class only in underflow mode (the scroll port starts under the glass)', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(carouselEl(container).className).toContain('underflow')

    rerender(<ContentCarousel cards={MANY} categoryId="playlists" focusedIndex={0} />)
    expect(carouselEl(container).className).not.toContain('underflow')
  })
})

// bug59 test harness: a deterministic clock + rAF queue for the live-blur
// loop. performance.now() is frozen at a fixed base so ANIM_SETTLE_MS windows
// are advanced explicitly; requestAnimationFrame/cancelAnimationFrame are
// queued instead of fired, so a dial tick (the layout-effect scroll write)
// arms the loop and schedules its frame WITHOUT any frame running until
// step()/settle() is called — exactly the in-flight window the feature covers.
function mockLiveBlurClock() {
  let t = 1_000_000
  const queue: FrameRequestCallback[] = []
  let nextId = 0
  vi.spyOn(performance, 'now').mockImplementation(() => t)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return ++nextId
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const advance = (ms: number) => {
    t += ms
  }
  const step = () =>
    act(() => {
      const q = queue.splice(0, queue.length)
      for (const cb of q) cb(t)
    })
  const settle = () => {
    advance(ANIM_SETTLE_MS + 1)
    step()
  }
  return { advance, step, settle, queueLength: () => queue.length }
}

// bug58 T3/T4: in the 'blur' menu background exactly the cards that are MORE
// THAN HALF under the translucent sidebar glass carry a strong per-card blur
// (.blurred, `filter: blur`) — and LOSE it again as soon as they leave the
// area (a filter forces its own compositing layer; permanent blurs are not
// acceptable on the weak S905D2). The set is pure arithmetic from the dial
// state (sidebarOverlap), so the tick path stays read-free. T4 (device report
// Build #110/#111): "under the glass" means the card's CENTER crossed the
// sidebar's right edge — a card with only a ~4 px sliver under it (98 % still
// visible) is NOT blurred anymore (the visible false positive on device).
// Worked example (count 50, viewport 800, underflow 250): pitch = 170 + 24 =
// 194, leftInset = 16 + 250 = 266. At focus 4 the dial offset is 602, so card
// i sits at screen x = 266 + 194i - 602: card 1 at -142 (center -57, more than
// half under), card 2 at 52 (center 137, more than half under), card 3 at 246
// — its center (331) is still RIGHT of the edge: it stays SHARP. The focused
// card 4 sits at 440, fully right of it.
describe('bug58 T3: per-card blur on sidebar overlap (blur menu background)', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollIntoView')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // 50 cards: long enough for windowing (same shape as the bug47 R2 / bug54 suites)
  const MANY: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `b-${i}`,
    title: `Blur ${i}`,
    subtitle: '',
  }))
  const SCREEN_W = 800 // the device's full screen (blur mode spans it)
  const UNDERFLOW_PX = 250 // the sidebar width
  const GEO = {
    leftInset: CAROUSEL_EDGE_PADDING + UNDERFLOW_PX, // 266
    minVisibleX: UNDERFLOW_PX,
    centerTarget: UNDERFLOW_PX + (SCREEN_W - UNDERFLOW_PX) / 2, // 525
  }

  function carouselEl(container: HTMLElement): HTMLElement {
    return container.querySelector('.carousel') as HTMLElement
  }

  // instrument the carousel: count layout reads, capture scrollLeft writes
  function instrument(el: HTMLElement): {
    reads: { width: number; left: number }
    left: { value: number }
  } {
    const reads = { width: 0, left: 0 }
    const left = { value: -1 }
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => {
        reads.width++
        return SCREEN_W
      },
    })
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => {
        reads.left++
        return left.value
      },
      set: (v: number) => {
        left.value = v
      },
    })
    return { reads, left }
  }

  it('pure: the overlap set per focus — at most 2 cards (T4 center rule), the focused card never inside', () => {
    // focus 0: card 0 rests at screen x 266 — already right of the edge
    expect(sidebarOverlap(50, 0, SCREEN_W, UNDERFLOW_PX).size).toBe(0)
    // focus 1: card 0 slid to x 246 — only a ~4px sliver is under the glass,
    // its center (331) is still right of the edge: NOT blurred (T4; [0] in T3)
    expect([...sidebarOverlap(50, 1, SCREEN_W, UNDERFLOW_PX)]).toEqual([])
    // focus 2: card 0 at x 52 — more than half under the glass
    expect([...sidebarOverlap(50, 2, SCREEN_W, UNDERFLOW_PX)]).toEqual([0])
    expect([...sidebarOverlap(50, 3, SCREEN_W, UNDERFLOW_PX)]).toEqual([0, 1])
    // focus 4: card 3 at x 246 stays sharp — its center (331) never crosses
    // the edge; exactly the false positive of the device report (Build #110)
    expect([...sidebarOverlap(50, 4, SCREEN_W, UNDERFLOW_PX)]).toEqual([1, 2])
    // right end: clamped to maxScroll, only cards 45/46 are more than half under
    expect([...sidebarOverlap(50, 49, SCREEN_W, UNDERFLOW_PX)]).toEqual([45, 46])
    // edge cases: empty list, and the solid layout (zero-width area) never overlap
    expect(sidebarOverlap(0, 0, SCREEN_W, UNDERFLOW_PX).size).toBe(0)
    expect([...sidebarOverlap(50, 3, SCREEN_W, 0)]).toEqual([])
    // invariant: minVisibleX keeps the focused card fully right of the edge
    for (const f of [0, 1, 3, 25, 49]) {
      expect(sidebarOverlap(50, f, SCREEN_W, UNDERFLOW_PX).has(f)).toBe(false)
    }
  })

  it('DOM: blur mode — exactly the cards under the sidebar carry .blurred; focused and right-side cards do not', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()
    // bug59: while a smooth animation is in flight the rAF loop owns the
    // .blurred classes exclusively — settle the (mocked) clock before any
    // assertion on committed blur classes so the settled handoff has run
    const clock = mockLiveBlurClock()

    // tick 1 (→ focus 3): the one-shot viewport measure lands in the ref only
    // AFTER this render (jsdom saw 0 at mount; on device the mount-time layout
    // effect already holds the real width), so React's commit carries no
    // .blurred — and the dial write is the pure arithmetic, never
    // scrollIntoView. bug59b (B): before the first rAF frame, the pre-paint
    // arm effect re-applies the dial-TARGET set imperatively (focus 3 → {0,1}),
    // so the DOM under the glass is already blurred in this very frame
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={3}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(reads.width).toBe(1) // measured once, never again (read-free dial path)
    expect(reads.left).toBe(0) // arm re-apply reads targetOffsetRef, not scrollLeft
    expect(left.value).toBe(dialScrollLeft(50, 3, SCREEN_W, GEO))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(container.querySelectorAll('article.blurred')).toHaveLength(2)
    for (const title of ['Blur 0', 'Blur 1']) {
      expect(screen.getByText(title).closest('article')).toHaveClass('blurred')
    }

    // tick 2 (→ focus 4): rendered WITH the measured viewport — only cards 1/2
    // are MORE THAN HALF under the glass (screen x -142 / 52, centers -57 / 137
    // left of the 250 edge); card 3 at x 246 keeps its sharpness (center 331)
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    // bug59: one settled frame hands the classes back to React — at this
    // (settled) offset the render-derived set is what must be in the DOM
    clock.settle()
    expect(Array.from(container.querySelectorAll('article.blurred'))).toHaveLength(2)
    for (const title of ['Blur 1', 'Blur 2']) {
      expect(screen.getByText(title).closest('article')).toHaveClass('blurred')
    }
    // card 0 has fully left the area (screen x -336, off-screen); card 3 is the
    // T4 false positive — only its left ~4 px are under the glass, so it stays
    // sharp; focused and right-side cards are untouched
    expect(screen.getByText('Blur 0').closest('article')).not.toHaveClass('blurred')
    expect(screen.getByText('Blur 3').closest('article')).not.toHaveClass('blurred')
    expect(screen.getByText('Blur 4').closest('article')).not.toHaveClass('blurred')
    expect(screen.getByText('Blur 5').closest('article')).not.toHaveClass('blurred')
    expect(reads.width).toBe(1) // still read-free

    // tick 3 (→ focus 5): card 1 leaves the area and LOSES .blurred again —
    // that is exactly what makes the per-card filter acceptable on-device
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={5}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    // bug59: the next tick re-armed the loop — settle before asserting so the
    // committed classes are again React's render-derived (settled) set
    clock.settle()
    expect(screen.getByText('Blur 1').closest('article')).not.toHaveClass('blurred')
    expect(screen.getByText('Blur 2').closest('article')).toHaveClass('blurred')
    expect(screen.getByText('Blur 3').closest('article')).toHaveClass('blurred')
    expect(screen.getByText('Blur 4').closest('article')).not.toHaveClass('blurred') // T4 center rule: only a sliver under, stays sharp
    expect(screen.getByText('Blur 5').closest('article')).not.toHaveClass('blurred') // focused: never blurred
    expect(Array.from(container.querySelectorAll('article.blurred'))).toHaveLength(2)
    expect(reads.width).toBe(1)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('Fix A: the blur follows blurIndex — survives an undefined focusedIndex (sidebar-pane focus) and resets on a category switch', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        blurIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { reads, left } = instrument(carouselEl(container))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()
    // bug59: the live-blur loop owns the .blurred classes while a smooth
    // animation is in flight — settle the (mocked) clock before asserting on
    // committed blur classes
    const clock = mockLiveBlurClock()

    // tick 1 (→ focus 4): the one-shot viewport measure lands in the ref only
    // AFTER this render, so no .blurred yet — but the dial write is the pure
    // arithmetic (never scrollIntoView)
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={4}
        blurIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(reads.width).toBe(1) // measured once, never again (read-free dial path)
    expect(left.value).toBe(dialScrollLeft(50, 4, SCREEN_W, GEO))

    // tick 2: the UI focus moves into the SIDEBAR pane — focusedIndex goes
    // undefined (MainMenuView's ternary) while blurIndex stays 4. The cards
    // under the glass must KEEP their blur (device report Build #110/#111),
    // and no scroll write or re-measure happens: the dial branch is keyed on
    // focusedIndex only
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        blurIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    // bug59: the loop never re-armed on this tick (dial branch bailed on the
    // undefined focusedIndex) — one settled frame hands the classes back to
    // React, which derives them from blurIndex (not focusedIndex)
    clock.settle()
    expect(Array.from(container.querySelectorAll('article.blurred'))).toHaveLength(2)
    for (const title of ['Blur 1', 'Blur 2']) {
      expect(screen.getByText(title).closest('article')).toHaveClass('blurred')
    }
    expect(left.value).toBe(dialScrollLeft(50, 4, SCREEN_W, GEO)) // no scroll write
    expect(reads.width).toBe(1) // no re-measure
    expect(scrollIntoView).not.toHaveBeenCalled()

    // tick 3: a sidebar preview switch — categoryId changes and the content
    // index resets to 0 (the carousel's card-0 remount), so the blur set is
    // empty again even though focusedIndex is still undefined
    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="other"
        blurIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    // bug59: the category purge re-armed the loop (another smooth move back to
    // 0) — settle before asserting so the cleared state is the settled handoff
    clock.settle()
    expect(container.querySelectorAll('article.blurred')).toHaveLength(0)
    expect(left.value).toBe(0) // the category purge reset the scroll to card 0
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('DOM: the legacy modes (underflowPx 0) never blur a card', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
      />,
    )
    instrument(carouselEl(container)) // the viewport may measure — the gate stays closed

    rerender(
      <ContentCarousel
        cards={MANY}
        categoryId="playlists"
        focusedIndex={3}
        focusScrollBehavior="auto"
      />,
    )
    expect(container.querySelectorAll('article.blurred')).toHaveLength(0)
    expect(carouselEl(container).className).not.toContain('underflow')
  })
})

// bug59: while a smooth dial animation is in flight, React commits NO blur at
// all (the liveBlur gate renders NO_BLUR) — a rAF loop owns the .blurred
// classes exclusively and follows the PHYSICAL scrollLeft (sidebarOverlapAt)
// every frame. Once ANIM_SETTLE_MS has passed since the last scroll write AND
// the physical offset sits within 1px of the target, the loop strips ONLY its
// stale classes (a card that left the glass at this offset), flips liveBlur
// off and bumps the blurEpoch; React re-renders EVERY card in that very commit
// with the render-derived sidebarOverlap set — identical at the settled offset
// — so the handoff is invisible AND no frame ever paints a card under the
// glass sharp (bug59b: neither the full strip on settle nor the NO_BLUR arm
// commit may win a frame). These tests pin: the equivalence that makes the
// handoff invisible (PURE), the in-flight ownership of the classes (IN-FLIGHT,
// incl. the pre-paint arm re-apply), the settled handoff itself
// (SETTLE-HANDOFF), the stale-only settle strip (bug59b A) and the read-free
// dial path (TICK-PATH INVARIANT).
describe('bug59: live blur tracking', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // same geometry as the bug58 T3 suite: device screen, full-screen port,
  // 250 px sidebar underflow
  const CARDS: MenuCard[] = Array.from({ length: 50 }, (_, i) => ({
    id: `b59-${i}`,
    title: `B59 ${i}`,
    subtitle: '',
  }))
  const SCREEN_W = 800
  const UNDERFLOW_PX = 250
  const GEO = {
    leftInset: CAROUSEL_EDGE_PADDING + UNDERFLOW_PX, // 266
    minVisibleX: UNDERFLOW_PX,
    centerTarget: UNDERFLOW_PX + (SCREEN_W - UNDERFLOW_PX) / 2, // 525
  }

  function carouselEl(container: HTMLElement): HTMLElement {
    return container.querySelector('.carousel') as HTMLElement
  }

  // same instrument as the T3 suite: count layout reads, capture scrollLeft
  // writes — left.value is the "physical" offset the loop reads per frame
  function instrument(el: HTMLElement): {
    reads: { width: number; left: number }
    left: { value: number }
  } {
    const reads = { width: 0, left: 0 }
    const left = { value: -1 }
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => {
        reads.width++
        return SCREEN_W
      },
    })
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => {
        reads.left++
        return left.value
      },
      set: (v: number) => {
        left.value = v
      },
    })
    return { reads, left }
  }

  // the indices of the .blurred cards, mapped from the card titles (B59 <i>)
  function blurredIndices(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll('article.blurred')).map((el) =>
      Number(/B59 (\d+)/.exec(el.textContent ?? '')?.[1]),
    )
  }

  it('PURE: at every settled dial offset the physical set equals the target set (handoff is invisible)', () => {
    const { container } = render(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    instrument(carouselEl(container))
    mockLiveBlurClock()

    // the dial target offset IS the settled physical offset (the write lands
    // exactly) — at it, both functions must yield identical sets: same
    // constants, same candidate window, same T4 center rule. Cover several
    // (count, focusedIndex) pairs in underflow mode, including the clamped
    // ends where dialScrollLeft saturates at maxScroll / the left boundary
    for (const [count, idxs] of [
      [50, [0, 1, 2, 3, 4, 5, 10, 25, 49]],
      [8, [0, 1, 2, 3, 4, 7]],
    ] as const) {
      for (const idx of idxs) {
        const settledOffset = dialScrollLeft(count, idx, SCREEN_W, GEO)
        expect(
          [...sidebarOverlapAt(settledOffset, count, UNDERFLOW_PX)].sort((a, b) => a - b),
        ).toEqual([...sidebarOverlap(count, idx, SCREEN_W, UNDERFLOW_PX)].sort((a, b) => a - b))
      }
    }
  })

  it('IN-FLIGHT: after one dial tick React commits no .blurred; the arm re-applies the target set pre-paint and the first frame glues it to the physical offset', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { left } = instrument(carouselEl(container))
    const clock = mockLiveBlurClock()

    // one dial tick (→ focus 4): the layout effect writes the target offset
    // and arms the loop. React's commit carries no .blurred at all (the
    // liveBlur gate renders NO_BLUR while in flight) — but bug59b (B) re-applies
    // the dial-TARGET set {1,2} imperatively pre-paint, so before ANY rAF frame
    // has run the DOM under the glass is already blurred
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    expect(clock.queueLength()).toBe(1) // armed, not yet executed
    // bug59b (B): pre-paint arm — exactly the dial-target set (focus 4 → {1,2}),
    // applied by the layout effect, not by React's commit and not by a frame
    expect([...blurredIndices(container)].sort((a, b) => a - b)).toEqual([1, 2])

    // one frame (without settle): the loop reads the PHYSICAL scrollLeft and
    // writes the set derived from it — not from the render's target index
    clock.step()
    const expected = sidebarOverlapAt(left.value, CARDS.length, UNDERFLOW_PX)
    const dom = blurredIndices(container)
    expect([...dom].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b))
    // T4 center rule from the DOM side: no blurred card has its physical
    // center right of the sidebar's right edge
    for (const i of dom) {
      const x = GEO.leftInset + i * (CARD_WIDTH + CARD_GAP) - left.value
      expect(x + CARD_WIDTH / 2).toBeLessThan(UNDERFLOW_PX)
    }
  })

  it('SETTLE-HANDOFF: after clock.settle() the .blurred set is the target-based sidebarOverlap and the queue drains', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { left } = instrument(carouselEl(container))
    const clock = mockLiveBlurClock()

    // one dial tick (→ focus 4) arms the loop; settle advances past
    // ANIM_SETTLE_MS and steps one frame: the physical offset sits on the
    // target (the write lands exactly), so the loop clears its classes,
    // flips liveBlur off and schedules no next frame — React re-renders with
    // the render-derived set in that very commit (the invisible handoff)
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    clock.settle()

    const expected = sidebarOverlap(CARDS.length, 4, SCREEN_W, UNDERFLOW_PX)
    const dom = blurredIndices(container)
    expect([...dom].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b))
    // the handoff happened at the dial target offset (not mid-animation) ...
    expect(left.value).toBe(dialScrollLeft(CARDS.length, 4, SCREEN_W, GEO))
    // ... and the loop is done: no frame left in the queue
    expect(clock.queueLength()).toBe(0)
  })

  it('bug59b A: settle strips ONLY what is stale — cards still under the glass keep their blur through the handoff commit', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { left } = instrument(carouselEl(container))
    const clock = mockLiveBlurClock()

    // dial to focus 5: arm (target 796 — the pre-paint re-apply writes {2,3}),
    // then move the PHYSICAL offset mid-flight to 700 and run one frame: the
    // loop glues the set to the physical position (still {2,3} here — card 3's
    // center at x 233 sits left of the 250 edge; cards 0/1 are fully off-screen)
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={5}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    left.value = 700
    clock.step()
    expect([...blurredIndices(container)].sort((a, b) => a - b)).toEqual([2, 3])

    // dial back to focus 4 (target 602 — the settled set is {1,2}) and settle:
    // card 3 is STALE (its center at x 427 is right of the edge), cards 1/2
    // are not. The handoff may strip ONLY card 3's class — a full strip (the
    // old code) would leave every card under the glass sharp for the frame(s)
    // before React's canonical commit lands: the visible flash of Bug59b
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={4}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    // capture every IMPERATIVE .blurred removal during the settle frame
    // (React's own className updates go through setAttribute, not classList)
    const removed: number[] = []
    for (const el of container.querySelectorAll('article')) {
      const index = Number(/B59 (\d+)/.exec(el.textContent ?? '')?.[1])
      const list = el.classList
      const origRemove = list.remove.bind(list)
      list.remove = (...tokens: string[]) => {
        if (tokens.includes('blurred')) removed.push(index)
        return origRemove(...tokens)
      }
    }
    clock.settle()

    expect(removed).toEqual([3]) // stale-only — no full strip, nothing else touched
    const expected = sidebarOverlap(CARDS.length, 4, SCREEN_W, UNDERFLOW_PX)
    const dom = blurredIndices(container)
    expect([...dom].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b))
    // cards still under the glass kept their class through the handoff commit ...
    for (const title of ['B59 1', 'B59 2']) {
      expect(screen.getByText(title).closest('article')).toHaveClass('blurred')
    }
    // ... and the loop is done: no frame left in the queue
    expect(clock.queueLength()).toBe(0)
  })

  it('TICK-PATH INVARIANT: dial ticks without rAF frames read scrollLeft zero times (tick path stays read-free)', () => {
    const { container, rerender } = render(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={0}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    const { reads } = instrument(carouselEl(container))
    const clock = mockLiveBlurClock()

    // two dial ticks: the layout-effect path writes scrollLeft arithmetically
    // and arms the loop — a frame is queued, but NONE runs without step(), so
    // the loop's per-frame physical read never happens on the tick path
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={3}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )
    rerender(
      <ContentCarousel
        cards={CARDS}
        categoryId="playlists"
        focusedIndex={5}
        focusScrollBehavior="auto"
        underflowPx={UNDERFLOW_PX}
      />,
    )

    expect(clock.queueLength()).toBe(1) // armed once, never executed
    expect(reads.left).toBe(0) // the tick path stays read-free
    expect(reads.width).toBe(1) // the viewport is still measured exactly once
  })
})
