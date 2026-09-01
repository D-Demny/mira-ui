import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHomeLights, type HomeLightView } from '@/hooks/useHomeLight'
import { useMiraServer } from '@/hooks/useMiraServer'
import { useMainMenuFocus } from '@/hooks/useMainMenuFocus'
import { usePlaylists } from '@/hooks/usePlaylists'
import { usePlaylistTracks, LIKED_SONGS_ID } from '@/hooks/usePlaylistTracks'
import { useRecent } from '@/hooks/useRecent'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  updateSettings,
  useSettings,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
  type Settings,
} from '@/settings'
import { pickArtUrl } from '@/api/client'
import { useColorExtract, colorCacheGet, darkBg, rgba } from '@/hooks/useColorExtract'
import type { ObserverStatusActive, PlayOffset } from '@/api/types'
import { SidebarNav } from './SidebarNav'
import { ContentCarousel } from './ContentCarousel'
import { SettingsList, type SettingsRow } from './SettingsList'
import { MENU_CATEGORIES } from './mockData'
import type { MenuCard, MenuCategory } from './mockData'
import { warmArt } from './warmedArt'
import styles from './MainMenuView.module.scss'

// bug25: the lyric sync offset range mirrors the player SettingsSheet
const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

// bug34: on/off subtitle of a home light card — same states as the single
// primary light card had before (loading/unknown '…', error 'Offline', An/Aus)
function lightSubtitleFor(view: Pick<HomeLightView, 'state' | 'loading' | 'error'>): string {
  if (view.loading || view.state === null) return '…'
  if (view.error) return 'Offline'
  return view.state === 'on' ? 'An' : 'Aus'
}

// bug25: root rows of the 'Einstellungen' vertical list
function buildRootSettingsRows(settings: Settings, deviceName: string): SettingsRow[] {
  return [
    { id: 'set-main', title: 'Settings', value: '', kind: 'open-settings' },
    { id: 'set-lyrics', title: 'Show Lyrics', value: settings.showLyrics ? 'On' : 'Off', kind: 'toggle' },
    {
      id: 'set-karaoke',
      title: 'Karaoke Lyrics',
      value: settings.karaokeLyrics ? 'On' : 'Off',
      kind: 'toggle',
    },
    { id: 'set-mic', title: 'Mic', value: settings.voiceMic ? 'On' : 'Off', kind: 'toggle' },
    { id: 'set-devices', title: 'Devices', value: deviceName, kind: 'open-link' },
    { id: 'set-bt', title: 'Bluetooth Pairing', value: '', kind: 'open-link' },
  ]
}

// bug25: the 'Settings' sub-level rows (slider rows are dial-adjustable)
function buildAdjustSettingsRows(
  settings: Settings,
  defaultDevice: string | undefined,
  phoneVolume: boolean,
): SettingsRow[] {
  return [
    {
      id: 'set-default-device',
      title: 'Default Device',
      value: defaultDevice ?? 'None',
      kind: 'open-link',
    },
    {
      id: 'set-display',
      title: 'Display Size',
      value: `${settings.uiScalePct}%`,
      kind: 'slider',
      slider: {
        ariaLabel: 'Display size',
        value: settings.uiScalePct,
        min: UI_SCALE_MIN,
        max: UI_SCALE_MAX,
        step: UI_SCALE_STEP,
        format: (v) => `${v}%`,
        defaultValue: UI_SCALE_DEFAULT,
      },
    },
    {
      id: 'set-lyricsync',
      title: 'Lyric Sync',
      value: fmtOffset(settings.lyricOffsetMs),
      kind: 'slider',
      slider: {
        ariaLabel: 'Lyric sync offset',
        value: settings.lyricOffsetMs,
        min: OFFSET_MIN,
        max: OFFSET_MAX,
        step: OFFSET_STEP,
        format: fmtOffset,
        defaultValue: 0,
      },
    },
    {
      id: 'set-volume',
      title: 'Volume per turn',
      value: phoneVolume ? 'Set by phone' : `${settings.volumeStepPct}%`,
      kind: 'slider',
      slider: {
        ariaLabel: 'Volume per turn',
        value: settings.volumeStepPct,
        min: VOLUME_STEP_MIN,
        max: VOLUME_STEP_MAX,
        step: 1,
        format: (v) => `${v}%`,
        disabled: phoneVolume,
        defaultValue: 2,
      },
    },
    {
      id: 'set-brightness',
      title: 'Brightness',
      value: settings.autoBrightness ? 'Auto' : `${settings.brightness * 10}%`,
      kind: 'slider',
      autoToggle: true,
      autoOn: settings.autoBrightness,
      slider: {
        ariaLabel: 'Brightness',
        value: settings.brightness,
        min: BRIGHTNESS_MIN,
        max: BRIGHTNESS_MAX,
        step: 1,
        format: (v) => `${v * 10}%`,
        disabled: settings.autoBrightness,
        defaultValue: 5,
      },
    },
  ]
}

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

// bug48: how far around the focus the bug8.2 pre-decode reaches (cards on
// each side). The band always covers the mounted carousel window (base
// 16/16, capped at 40 cards → 19/20 max), so dialing never meets an
// undecoded cover — but the whole 501-track list is no longer front-loaded
// into Chromium's image cache (the OOM incident's ~116 MB fill). For
// categories with fewer than 2*PREDECODE_RADIUS+1 cards the band covers the
// entire list, so short categories keep the exact bug8.2 behavior.
const PREDECODE_RADIUS = 20

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
  // bug25: settings list integration — the value/name of the default device
  // and the App-level panels the list's link rows open
  defaultDevice?: string
  // playback volume is phone-controlled, so the step-size slider is inert
  phoneVolume?: boolean
  onOpenDefaultDevice?: () => void
  onOpenDevices?: () => void
  onOpenBluetooth?: () => void
  // bug46: a dimmable HA light card opens the brightness / color-temperature
  // popup (rendered by the App's globalOverlays) instead of toggling directly
  onOpenLightControl?: (entityId: string, label: string) => void
}

// Nocturne-style main menu (tickets 8.4a1-8.4a3, 8.4b, 8.4c).
export function MainMenuView({
  onPlay,
  nowPlaying,
  onExit,
  defaultDevice,
  phoneVolume = false,
  onOpenDefaultDevice,
  onOpenDevices,
  onOpenBluetooth,
  onOpenLightControl,
}: MainMenuViewProps) {
  const [activeCategoryId, setActiveCategoryId] = useState('home')
  // bug4: non-null while a playlist's track list is open as a sub-menu
  const [openTracklist, setOpenTracklist] = useState<OpenTracklist | null>(null)
  // bug25: the settings pane level — 'root' list or the 'Settings' sub-level
  const [settingsLevel, setSettingsLevel] = useState<'root' | 'adjust'>('root')
  // bug25: the sub-level row in 'adjust mode' — dial-confirm on a slider row
  // starts it, and while active the wheel changes the value instead of the focus
  const [adjustingRowId, setAdjustingRowId] = useState<string | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)

  // destructured so the categories memo keys on stable primitives — the hook
  // results are new object literals on every render (bug8.1/8.2)
  const { items: playlistItems, loading: playlistsLoading } = usePlaylists()
  const {
    items: recentItems,
    loading: recentLoading,
    error: recentError,
    refetch: refetchRecent,
    refresh: refreshRecent,
  } = useRecent()
  // bug34: every configured light in one hook (the same hook the Home
  // sub-menu uses); the categories memo keys on the scalar snapshot below,
  // never on the fresh per-render view objects (bug8.1)
  const lightViews = useHomeLights()
  const settings = useSettings()
  // epic10: Pi helper-server feature detection — starts the capabilities
  // poll while the main menu is mounted. The global state is consumed by the
  // later epic10 tasks (artwork loader, color engine, settings UI); this
  // view itself renders nothing from it yet
  useMiraServer()

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
    .map(
      (track) =>
        track
          ? `${track.track_id}|${track.uri}|${track.name}|${track.artist}|${track.image_url}`
          : '',
    )
    .join('\u0000')

  // bug34: useHomeLights() returns fresh view objects on every render — collapse
  // the per-light state into a scalar key (like nowPlayingQueueKey) so the
  // categories memo only rebuilds when a light's on/off/loading/error state
  // actually changes, never on the object churn alone (bug8.1). bug46: the
  // dimmable capability is part of the snapshot (the card action depends on
  // it once the capability fetch lands)
  const lightSnapshotKey = lightViews
    .map(
      (view) =>
        `${view.state ?? ''}|${view.loading ? 1 : 0}|${view.error ?? ''}|${view.dimmable ? 1 : 0}`,
    )
    .join('\u0000')

  // bug28: Spotify's Connect state can ship ghost slots in next_tracks for
  // single-track playback (entries with a uri but no metadata → blank card)
  // plus an echo of the currently playing track (duplicate card). Sanitize
  // the queue: drop null/empty slots (no uri or no name) and the current
  // track's echo, and keep each remaining entry's position in the ORIGINAL
  // next_tracks list (Spotify queue index, the active track being 0) so
  // bug26's in-queue skip offset stays correct after the list shrinks.
  const nowPlayingSnapshot = useMemo(() => {
    if (!nowPlaying) return null
    const queue: {
      id: string
      title: string
      subtitle: string
      art?: string
      uri: string
      position: number
    }[] = []
    const nextTracks = nowPlaying.next_tracks ?? []
    for (let i = 0; i < nextTracks.length; i++) {
      const track = nextTracks[i]
      if (!track || !track.uri || !track.name) continue
      if (
        track.uri === nowPlaying.track_uri ||
        (track.track_id !== '' && track.track_id === nowPlaying.track_id)
      ) {
        continue
      }
      queue.push({
        id: track.track_id || track.uri,
        title: track.name,
        subtitle: track.artist,
        art: track.image_url || undefined,
        uri: track.uri,
        position: i + 1,
      })
    }
    return {
      id: nowPlaying.track_id,
      title: nowPlaying.track_name,
      subtitle: nowPlaying.track_artist,
      art: nowPlaying.track_image || undefined,
      uri: nowPlaying.track_uri,
      queue,
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

  // bug41: stable identity of the currently playing track (uri first, id as
  // fallback) — feeds the carousel's in-category scroll reset. Both scalars
  // come from the snapshot memo above, so the key only changes when the ACTIVE
  // TRACK actually changes, never on the observer's 3s object churn
  const nowPlayingTrackKey = nowPlayingSnapshot
    ? nowPlayingSnapshot.uri || nowPlayingSnapshot.id
    : undefined

  // bug25: the 'Einstellungen' vertical list rows (root + sub-level); the
  // confirmed level is what the focus hook counts and confirms
  const settingsRootRows = useMemo(
    () => buildRootSettingsRows(settings, nowPlaying?.device_name ?? ''),
    [settings, nowPlaying?.device_name],
  )
  const settingsAdjustRows = useMemo(
    () => buildAdjustSettingsRows(settings, defaultDevice, phoneVolume),
    [settings, defaultDevice, phoneVolume],
  )
  // bug25: the sub-level (and its adjust mode) belong to the confirmed
  // 'Einstellungen' category — derived, not reset in an effect, so a focus
  // change writes no state; (re)entering settings resets both (onSelectSidebar)
  const isAdjustLevel = activeCategoryId === 'settings' && settingsLevel === 'adjust'
  const activeAdjustingRowId = activeCategoryId === 'settings' ? adjustingRowId : null
  const settingsRows = isAdjustLevel ? settingsAdjustRows : settingsRootRows

  const categories = useMemo(() => {
    // bug34: every configured HA light is a home carousel card (previously
    // only the primary light); card 0 stays the primary light and its tap
    // toggles that light, exactly as before
    const lightCards: MenuCard[] = lightViews.map((view) => ({
      id: `light-${view.entityId}`,
      title: view.label,
      subtitle: lightSubtitleFor(view),
      kind: 'action',
      actionId: `toggle-light:${view.entityId}`,
    }))

    // bug2.3: playlist cards show only the title — no owner name / track count
    const playlistCards: MenuCard[] = playlistItems.map((playlist) => ({
      id: `pl-${playlist.id}`,
      title: playlist.name,
      subtitle: '',
      art: pickArtUrl(playlist),
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
        art: pickArtUrl(entry.track),
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
          // bug26/bug28: the track's position in the Spotify queue — not the
          // card index, which shifts once ghost slots are sanitized out
          queuePosition: track.position,
        })
      }
    } else {
      nowPlayingCards.push({ id: 'np-idle', title: 'Nichts läuft', subtitle: '' })
    }

    // bug25: the settings rows double as the category's focus cards (count +
    // confirm target); the values mirror the live settings store
    const settingsCards: MenuCard[] = settingsRows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.value,
    }))

    // bug4: while a playlist's track list is open, the 'Playlists' pane shows
    // that playlist's tracks instead of the playlist library
    let tracklistCards: MenuCard[] | null = null
    if (openTracklist) {
      tracklistCards = trackItems.map((track) => ({
        id: `tr-${track.id}`,
        title: track.name,
        subtitle: track.artists.map((artist) => artist.name).join(', '),
        art: pickArtUrl(track),
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
      home: lightCards,
      'now-playing': nowPlayingCards,
      playlists: tracklistCards ?? playlistCards,
      recent: recentCards,
      settings: settingsCards,
    }

    return MENU_CATEGORIES.map((category) => ({
      ...category,
      cards: cardsByCategory[category.id] ?? category.cards,
    }))
    // deliberately keyed on the scalar snapshot above (lightSnapshotKey), not
    // on the lightViews objects, which are new on every render (bug8.1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playlistItems,
    playlistsLoading,
    recentItems,
    recentLoading,
    recentError,
    lightSnapshotKey,
    settingsRows,
    nowPlayingSnapshot,
    openTracklist,
    trackItems,
    tracksLoading,
    tracksLoadingMore,
    tracksError,
  ])

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
    // bug26: confirming an upcoming queue card skips WITHIN the active queue —
    // play the live context starting at that track (offset) instead of the
    // bare track uri, which would restart single-track playback and clear the
    // queue. position is the track's index in the SPOTIFY queue (the active
    // track is 0) — carried on the card (bug28: sanitizing ghost slots out of
    // the card list must not shift the queue positions). Single-track contexts
    // (context_uri is a track uri or empty) have no shared queue: play the
    // track directly, as before.
    if (confirmedCategory.id === 'now-playing' && index > 0 && card.id.startsWith('np-q-')) {
      if (!card.uri) return
      setActiveCategoryId('now-playing')
      const contextUri = nowPlaying?.context_uri ?? ''
      if (contextUri && !contextUri.startsWith('spotify:track:')) {
        onPlay?.(contextUri, { position: card.queuePosition ?? index, uri: card.uri })
      } else {
        onPlay?.(card.uri)
      }
      // bug41: the selected track becomes the new current track once the
      // observer status arrives, so the carousel focus goes back to index 0
      // (the new np-current card). The list itself is still the old one at
      // this point — index 0 exists in every now-playing variant, and the
      // async list update keeps the focus on the freshly active track.
      focusRef.current?.focusContent(0)
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
    } else if (card.kind === 'action' && card.actionId?.startsWith('toggle-light:')) {
      // bug34: per-light action — the action id carries the entity id (card 0
      // = the former primary card). Keep focus inside the carousel — no view
      // transition.
      // bug46: dimmable lights (capability from supported_color_modes) open
      // the brightness / color-temperature control popup instead of toggling;
      // non-dimmable lights — and lights whose capability is still unknown
      // (first fetch pending, offline) — keep the direct toggle
      const entityId = card.actionId.slice('toggle-light:'.length)
      const view = lightViews.find((light) => light.entityId === entityId)
      if (view?.dimmable) {
        onOpenLightControl?.(view.entityId, view.label)
      } else {
        view?.toggle()
      }
    } else if (card.id === 'tr-error') {
      // error placeholder: dial press retries the track list fetch
      refetchTracks()
    } else if (card.id === 'rc-error') {
      // error placeholder (bug19): dial press retries the recents fetch
      refetchRecent()
    }
    // bug25: settings root rows
    else if (card.id === 'set-main') {
      setSettingsLevel('adjust')
      setAdjustingRowId(null)
      focusRef.current?.focusContent(0)
    } else if (card.id === 'set-lyrics') {
      updateSettings({ showLyrics: !settings.showLyrics })
    } else if (card.id === 'set-karaoke') {
      updateSettings({ karaokeLyrics: !settings.karaokeLyrics })
    } else if (card.id === 'set-mic') {
      updateSettings({ voiceMic: !settings.voiceMic })
    } else if (card.id === 'set-devices') {
      onOpenDevices?.()
    } else if (card.id === 'set-bt') {
      onOpenBluetooth?.()
    } else if (card.id === 'set-default-device') {
      onOpenDefaultDevice?.()
    } else if (card.id === 'set-brightness') {
      // bug35: dial press / click on the brightness row toggles auto brightness
      // (like the sun chip) — no adjust mode; while auto is OFF the wheel on
      // the focused row adjusts the level directly (handleWheelContent)
      updateSettings({ autoBrightness: !settings.autoBrightness })
    } else if (
      // bug25: dial-confirm on a slider row toggles its adjust mode; while
      // active the wheel changes the value (handleWheelContent)
      card.id === 'set-display' ||
      card.id === 'set-lyricsync' ||
      card.id === 'set-volume'
    ) {
      setAdjustingRowId(activeAdjustingRowId === card.id ? null : card.id)
    }
  }

  // bug25: adjust mode — the wheel changes the value of the adjusting row
  // instead of moving the focus; turning past the min/max boundary leaves
  // adjust mode and the focus moves on with the same tick. bug35: the
  // brightness row adjusts directly on the wheel while focused (no explicit
  // adjust mode); while auto brightness is ON (slider disabled) or at the
  // min/max bound the tick falls through to plain row navigation
  const handleWheelContent = (dir: 1 | -1): boolean => {
    if (confirmedCategory.id !== 'settings' || !isAdjustLevel) return false
    const row = settingsAdjustRows[focus.contentIndex]
    const slider = row?.slider
    if (!row || !slider) return false
    if (row.id === 'set-brightness') {
      if (slider.disabled) return false
      const next = Math.max(slider.min, Math.min(slider.max, slider.value + dir * slider.step))
      if (next === slider.value) return false // clamped at the bound: keep navigating
      updateSettings({ brightness: next })
      return true
    }
    if (activeAdjustingRowId !== row.id || slider.disabled) return false
    const next = Math.max(slider.min, Math.min(slider.max, slider.value + dir * slider.step))
    if (next === slider.value) {
      setAdjustingRowId(null)
      return false
    }
    const patch: Partial<Settings> =
      row.id === 'set-display'
        ? { uiScalePct: next }
        : row.id === 'set-lyricsync'
          ? { lyricOffsetMs: next }
          : { volumeStepPct: next }
    updateSettings(patch)
    return true
  }

  // bug25: NotchedSlider drag (touch) updates the same store the dial does
  const handleSliderChange = (rowId: string, value: number) => {
    if (rowId === 'set-display') updateSettings({ uiScalePct: value })
    else if (rowId === 'set-lyricsync') updateSettings({ lyricOffsetMs: value })
    else if (rowId === 'set-volume') updateSettings({ volumeStepPct: value })
    else if (rowId === 'set-brightness') updateSettings({ brightness: value })
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
        // bug25: (re)entering 'Einstellungen' always starts on the root rows
        if (category.id === 'settings') {
          setSettingsLevel('root')
          setAdjustingRowId(null)
        }
      }
    },
    onConfirmContent: (index) => {
      // only ever runs in the content pane, where displayed == confirmed
      const card = confirmedCategory.cards[index]
      if (card) handleCardAction(card, index)
    },
    // bug4/bug25: back in the content pane first leaves the settings sub-level,
    // then closes the track sub-menu
    onContentBack: () => {
      if (isAdjustLevel) {
        setSettingsLevel('root')
        setAdjustingRowId(null)
        focusRef.current?.focusContent(0)
        return true
      }
      return closeTracklist()
    },
    // bug25: a slider row in adjust mode consumes the tick to adjust its value
    onWheelContent: handleWheelContent,
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

  // bug30: the 'Zuletzt' pane shows the play history, which goes stale as soon
  // as anything is played after the hook's mount fetch (the module cache only
  // refetches on remount or after the TTL expires). Refresh the history on
  // every confirmed entry into the category — keyed on the CONFIRMED category,
  // never on the sidebar preview, so dial ticks alone don't spam fetches.
  // bug37: the refresh is SILENT (cache-first) — the cached, possibly stale
  // items render instantly on entry, the fresh page lands in the background
  // and swaps in on arrival without a loading state (no 'Lade…' flash, and a
  // failed revalidation keeps the stale history on screen instead of an
  // error card). Freshness is unchanged: every confirmed entry still fetches.
  const prevCategoryIdRef = useRef(activeCategoryId)
  useEffect(() => {
    const prev = prevCategoryIdRef.current
    prevCategoryIdRef.current = activeCategoryId
    if (activeCategoryId === 'recent' && prev !== 'recent') {
      void refreshRecent()
    }
  }, [activeCategoryId, refreshRecent])

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

  // bug24: the ambient background follows the focused card's artwork. The
  // hook extracts (and caches) the focused cover; the style reads the cache
  // synchronously, so an already-processed cover applies on the very first
  // focused render and an uncached one keeps the static category colors
  // until extraction finishes (the hook's state update then re-renders from
  // the freshly filled cache)
  const focusedCard =
    focus.activePane === 'content'
      ? confirmedCategory.cards[focus.contentIndex]
      : displayedCategory.cards[0]
  const focusedArt = focusedCard?.art
  useColorExtract(focusedArt)
  const ambientAccent = focusedArt ? colorCacheGet(focusedArt) : null

  // bug47 R2 (F3): the last warmed band per category — the index range plus
  // the category object that was warmed, so a rebuilt card list (page load,
  // queue reorder, track-list/library swap) is detected and re-warmed in
  // full. Lives in a ref: the diff is state without rendering consequences.
  const lastWarmBandRef = useRef<
    Map<string, { start: number; end: number; category: MenuCategory }>
  >(new Map())

  // bug8.2: pre-decode menu covers once so a sidebar preview swap (full
  // carousel remount) only pays layout/paint of already decoded bitmaps
  // instead of fetch+decode per tick. bug45 option C: the warmed-url set is
  // FIFO-bounded (1000) — evicted urls are re-warmed on the next focus.
  // bug48: only the PREDECODE_RADIUS band around the displayed category's
  // focus is warmed — every other category around its entry point (card 0,
  // where the sidebar preview and a fresh entry both start). Warming an
  // entire 501-track list front-loaded ~180 MB of decoded bitmaps into
  // Chromium's image cache during the OOM incident; the band covers the
  // mounted carousel window (≤40 cards), so dialing still never meets an
  // undecoded cover. Declared after displayedCategory/focus exist.
  // bug47 R2 (F3): INCREMENTAL — the effect used to re-walk all five category
  // bands on every focus change (~235 warmArt set lookups per dial tick, in
  // the same task as the carousel's passive effects). Now only the band
  // DIFF since the last run is warmed: a dial tick slides the displayed
  // category's band by one card → 1-2 new edge covers (warmArt is idempotent,
  // so the diff is computed on index ranges; a rebuilt category or a band
  // reset warms the full new band). The covers of the stable band interior
  // were warmed earlier and warmArt skips them — same warm timing (band
  // entry) as before, ~2 lookups instead of ~235 per tick.
  useEffect(() => {
    const warmRange = (category: MenuCategory, from: number, to: number) => {
      for (let i = from; i < to; i++) {
        const art = category.cards[i].art
        if (!art || !warmArt(art)) continue
        const img = new Image()
        // match AlbumArt's fetch attributes so the browser reuses the same
        // cache entry (CORS images are cached separately)
        img.crossOrigin = 'anonymous'
        img.referrerPolicy = 'no-referrer'
        img.src = art
      }
    }
    const lastBand = lastWarmBandRef.current
    for (const category of categories) {
      const isDisplayed = category === displayedCategory
      const focusIndex = isDisplayed && focus.activePane === 'content' ? focus.contentIndex : 0
      const bandStart = Math.max(0, focusIndex - PREDECODE_RADIUS)
      const bandEnd = Math.min(category.cards.length, focusIndex + 1 + PREDECODE_RADIUS)
      const prev = lastBand.get(category.id)
      if (prev && prev.category === category) {
        // same card list: warm only what the band gained since the last run
        // (a dial tick gained one edge card; a back-and-forth slide gains
        // nothing, because the dropped edge was already warmed)
        if (bandStart < prev.start) warmRange(category, bandStart, Math.min(bandEnd, prev.start))
        if (bandEnd > prev.end) warmRange(category, Math.max(bandStart, prev.end), bandEnd)
      } else {
        // first sighting or rebuilt card list: warm the full band — warmArt
        // de-dupes the urls already in the set
        warmRange(category, bandStart, bandEnd)
      }
      lastBand.set(category.id, { start: bandStart, end: bandEnd, category })
    }
  }, [categories, displayedCategory, focus.activePane, focus.contentIndex])

  const viewStyle = {
    ...(ambientAccent
      ? {
          // bug24: ambient colors derived from the focused card's artwork
          '--menu-bg': darkBg(ambientAccent),
          '--menu-glow-a': rgba(ambientAccent, 0.5),
          '--menu-glow-b': rgba(ambientAccent, 0.42),
        }
      : {
          '--menu-glow-a': displayedCategory.accent.a,
          '--menu-glow-b': displayedCategory.accent.b,
          // bug8: static per-category base tone, transitioned via background-color
          '--menu-bg': displayedCategory.bg,
        }),
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
      {/* bug8/bug24: ambient background — static per category, or driven by
          the focused card's artwork colors */}
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
        {displayedCategory.id === 'settings' ? (
          // bug25: the settings pane is a vertical list; the sidebar preview
          // always shows the root rows, the confirmed pane the open level
          <SettingsList
            rows={settingsRows}
            focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
            adjustingRowId={activeAdjustingRowId}
            onRowTap={(index) => selectFocusedCard(index)}
            onSliderChange={handleSliderChange}
            onToggleAuto={() => updateSettings({ autoBrightness: !settings.autoBrightness })}
          />
        ) : (
          <ContentCarousel
            cards={displayedCategory.cards}
            // the track sub-menu gets its own id so the carousel scroll resets
            // when it opens/closes (bug8.1's reset is keyed on this value)
            categoryId={
              openTracklist ? `playlists:tracks:${openTracklist.playlistId}` : displayedCategory.id
            }
            // bug41: the playing track's identity, only for the 'Läuft gerade'
            // pane — a change re-orders the queue cards in place (queue skip /
            // natural advance) and the carousel must scroll back to the new
            // first card. Keyed on the track uri/id scalars of the snapshot
            // memo, so observer re-projections of the SAME track (3s poll)
            // never re-trigger the reset
            activeTrackKey={
              displayedCategory.id === 'now-playing' ? nowPlayingTrackKey : undefined
            }
            // selectContent confirms the tapped card (runs the card action exactly once)
            onCardTap={handleCardTap}
            focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
            // bug47: dial ticks scroll instantly, taps/confirms/switches keep
            // the smooth scroll (the hook tags the last focus change)
            focusScrollBehavior={focus.contentMoveKind === 'dial' ? 'auto' : 'smooth'}
          />
        )}
      </main>
    </div>
  )
}
