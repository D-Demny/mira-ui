import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHomeLight, HOME_LIGHT_LABEL } from '@/hooks/useHomeLight'
import { useMainMenuFocus } from '@/hooks/useMainMenuFocus'
import { usePlaylists } from '@/hooks/usePlaylists'
import { usePlaylistTracks, LIKED_SONGS_ID } from '@/hooks/usePlaylistTracks'
import { useRecent } from '@/hooks/useRecent'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import { useSettings } from '@/settings'
import { pickSpotifyImage } from '@/api/client'
import type { ObserverStatusActive, PlayOffset } from '@/api/types'
import { SidebarNav } from './SidebarNav'
import { ContentCarousel } from './ContentCarousel'
import { MENU_CATEGORIES } from './mockData'
import type { MenuCard } from './mockData'
import styles from './MainMenuView.module.scss'

// the playlist track sub-menu (bug4): confirming a playlist card opens its
// track list; dial-back returns to the playlist list without playing.
// bug22: Liked Songs (spotify:collection:tracks) opens the same sub-menu,
// paged from me/tracks and played as its own collection context.
interface OpenTracklist {
  // the paging id for usePlaylistTracks (playlist id or LIKED_SONGS_ID)
  playlistId: string
  // the context uri played when a sub-menu track is confirmed
  // (spotify:playlist:<id> or spotify:collection:tracks)
  contextUri: string
  playlistName: string
  // where to restore the focus when the sub-menu closes
  playlistIndex: number
}

// bug5: when the dial focus this close to the end of the loaded tracks, the
// next page is fetched in the background
const LOAD_MORE_THRESHOLD = 9

export interface MainMenuViewProps {
  // starts playback for a media card uri; an optional offset starts a context
  // at a specific track (playlist track sub-menu); the view stays open and
  // switches to 'Läuft gerade'
  onPlay?: (uri: string, offset?: PlayOffset) => void
  // live player status so the 'Läuft gerade' pane can show current track + queue
  nowPlaying?: ObserverStatusActive | null
  // close the menu and return to the player (card 0 of the 'Läuft gerade'
  // carousel confirmed / back pressed while focus is on the sidebar)
  onExit?: () => void
}

// Nocturne-style main menu (tickets 8.4a1-8.4a3, 8.4b, 8.4c).
export function MainMenuView({ onPlay, nowPlaying, onExit }: MainMenuViewProps) {
  const [activeCategoryId, setActiveCategoryId] = useState('home')
  // bug4: non-null while a playlist's track list is open as a sub-menu
  const [openTracklist, setOpenTracklist] = useState<OpenTracklist | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)

  // destructured so the categories memo keys on stable primitives — the hook
  // results are new object literals on every render (bug8.1/8.2)
  const { items: playlistItems, loading: playlistsLoading } = usePlaylists()
  const {
    items: recentItems,
    loading: recentLoading,
    error: recentError,
    refetch: refetchRecent,
  } = useRecent()
  const { state: lightState, loading: lightLoading, error: lightError, toggle: lightToggle } =
    useHomeLight()
  const settings = useSettings()

  // bug4/bug5/bug7: track list of the open playlist (lazy pages + 5 min cache)
  const {
    tracks: trackItems,
    loading: tracksLoading,
    loadingMore: tracksLoadingMore,
    error: tracksError,
    loadMore: loadTrackPage,
    refetch: refetchTracks,
  } = usePlaylistTracks(openTracklist?.playlistId ?? null)

  // the observer polls every 3s and hands over a fresh status object each time
  // even when nothing changed; key the snapshot on the scalars that actually
  // feed the cards so card identities survive the polls (bug8.2)
  // bug3: the full queue (daemon caps it) feeds the 'Läuft gerade' cards
  const nowPlayingQueueKey = (nowPlaying?.next_tracks ?? [])
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
      queue: (nowPlaying.next_tracks ?? []).map((track) => ({
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
        // bug19: replay the context the track was played from (keeps the rest
        // of the queue) and fall back to the bare track uri when unknown
        uri: entry.context_uri || entry.track.uri,
      })
    }
    if (recentLoading && recentCards.length === 0) {
      recentCards.push({ id: 'rc-loading', title: 'Lade…', subtitle: '' })
    } else if (!recentLoading && recentCards.length === 0) {
      if (recentError) {
        // the history fetch failed (e.g. pathfinder payload drift) — offer a retry
        recentCards.push({ id: 'rc-error', title: recentError, subtitle: 'Erneut versuchen' })
      } else {
        // bug2.6: no play history yet — show an inert placeholder instead of an
        // empty carousel
        recentCards.push({ id: 'rc-empty', title: 'Noch nichts abgespielt', subtitle: '' })
      }
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

    // bug4: while a playlist's track list is open, the 'Playlists' pane shows
    // that playlist's tracks instead of the playlist library
    let tracklistCards: MenuCard[] | null = null
    if (openTracklist) {
      tracklistCards = trackItems.map((track) => ({
        id: `tr-${track.id}`,
        title: track.name,
        subtitle: track.artists.map((artist) => artist.name).join(', '),
        art: pickSpotifyImage(track.album?.images),
        kind: 'media',
        uri: track.uri,
      }))
      if (tracksLoading && tracklistCards.length === 0) {
        tracklistCards.push({ id: 'tr-loading', title: 'Lade…', subtitle: '' })
      } else if (!tracksLoading && tracklistCards.length === 0 && !tracksLoadingMore) {
        if (tracksError) {
          tracklistCards.push({ id: 'tr-error', title: tracksError, subtitle: 'Erneut versuchen' })
        } else {
          tracklistCards.push({ id: 'tr-empty', title: 'Keine Titel', subtitle: '' })
        }
      }
    }

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
      playlists: tracklistCards ?? playlistCards,
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
    recentError,
    lightState,
    lightLoading,
    lightError,
    settings,
    nowPlayingSnapshot,
    openTracklist,
    trackItems,
    tracksLoading,
    tracksLoadingMore,
    tracksError,
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

  // bug4/bug22: open a playlist's (or Liked Songs') track list as a sub-menu
  // (focus resets to track 0)
  const openPlaylistTracklist = (card: MenuCard, index: number) => {
    if (confirmedCategory.id !== 'playlists' || openTracklist) return
    const match = /^spotify:playlist:([^/]+)/.exec(card.uri ?? '')
    let playlistId = ''
    let contextUri = ''
    if (match) {
      playlistId = match[1]
      contextUri = card.uri ?? ''
    } else if (card.uri === LIKED_SONGS_ID) {
      // bug22: Liked Songs is a pseudo-playlist (me/tracks) with its own
      // collection context
      playlistId = LIKED_SONGS_ID
      contextUri = LIKED_SONGS_ID
    }
    if (!playlistId) return
    setOpenTracklist({
      playlistId,
      contextUri,
      playlistName: card.title,
      playlistIndex: index,
    })
    // focus the first track once the track cards are mounted
    focusRef.current?.focusContent(0)
  }

  // bug4: close the track sub-menu and restore the playlist focus
  const closeTracklist = () => {
    if (!openTracklist) return false
    setOpenTracklist(null)
    focusRef.current?.focusContent(openTracklist.playlistIndex)
    return true
  }

  // dial press / tap on a card: start playback, open a track list, or action
  const handleCardAction = (card: MenuCard, index: number) => {
    // bug3: confirming the current track in 'Läuft gerade' returns to the
    // full-screen player WITHOUT a play API call (no restart)
    if (confirmedCategory.id === 'now-playing' && index === 0 && card.id === 'np-current') {
      onExit?.()
      return
    }
    if (
      confirmedCategory.id === 'playlists' &&
      !openTracklist &&
      (card.uri?.startsWith('spotify:playlist:') || card.uri === LIKED_SONGS_ID)
    ) {
      // bug4/bug22: playlist / Liked Songs card opens the track sub-menu
      // instead of playing
      openPlaylistTracklist(card, index)
      return
    }
    // bug16/bug22: confirming a track in the track sub-menu plays the parent
    // context (playlist or Liked Songs collection) starting at that track, so
    // the rest of the list stays in the upcoming queue
    if (openTracklist && card.id.startsWith('tr-')) {
      const track = trackItems.find((t) => t.id === card.id.slice('tr-'.length))
      const offset: PlayOffset =
        track?.position !== undefined
          ? { position: track.position, uri: card.uri }
          : { position: index, uri: card.uri }
      setActiveCategoryId('now-playing')
      onPlay?.(openTracklist.contextUri, offset)
      return
    }
    if (card.kind === 'media' && card.uri) {
      // start playback and land directly on the 'Läuft gerade' pane
      setActiveCategoryId('now-playing')
      onPlay?.(card.uri)
    } else if (card.kind === 'action' && card.actionId === 'toggle-light') {
      // keep focus inside the carousel — no view transition
      void lightToggle()
    } else if (card.id === 'tr-error') {
      // error placeholder: dial press retries the track list fetch
      refetchTracks()
    } else if (card.id === 'rc-error') {
      // error placeholder (bug19): dial press retries the recents fetch
      refetchRecent()
    }
  }

  const focus = useMainMenuFocus({
    sidebarCount: categories.length,
    contentCount: confirmedCategory.cards.length,
    onExit: () => onExit?.(),
    // keep the rendered pane in sync when a sidebar item is selected (dial press or tap)
    onSelectSidebar: (index) => {
      const category = categories[index]
      if (category) {
        setActiveCategoryId(category.id)
        // leaving 'Playlists' closes the track sub-menu
        if (category.id !== 'playlists' && openTracklist) setOpenTracklist(null)
      }
    },
    onConfirmContent: (index) => {
      // only ever runs in the content pane, where displayed == confirmed
      const card = confirmedCategory.cards[index]
      if (card) handleCardAction(card, index)
    },
    // bug4: back in the content pane first closes the track sub-menu
    onContentBack: () => closeTracklist(),
  })

  // the handlers above close over focus; the hook's options are read through
  // refs, so a stable indirection keeps focusContent reachable in open/close
  const focusRef = useRef<typeof focus | null>(null)
  focusRef.current = focus

  // bug5: while dialing through the track sub-menu, fetch the next page in
  // the background once the focused card approaches the end of what is loaded
  useEffect(() => {
    if (!openTracklist || focus.activePane !== 'content') return
    if (trackItems.length === 0) return
    if (focus.contentIndex + LOAD_MORE_THRESHOLD >= trackItems.length) {
      loadTrackPage()
    }
  }, [
    openTracklist,
    focus.activePane,
    focus.contentIndex,
    trackItems.length,
    loadTrackPage,
  ])

  // bug15: the track sub-menu belongs to the playlists content pane; if focus
  // lands anywhere else (sidebar preview, another category, a swipe), close it
  // so its cards can never leak into a different category's carousel
  useEffect(() => {
    if (openTracklist && (activeCategoryId !== 'playlists' || focus.activePane !== 'content')) {
      setOpenTracklist(null)
    }
  }, [openTracklist, activeCategoryId, focus.activePane])

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

  // bug20: tapping any sidebar item (including 'Läuft gerade') transfers focus
  // to the content pane; there is no tap target that exits the menu
  const onCategorySelect = (id: string) => {
    const index = categories.findIndex((category) => category.id === id)
    if (index < 0) return
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
          // the track sub-menu gets its own id so the carousel scroll resets
          // when it opens/closes (bug8.1's reset is keyed on this value)
          categoryId={
            openTracklist ? `playlists:tracks:${openTracklist.playlistId}` : displayedCategory.id
          }
          // selectContent confirms the tapped card (runs the card action exactly once)
          onCardTap={handleCardTap}
          focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
        />
      </main>
    </div>
  )
}
