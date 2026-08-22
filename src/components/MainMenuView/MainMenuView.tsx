import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHomeLight, HOME_LIGHT_LABEL } from '@/hooks/useHomeLight'
import { useMainMenuFocus } from '@/hooks/useMainMenuFocus'
import { usePlaylists } from '@/hooks/usePlaylists'
import { useRecent } from '@/hooks/useRecent'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import { useSettings } from '@/settings'
import { pickSpotifyImage } from '@/api/client'
import type { ObserverStatusActive } from '@/api/types'
import { SidebarNav } from './SidebarNav'
import { ContentCarousel } from './ContentCarousel'
import { MENU_CATEGORIES } from './mockData'
import type { MenuCard } from './mockData'
import styles from './MainMenuView.module.scss'

export interface MainMenuViewProps {
  // starts playback for a media card uri; the view stays open and switches to 'Läuft gerade'
  onPlay?: (uri: string) => void
  // live player status so the 'Läuft gerade' pane can show current track + queue
  nowPlaying?: ObserverStatusActive | null
  // close the menu and return to the player ('Läuft gerade' confirm / back on the sidebar)
  onExit?: () => void
}

// Nocturne-style main menu (tickets 8.4a1-8.4a3, 8.4b, 8.4c).
export function MainMenuView({ onPlay, nowPlaying, onExit }: MainMenuViewProps) {
  const [activeCategoryId, setActiveCategoryId] = useState('home')
  const viewRef = useRef<HTMLDivElement>(null)

  // destructured so the categories memo keys on stable primitives — the hook
  // results are new object literals on every render (bug8.1/8.2)
  const { items: playlistItems, loading: playlistsLoading } = usePlaylists()
  const { items: recentItems, loading: recentLoading } = useRecent()
  const { state: lightState, loading: lightLoading, error: lightError, toggle: lightToggle } =
    useHomeLight()
  const settings = useSettings()

  // the observer polls every 3s and hands over a fresh status object each time
  // even when nothing changed; key the snapshot on the scalars that actually
  // feed the cards so card identities survive the polls (bug8.2)
  const nowPlayingQueueKey = (nowPlaying?.next_tracks ?? [])
    .slice(0, 3)
    .map((track) => `${track.track_id}|${track.uri}|${track.name}|${track.artist}|${track.image_url}`)
    .join('\u0000')

  const nowPlayingSnapshot = useMemo(() => {
    if (!nowPlaying) return null
    return {
      id: nowPlaying.track_id,
      title: nowPlaying.track_name,
      subtitle: nowPlaying.track_artist,
      art: nowPlaying.track_image || undefined,
      uri: nowPlaying.track_uri,
      queue: (nowPlaying.next_tracks ?? []).slice(0, 3).map((track) => ({
        id: track.track_id,
        title: track.name,
        subtitle: track.artist,
        art: track.image_url || undefined,
        uri: track.uri,
      })),
    }
    // deliberately keyed on the scalar fields above, not on nowPlaying identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nowPlaying?.track_id,
    nowPlaying?.track_name,
    nowPlaying?.track_artist,
    nowPlaying?.track_image,
    nowPlaying?.track_uri,
    nowPlayingQueueKey,
  ])

  const categories = useMemo(() => {
    const lightSubtitle =
      lightLoading || lightState === null
        ? '…'
        : lightError
          ? 'Offline'
          : lightState === 'on'
            ? 'An'
            : 'Aus'

    // bug2.3: playlist cards show only the title — no owner name / track count
    const playlistCards: MenuCard[] = playlistItems.map((playlist) => ({
      id: `pl-${playlist.id}`,
      title: playlist.name,
      subtitle: '',
      art: pickSpotifyImage(playlist.images),
      kind: 'media',
      uri: playlist.uri,
    }))
    if (playlistsLoading && playlistCards.length === 0) {
      playlistCards.push({ id: 'pl-loading', title: 'Lade…', subtitle: '' })
    }

    const seenTrackIds = new Set<string>()
    const recentCards: MenuCard[] = []
    for (const entry of recentItems) {
      if (seenTrackIds.has(entry.track.id)) continue
      seenTrackIds.add(entry.track.id)
      recentCards.push({
        id: `rc-${entry.track.id}`,
        title: entry.track.name,
        subtitle: entry.track.artists.map((artist) => artist.name).join(', '),
        art: pickSpotifyImage(entry.track.album.images),
        kind: 'media',
        uri: entry.track.uri,
      })
    }
    if (recentLoading && recentCards.length === 0) {
      recentCards.push({ id: 'rc-loading', title: 'Lade…', subtitle: '' })
    }

    const nowPlayingCards: MenuCard[] = []
    if (nowPlayingSnapshot) {
      nowPlayingCards.push({
        id: 'np-current',
        title: nowPlayingSnapshot.title,
        subtitle: nowPlayingSnapshot.subtitle,
        art: nowPlayingSnapshot.art,
        kind: 'media',
        uri: nowPlayingSnapshot.uri,
      })
      for (const track of nowPlayingSnapshot.queue) {
        nowPlayingCards.push({
          id: `np-q-${track.id}`,
          title: track.title,
          subtitle: track.subtitle,
          art: track.art,
          kind: 'media',
          uri: track.uri,
        })
      }
    } else {
      nowPlayingCards.push({ id: 'np-idle', title: 'Nichts läuft', subtitle: '' })
    }

    const settingsCards: MenuCard[] = [
      {
        id: 'set-lyrics',
        title: 'Lyrics',
        subtitle: settings.showLyrics ? (settings.karaokeLyrics ? 'Karaoke' : 'An') : 'Aus',
      },
      {
        id: 'set-display',
        title: 'Display',
        subtitle: settings.autoBrightness
          ? `Auto · ${settings.brightness}%`
          : `${settings.brightness}%`,
      },
      {
        id: 'set-volume',
        title: 'Lautstärke',
        subtitle: `+${settings.volumeStepPct}% pro Schritt`,
      },
      {
        id: 'set-mic',
        title: 'Sprach-Mikrofon',
        subtitle: settings.voiceMic ? 'An' : 'Aus',
      },
    ]

    const cardsByCategory: Record<string, MenuCard[]> = {
      home: [
        {
          id: 'light-main',
          title: HOME_LIGHT_LABEL,
          subtitle: lightSubtitle,
          kind: 'action',
          actionId: 'toggle-light',
        },
      ],
      'now-playing': nowPlayingCards,
      playlists: playlistCards,
      recent: recentCards,
      settings: settingsCards,
    }

    return MENU_CATEGORIES.map((category) => ({
      ...category,
      cards: cardsByCategory[category.id] ?? category.cards,
    }))
  }, [
    playlistItems,
    playlistsLoading,
    recentItems,
    recentLoading,
    lightState,
    lightLoading,
    lightError,
    settings,
    nowPlayingSnapshot,
  ])

  // bug8.2 (vertical dial): pre-decode every menu cover once so a sidebar
  // preview swap (full carousel remount) only pays layout/paint of already
  // decoded bitmaps instead of fetch+decode per tick
  const warmedArtRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const warmed = warmedArtRef.current
    for (const category of categories) {
      for (const card of category.cards) {
        const art = card.art
        if (!art || warmed.has(art)) continue
        warmed.add(art)
        const img = new Image()
        // match AlbumArt's fetch attributes so the browser reuses the same
        // cache entry (CORS images are cached separately)
        img.crossOrigin = 'anonymous'
        img.referrerPolicy = 'no-referrer'
        img.src = art
      }
    }
  }, [categories])

  // the confirmed selection (dial press / tap); in the sidebar pane the
  // carousel live-previews the *focused* item instead (bug1)
  const confirmedCategory =
    categories.find((category) => category.id === activeCategoryId) ?? categories[0]

  // dial press / tap on a card: start playback or trigger the action
  const handleCardAction = (card: MenuCard) => {
    if (card.kind === 'media' && card.uri) {
      // start playback and land directly on the 'Läuft gerade' pane
      setActiveCategoryId('now-playing')
      onPlay?.(card.uri)
    } else if (card.kind === 'action' && card.actionId === 'toggle-light') {
      // keep focus inside the carousel — no view transition
      void lightToggle()
    }
  }

  const focus = useMainMenuFocus({
    sidebarCount: categories.length,
    contentCount: confirmedCategory.cards.length,
    exitSidebarIndex: categories.findIndex((category) => category.id === 'now-playing'),
    onExit: () => onExit?.(),
    // keep the rendered pane in sync when a sidebar item is selected (dial press or tap)
    onSelectSidebar: (index) => {
      const category = categories[index]
      if (category) setActiveCategoryId(category.id)
    },
    onConfirmContent: (index) => {
      // only ever runs in the content pane, where displayed == confirmed
      const card = confirmedCategory.cards[index]
      if (card) handleCardAction(card)
    },
  })

  // stable across renders so the memoized carousel cards (bug8.2) never see a
  // changed onCardTap and re-render for nothing
  const selectFocusedCard = focus.selectContent
  const handleCardTap = useCallback(
    (_card: MenuCard, index: number) => selectFocusedCard(index),
    [selectFocusedCard],
  )

  // bug1: while focus is in the sidebar, the carousel previews the focused
  // item's content; in the content pane it shows the confirmed category
  const displayedCategory =
    focus.activePane === 'sidebar'
      ? categories[focus.sidebarIndex] ?? confirmedCategory
      : confirmedCategory

  const viewStyle = {
    '--menu-glow-a': displayedCategory.accent.a,
    '--menu-glow-b': displayedCategory.accent.b,
    // bug8: static per-category base tone, transitioned via background-color
    '--menu-bg': displayedCategory.bg,
  } as CSSProperties

  useSwipeGestures(viewRef, {
    // right swipe enters the content pane, left swipe returns to the sidebar
    onNext: () => focus.setActivePane('content'),
    onPrev: () => focus.setActivePane('sidebar'),
    onToggleView: () =>
      focus.setActivePane(focus.activePane === 'sidebar' ? 'content' : 'sidebar'),
    enabled: true,
  })

  const onCategorySelect = (id: string) => {
    const index = categories.findIndex((category) => category.id === id)
    if (index < 0) return
    if (id === 'now-playing') {
      // 'Läuft gerade' exits the menu immediately
      onExit?.()
      return
    }
    // selectSidebar triggers onSelectSidebar, which updates activeCategoryId
    focus.selectSidebar(index)
  }

  return (
    <div
      ref={viewRef}
      className={`${styles.view} ${focus.activePane === 'sidebar' ? styles.sidebarFocus : styles.contentFocus}`}
      style={viewStyle}
    >
      {/* bug8: lightweight static category background (no image blur) */}
      <div className={styles.bg} aria-hidden="true" />
      <aside className={styles.sidebarPane} aria-label="Menü-Navigation">
        <SidebarNav
          categories={categories}
          activeId={activeCategoryId}
          onSelect={onCategorySelect}
          focusedIndex={focus.activePane === 'sidebar' ? focus.sidebarIndex : undefined}
        />
      </aside>
      <main className={styles.contentPane} aria-label="Menü-Inhalt">
        <ContentCarousel
          cards={displayedCategory.cards}
          categoryId={displayedCategory.id}
          // selectContent confirms the tapped card (runs the card action exactly once)
          onCardTap={handleCardTap}
          focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
        />
      </main>
    </div>
  )
}
