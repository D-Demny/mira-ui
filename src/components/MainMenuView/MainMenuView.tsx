import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useHomeSelectedEntities, type HomeEntityView } from '@/hooks/useHomeEntities'
import { useMiraServer } from '@/hooks/useMiraServer'
import type { MiraServerState } from '@/api/miraServer'
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
  type HaSettingsValue,
  type Settings,
} from '@/settings'
import { haBaseStatus } from '@/hooks/useHaStatus'
import { pickArtUrl } from '@/api/client'
import { remoteArtUrl } from '@/api/miraImg'
import { useColorExtract, colorCacheGet, darkBg, rgba } from '@/hooks/useColorExtract'
import type { ObserverStatusActive, PlayOffset } from '@/api/types'
import { SidebarNav } from './SidebarNav'
import { ContentCarousel } from './ContentCarousel'
import {
  COLLAPSED_SIDEBAR_WIDTH,
  NO_WINDOW_THRESHOLD,
  SCROLL_SAFE_MARGIN,
  SIDEBAR_WIDTH,
  windowRange,
} from './carouselWindow'
import { SettingsList, type SettingsRow } from './SettingsList'
import { MENU_CATEGORIES } from './mockData'
import type { MenuCard, MenuCategory } from './mockData'
import { warmArt } from './warmedArt'
import { entityArt } from './homeEntityArt'
import { HomeDashboardView } from './HomeDashboardView'
import { buildCoverSection, buildLightGrid, buildSceneRow, classifyEntities } from './homeDashboard'
import type { CoverColumnModel, LightTileModel, SceneSlotModel } from './homeDashboard'
import styles from './MainMenuView.module.scss'

// bug25: the lyric sync offset range mirrors the player SettingsSheet
const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

// ticket 9.3: per-domain status subtitle of a home entity card — same state
// ladder as the bug34 light subtitle (loading/unknown '…', error 'Offline'),
// then the domain's active words (scene has no state → fixed 'Szene')
function entitySubtitleFor(view: HomeEntityView): string {
  if (view.loading || view.state === null) return '…'
  if (view.error) return 'Offline'
  switch (view.domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return view.active ? 'An' : 'Aus'
    case 'cover':
      return view.active ? 'Offen' : 'Zu'
    case 'media_player':
      return view.active ? 'Läuft' : view.state === 'paused' ? 'Pausiert' : 'Bereit'
    case 'scene':
      return 'Szene'
    default:
      return view.state
  }
}

// epic10 task 4: the short status shown on the 'Raspberry Pi' settings row
function piRowValue(mode: MiraServerState['mode']): string {
  if (mode === 'compute') return 'Compute Mode'
  if (mode === 'lightweight') return 'Cache Only'
  return 'Standalone'
}

// ticket 9.4: the short status shown on the 'Home Assistant' settings row —
// pure (the connection probe lives in the modal only, never in the row)
function haRowValue(ha: HaSettingsValue): string {
  return haBaseStatus(ha) === 'configured' ? 'Konfiguriert' : 'Default'
}

// bug54 v2 (08.09) / bug58: the four 'Menü-Hintergrund' options with their
// row labels, in cycle order (Schwarz → Halbdurchsichtig → Durchsichtig →
// Unschärfe). The enum values keep their pre-v2 names (backward compat of
// stored blobs); v2 relabelled 'translucent' ('Durchsichtig' →
// 'Halbdurchsichtig') and added 'clear' (100% transparent,
// 'Durchsichtig'); bug58 adds the fourth option 'blur' ('Unschärfe').
const SIDEBAR_BG_LABELS: Record<Settings['sidebarBackground'], string> = {
  solid: 'Schwarz',
  translucent: 'Halbdurchsichtig',
  clear: 'Durchsichtig',
  blur: 'Unschärfe',
}

// bug25: root rows of the 'Einstellungen' vertical list
function buildRootSettingsRows(
  settings: Settings,
  deviceName: string,
  piMode: MiraServerState['mode'],
  homeEntityCount: number,
): SettingsRow[] {
  return [
    { id: 'set-main', title: 'Settings', value: '', kind: 'open-settings' },
    {
      id: 'set-lyrics',
      title: 'Show Lyrics',
      value: settings.showLyrics ? 'On' : 'Off',
      kind: 'toggle',
    },
    {
      id: 'set-karaoke',
      title: 'Karaoke Lyrics',
      value: settings.karaokeLyrics ? 'On' : 'Off',
      kind: 'toggle',
    },
    { id: 'set-mic', title: 'Mic', value: settings.voiceMic ? 'On' : 'Off', kind: 'toggle' },
    { id: 'set-devices', title: 'Devices', value: deviceName, kind: 'open-link' },
    { id: 'set-bt', title: 'Bluetooth Pairing', value: '', kind: 'open-link' },
    // epic10 task 4: opens the Raspberry Pi provisioning/connection view
    { id: 'set-pi', title: 'Raspberry Pi', value: piRowValue(piMode), kind: 'open-link' },
    // ticket 9.4: opens the Home Assistant connection settings view; issue #37
    // groups it under the 'Home Assistant' section and renames the row
    {
      id: 'set-ha',
      title: 'Verbindung',
      value: haRowValue(settings.ha),
      kind: 'open-link',
      section: 'Home Assistant',
    },
    // ticket 9.5: opens the home entity picker (select + reorder the carousel);
    // issue #37 renames the row to 'Entity picker' (same section as set-ha)
    {
      id: 'set-home',
      title: 'Entity picker',
      value: homeEntityCount === 1 ? '1 Entität' : `${homeEntityCount} Entitäten`,
      kind: 'open-link',
      section: 'Home Assistant',
    },
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
        defaultValue: 4,
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
    // bug54: appended (not inserted) to keep every existing row index stable
    {
      id: 'set-sidebar-bg',
      title: 'Menü-Hintergrund',
      value: SIDEBAR_BG_LABELS[settings.sidebarBackground],
      kind: 'toggle',
    },
    // ticket 8.1: LAST row on purpose — same append principle, auto-collapse
    // the sidebar while the dial focus is off it
    {
      id: 'set-auto-collapse',
      title: 'Menü Einklappen',
      value: settings.autoCollapseSidebar === 'on' ? 'On' : 'Off',
      kind: 'toggle',
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
  // switches to 'Läuft gerade' — issue #56: only AFTER the play request
  // resolves, so pass a promise (the App's onPlayFromMenu does)
  onPlay?: (uri: string, offset?: PlayOffset) => void | Promise<void>
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
  // ticket 9.5: the 'Entity picker' settings row opens the entity picker overlay
  // (rendered by the App's globalOverlays). The inline manage card that used
  // to open it from the Home carousel was removed in this ticket — the
  // picker is reached via Einstellungen → Home Assistant → Entity picker now
  // (issue #37)
  onOpenEntityPicker?: () => void
  // epic10 task 4: the 'Raspberry Pi' settings row opens the provisioning
  // view (rendered by the App's globalOverlays)
  onOpenPiServer?: () => void
  // ticket 9.4: the 'Home Assistant' settings row opens the connection
  // settings modal (rendered by the App's globalOverlays)
  onOpenHaSettings?: () => void
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
  onOpenEntityPicker,
  onOpenPiServer,
  onOpenHaSettings,
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
  // ticket 9.3: the user-selected entities in one hook (the same hook the
  // Home sub-menu uses); the categories memo keys on the scalar snapshot
  // below, never on the fresh per-render view objects (bug8.1)
  // bug57 v2: the 3s HA poll runs only while the Home carousel is actually
  // the confirmed (visible) category — no daemon traffic in the other menus;
  // (re-)entering 'home' triggers an immediate fresh read inside the hook
  const selectedEntities = useHomeSelectedEntities(activeCategoryId === 'home')
  const settings = useSettings()
  // epic10: Pi helper-server feature detection — starts the capabilities
  // poll while the main menu is mounted. The artwork pre-decode below uses
  // remoteBlur to warm the url the cards actually load (Pi pre-processed
  // artwork vs. direct CDN url); the color engine and the settings UI
  // consume the same global state
  const miraServer = useMiraServer()

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
    .map((track) =>
      track
        ? `${track.track_id}|${track.uri}|${track.name}|${track.artist}|${track.image_url}`
        : '',
    )
    .join('\u0000')

  // ticket 9.3: useHomeSelectedEntities() returns fresh view objects on every
  // render — collapse the per-entity state into a scalar key (like
  // nowPlayingQueueKey) so the categories memo only rebuilds when an entity's
  // id/state/loading/error/active/dimmable actually changes, never on the
  // object churn alone (bug8.1)
  const homeSnapshotKey = selectedEntities
    .map(
      (view) =>
        view.entityId +
        '|' +
        (view.state ?? '') +
        '|' +
        (view.loading ? 1 : 0) +
        '|' +
        (view.error ?? '') +
        '|' +
        (view.active === null ? 'n' : view.active ? 1 : 0) +
        '|' +
        (view.dimmable ? 1 : 0),
    )
    .join('\u0000')

  // ticket 9.6 (Task C): the Home dashboard grid's view models — the same
  // pure builders HomeDashboardView uses internally, so MainMenuView can
  // count the dial focus slots (scenes → lights → cover columns; placeholders
  // are focus stops too) without re-implementing the mapping math. issue #48:
  // the SAME empty-zone suppression as in HomeDashboardView is mirrored here,
  // so the dial stop count and the confirm/hold routing below match exactly
  // what the dashboard renders (a suppressed zone contributes zero slots).
  const homeDashboard = useMemo(() => {
    const { scenes, lights, covers } = classifyEntities(selectedEntities)
    return {
      sceneRow: scenes.length === 0 ? [] : buildSceneRow(scenes),
      lightGrid: buildLightGrid(lights),
      coverSection:
        covers.length === 0
          ? { ...buildCoverSection(covers), columns: [] }
          : buildCoverSection(covers),
    }
  }, [selectedEntities])

  // ticket 9.6 W2: short-press actions on the Home dashboard (tap / dial
  // confirm). Each callback receives the slot/tile/column model from
  // HomeDashboardView; placeholder models (entityId === null) are ignored
  // here — the component shows its own inline toast for those presses. Real
  // slots route through the SAME actuation path as the carousel cards:
  // scenes and lights run view.actuate(), covers use the directional
  // coverActuate (covers cannot be toggled — the direction is explicit)
  const homeSceneTap = (slot: SceneSlotModel) => {
    if (slot.entityId === null) return
    selectedEntities.find((e) => e.entityId === slot.entityId)?.actuate()
  }
  const homeLightTap = (tile: LightTileModel) => {
    if (tile.entityId === null) return
    selectedEntities.find((e) => e.entityId === tile.entityId)?.actuate()
  }
  const homeCoverAction = (column: CoverColumnModel, direction: 'up' | 'down') => {
    if (column.entityId === null) return
    selectedEntities
      .find((e) => e.entityId === column.entityId)
      ?.coverActuate(direction === 'up' ? 'open' : 'close')
  }

  // ticket 9.6 W2-3: shared HOLD routing for Home dashboard slots — ONE
  // helper used by BOTH input paths (the dial hold via onHoldContent below,
  // the touch hold via the onLightHold/onCoverHold props of
  // <HomeDashboardView> further down), so dial-hold and touch-hold behave
  // identically. Light slots open HALightControlModal: placeholder tiles pass
  // 'placeholder:<label>' (the modal shows its empty demo state for unknown
  // ids — intended per ticket), real NON-dimmable lights do nothing (the
  // touch path only arms a hold on dimmable tiles). Cover columns stop their
  // motion; placeholder columns no-op here (the dashboard toasts them).
  const homeHoldRoute = (tile: LightTileModel | null, column: CoverColumnModel | null) => {
    if (tile !== null) {
      if (tile.entityId === null) {
        // placeholder tile → the modal's empty demo state for unknown ids
        onOpenLightControl?.(`placeholder:${tile.label}`, tile.label)
        return
      }
      if (!tile.dimmable) return
      onOpenLightControl?.(tile.entityId, tile.label)
      return
    }
    if (column === null || column.entityId === null) return
    selectedEntities.find((e) => e.entityId === column.entityId)?.coverActuate('stop')
  }

  // slot-index → model resolution for the dial hold — same offsets as
  // onConfirmContent: scenes[0..s) → lights → cover columns
  const homeHoldSlot = (index: number) => {
    if (index < homeDashboard.sceneRow.length) return // scene slots: hold is a no-op
    const li = index - homeDashboard.sceneRow.length
    if (li < homeDashboard.lightGrid.length) {
      homeHoldRoute(homeDashboard.lightGrid[li], null)
      return
    }
    homeHoldRoute(
      null,
      homeDashboard.coverSection.columns[li - homeDashboard.lightGrid.length] ?? null,
    )
  }

  // bug28: Spotify's Connect state can ship ghost slots in next_tracks for
  // single-track playback (entries with a uri but no metadata → blank card)
  // plus an echo of the currently playing track (duplicate card). Sanitize
  // the queue: drop null/empty slots (no uri or no name) and the current
  // track's echo, and keep each remaining entry's position in the ORIGINAL
  // next_tracks list (Spotify queue index, the active track being 0) so
  // bug26's in-queue skip offset stays correct after the list shrinks.
  // bug58: dial-FPS fix shipped as permanent behavior (see the static-bg
  // freeze below and ContentCarousel's scroll-port classes); the temporary
  // A/B experiment flags were stripped after on-device measurement

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
      const rawArt = track.image_url || undefined
      queue.push({
        id: track.track_id || track.uri,
        title: track.name,
        subtitle: track.artist,
        art: rawArt,
        uri: track.uri,
        position: i + 1,
      })
    }
    const activeArt = nowPlaying.track_image || undefined
    return {
      id: nowPlaying.track_id,
      title: nowPlaying.track_name,
      subtitle: nowPlaying.track_artist,
      art: activeArt,
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
  // confirmed level is what the focus hook counts and confirms. The
  // 'Raspberry Pi' row's value mirrors the live Pi server mode (epic10)
  const settingsRootRows = useMemo(
    () =>
      buildRootSettingsRows(
        settings,
        nowPlaying?.device_name ?? '',
        miraServer.mode,
        selectedEntities.length,
      ),
    [settings, nowPlaying?.device_name, miraServer.mode, selectedEntities.length],
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
  // bug54 v2 / bug58: the 'Menü-Hintergrund' setting — 'translucent' and
  // 'blur' render the sidebar as a semi-transparent glass panel (bug58's
  // 'Unschärfe' reuses the .glass look — ticket Task 4 — so no new
  // SidebarNav prop value is needed; in blur mode the cards now actually
  // pass under it, unblurred for now — the per-card blur follows),
  // 'clear' as a fully transparent background
  // (no visible panel, only the menu entries), 'solid' keeps it opaque. The
  // three non-blur modes keep the solid carousel geometry (cards clipped at
  // the menu edge — see slidesUnderSidebar below)
  const sidebarNavBackground =
    settings.sidebarBackground === 'translucent' || settings.sidebarBackground === 'blur'
      ? 'glass'
      : settings.sidebarBackground === 'clear'
        ? 'clear'
        : 'solid'
  // bug54 (08.09.2026 user change, incl. v2): does the mode slide the
  // content carousel under the sidebar? Per mode:
  //   'solid': no — strict clipping at the sidebar's right edge
  //   'translucent': no — the changed acceptance criteria require the cards
  //   to be INVISIBLE under the menu: they are clipped at the menu edge
  //   exactly like 'solid' (same viewport, same card geometry, same dial
  //   centering); only the panel's look differs (.glass, the app background
  //   shows through where no card is)
  //   'clear': no — 100% transparent background (v2); same clipping as the
  //   other modes, only no visible panel background at all
  //   'blur': yes (bug58 T2) — Bug58 needs the cards to actually pass under
  //   the menu so they can be blurred there (the per-card blur follows in
  //   T3; until then they show through the .glass panel unblurred). The
  //   content pane spans the full screen (clipped at the SCREEN edge), the
  //   carousel viewport starts under the sidebar (underflowPx=SIDEBAR_WIDTH)
  //   with the underflow dial centering geometry, and the settings list
  //   keeps a left inset of the sidebar width (.settingsUnderflow).
  // This flag gates the underflow mechanism (negative content-pane margin,
  // the carousel's .underflow padding, the CarouselGeometry underflow
  // centering) — only 'blur' applies it.
  const slidesUnderSidebar = settings.sidebarBackground === 'blur'

  const categories = useMemo(() => {
    // ticket 9.3: every user-selected entity is a home carousel card, in
    // selection order.
    // ticket 9.5: the inline manage card ('Entitäten wählen') is GONE from
    // the Home carousel — the picker (selection + reordering) is reached via
    // Einstellungen → Home Assistant → Entity picker now (issue #37). An empty
    // selection still gets an inert placeholder pointing to the new location
    const homeCards: MenuCard[] = selectedEntities.map((view) => ({
      id: 'ha-' + view.entityId,
      title: view.label,
      subtitle: entitySubtitleFor(view),
      art: entityArt(view.domain, view.entityId, view.active),
      kind: 'action' as const,
      actionId: 'ha-act:' + view.entityId,
    }))
    if (selectedEntities.length === 0) {
      homeCards.push({
        id: 'ha-empty',
        title: 'Keine Entitäten gewählt',
        subtitle: 'In den Einstellungen wählen',
      })
    }

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
      home: homeCards,
      'now-playing': nowPlayingCards,
      playlists: tracklistCards ?? playlistCards,
      recent: recentCards,
      settings: settingsCards,
    }

    return MENU_CATEGORIES.map((category) => ({
      ...category,
      cards: cardsByCategory[category.id] ?? category.cards,
    }))
    // deliberately keyed on the scalar snapshot above (homeSnapshotKey), not
    // on the selectedEntities objects, which are new on every render (bug8.1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playlistItems,
    playlistsLoading,
    recentItems,
    recentLoading,
    recentError,
    homeSnapshotKey,
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

  // issue #56: start playback and switch to the 'Läuft gerade' pane ONLY once
  // the play request succeeded. The old code switched optimistically before
  // the daemon confirmed, so a refused play (e.g. an unresolved Liked Songs
  // context) left the previous queue's cards on screen — and the caller
  // swallowed the rejection without user feedback. A failed play is toasted
  // by the App's onPlayFromMenu; the no-op catch here is deliberate. A
  // handler that returns nothing (no real play request in flight) keeps the
  // old immediate switch.
  const playAndSwitchToNowPlaying = (uri: string, offset?: PlayOffset) => {
    // forward the offset only when present — a bare onPlay(uri) must stay a
    // single-argument call for callers that inspect the arguments
    const p = offset === undefined ? onPlay?.(uri) : onPlay?.(uri, offset)
    if (p instanceof Promise) {
      void p.then(() => setActiveCategoryId('now-playing')).catch(() => {})
    } else {
      setActiveCategoryId('now-playing')
    }
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
      // issue #56: same play-then-settle handling as the other paths; the pane
      // is already 'now-playing' here, so the switch inside the helper is a
      // no-op that also keeps the floating-promise check happy
      const contextUri = nowPlaying?.context_uri ?? ''
      if (contextUri && !contextUri.startsWith('spotify:track:')) {
        playAndSwitchToNowPlaying(contextUri, {
          position: card.queuePosition ?? index,
          uri: card.uri,
        })
      } else {
        playAndSwitchToNowPlaying(card.uri)
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
      // issue #56: no optimistic pre-switch — the pane follows a successful play
      playAndSwitchToNowPlaying(openTracklist.contextUri, offset)
      return
    }
    if (card.kind === 'media' && card.uri) {
      // start playback and land directly on the 'Läuft gerade' pane — issue
      // #56: only once the play request succeeded (same gating as the track
      // sub-menu above)
      playAndSwitchToNowPlaying(card.uri)
    } else if (card.kind === 'action' && card.actionId?.startsWith('ha-act:')) {
      // ticket 9.3: per-entity action — the action id carries the entity id.
      // Keep focus inside the carousel — no view transition.
      // bug53: a single press (dial press or tap) ACTUATES every entity —
      // dimmable lights included (the bug46 "press opens the dim popup"
      // shortcut is gone: that popup cannot express "off"). The dim/color
      // view now opens on a HOLD only (handleCardHold / onHoldContent)
      const entityId = card.actionId.slice('ha-act:'.length)
      const view = selectedEntities.find((e) => e.entityId === entityId)
      if (view) view.actuate()
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
    } else if (card.id === 'set-pi') {
      // epic10 task 4: the Raspberry Pi provisioning/connection view
      onOpenPiServer?.()
    } else if (card.id === 'set-ha') {
      // ticket 9.4: the Home Assistant connection settings view
      onOpenHaSettings?.()
    } else if (card.id === 'set-home') {
      // ticket 9.5: the home entity picker (selection + carousel order)
      onOpenEntityPicker?.()
    } else if (card.id === 'set-default-device') {
      onOpenDefaultDevice?.()
    } else if (card.id === 'set-brightness') {
      // bug35: dial press / click on the brightness row toggles auto brightness
      // (like the sun chip) — no adjust mode; while auto is OFF the wheel on
      // the focused row adjusts the level directly (handleWheelContent)
      updateSettings({ autoBrightness: !settings.autoBrightness })
    } else if (card.id === 'set-sidebar-bg') {
      // bug54 v2 / bug58: cycle the menu background
      // (Schwarz → Halbdurchsichtig → Durchsichtig → Unschärfe → Schwarz)
      updateSettings({
        sidebarBackground:
          settings.sidebarBackground === 'solid'
            ? 'translucent'
            : settings.sidebarBackground === 'translucent'
              ? 'clear'
              : settings.sidebarBackground === 'clear'
                ? 'blur'
                : 'solid',
      })
    } else if (card.id === 'set-auto-collapse') {
      // ticket 8.1: toggle the auto-collapse behavior (Off ↔ On)
      updateSettings({
        autoCollapseSidebar: settings.autoCollapseSidebar === 'on' ? 'off' : 'on',
      })
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

  // bug53: the hold twin of handleCardAction — a HELD press (dial ≥
  // CARD_HOLD_MS or touch hold) on a dimmable light card opens the
  // brightness / color-temperature control view; every other card behaves
  // exactly like a press. The routing reads live values through a ref: the
  // carousel cards are memoized (bug8.2) and keep the FIRST onCardHold
  // closure they receive, so the callback identity must be stable (same
  // latest-callback pattern as the focus hook's internal refs and the
  // focusRef below — the render-body ref write is intentional, the
  // react-hooks/refs finding is the accepted false positive for this
  // established pattern, see the eslint-disable below)
  const cardHoldRoutingRef = useRef<(card: MenuCard, index: number) => void>(() => {})
  // eslint-disable-next-line react-hooks/refs
  cardHoldRoutingRef.current = (card: MenuCard, index: number) => {
    if (card.kind === 'action' && card.actionId?.startsWith('ha-act:')) {
      const entityId = card.actionId.slice('ha-act:'.length)
      const view = selectedEntities.find((e) => e.entityId === entityId)
      if (view && view.domain === 'light' && view.dimmable) {
        onOpenLightControl?.(view.entityId, view.label)
        return
      }
    }
    handleCardAction(card, index)
  }
  const handleCardHold = useCallback((card: MenuCard, index: number) => {
    cardHoldRoutingRef.current(card, index)
  }, [])

  // issue #57 T1: touch-scroll focus reset for the Home dashboard. View-local
  // flag, not hook state — the hook's contentIndex is a plain [0, count) index
  // with no "nothing" representation, so hiding the focused slot is done by
  // gating the focusedIndex PROP of <HomeDashboardView>. A real finger scroll
  // (HomeDashboardView's onTouchScroll) sets it; any dial tick on Home or a
  // fresh slot tap clears it (the restore paths below).
  const [homeTouchFocusCleared, setHomeTouchFocusCleared] = useState(false)

  // bug25: adjust mode — the wheel changes the value of the adjusting row
  // instead of moving the focus; turning past the min/max boundary leaves
  // adjust mode and the focus moves on with the same tick. bug35: the
  // brightness row adjusts directly on the wheel while focused (no explicit
  // adjust mode); while auto brightness is ON (slider disabled) or at the
  // min/max bound the tick falls through to plain row navigation
  const handleWheelContent = (dir: 1 | -1): boolean => {
    // issue #57 T1: a dial tick on Home restores any touch-cleared focus —
    // the tick itself navigates as usual (return false), and with the flag
    // reset the next focused slot renders its .focused state again
    if (confirmedCategory.id === 'home') {
      setHomeTouchFocusCleared(false)
      return false
    }
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
    // ticket 9.6 (Task C): the Home dial traverses ALL dashboard grid slots
    // (scenes → lights → cover columns, placeholders are focus stops too);
    // every other category keeps the carousel card count
    contentCount:
      confirmedCategory.id === 'home'
        ? homeDashboard.sceneRow.length +
          homeDashboard.lightGrid.length +
          homeDashboard.coverSection.columns.length
        : confirmedCategory.cards.length,
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
        // issue #57 T1: (re)entering Home starts with a fresh dial focus — a
        // touch-scroll reset from an earlier visit must not carry over
        if (category.id === 'home') setHomeTouchFocusCleared(false)
      }
    },
    onConfirmContent: (index) => {
      // only ever runs in the content pane, where displayed == confirmed
      if (confirmedCategory.id === 'home') {
        // ticket 9.6 W2: dial confirm on a dashboard grid slot — scenes and
        // lights actuate exactly like a tap (same homeSceneTap/homeLightTap
        // callbacks); a cover column is an EXPLICIT up/down control, so a
        // plain dial confirm on it is deliberately a no-op
        if (index < homeDashboard.sceneRow.length) {
          homeSceneTap(homeDashboard.sceneRow[index])
        } else if (index < homeDashboard.sceneRow.length + homeDashboard.lightGrid.length) {
          homeLightTap(homeDashboard.lightGrid[index - homeDashboard.sceneRow.length])
        }
        // index ≥ scenes + lights → cover column: no-op (up/down buttons only)
        return
      }
      const card = confirmedCategory.cards[index]
      if (card) handleCardAction(card, index)
    },
    // bug53: dial HOLD on a card — same routing as the press path, plus the
    // dimmable-light → dim view shortcut (handleCardHold covers it)
    onHoldContent: (index) => {
      // ticket 9.6 W2-3: dial HOLD on a Home dashboard grid slot routes
      // through the SAME shared helper as the touch hold (homeHoldRoute):
      // scene slots no-op, light slots open the control view, cover columns
      // stop (slot offsets: scenes[0..s) → lights → cover columns)
      if (confirmedCategory.id === 'home') {
        homeHoldSlot(index)
        return
      }
      const card = confirmedCategory.cards[index]
      if (card) handleCardHold(card, index)
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
  }, [openTracklist, focus.activePane, focus.contentIndex, trackItems.length, loadTrackPage])

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
      ? (categories[focus.sidebarIndex] ?? confirmedCategory)
      : confirmedCategory

  // ticket 8.1: auto-collapse — the sidebar pane shrinks to its icon-only
  // state while the setting is on AND the dial focus has left the sidebar
  // (selecting any item moves focus to the content pane; back restores it)
  const sidebarCollapsed = settings.autoCollapseSidebar === 'on' && focus.activePane !== 'sidebar'

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
  // full. epic10 task 2: the remoteBlur flag is part of the band identity —
  // a mode flip (Pi connected / gone) re-warms the band with the other url
  // flavor (Pi pre-processed artwork vs. direct CDN url). Lives in a ref:
  // the diff is state without rendering consequences.
  const lastWarmBandRef = useRef<
    Map<string, { start: number; end: number; category: MenuCategory; remote: boolean }>
  >(new Map())

  // epic10 task 2: the artwork loader adapter — cards load the Pi's
  // pre-processed 160x160 artwork when remoteBlur is on, the direct
  // (Spotify CDN) url otherwise (standalone, unchanged)
  const remoteBlur = miraServer.features.remoteBlur

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
  // issue50 F1: on top of that the band is COMPLETION-AWARE and MOUNTED-
  // WINDOW-AWARE — warmedArt only counts settled (loaded) covers as warmed,
  // caps in-flight fetches at MAX_WARM_INFLIGHT with a FIFO queue, retries
  // failures once, and this effect skips the indices the mounted carousel
  // window ± SCROLL_SAFE_MARGIN already fetches via its own <img>s.
  // issue50 F4-A: the skip is restricted to fully-mounted short lists — for
  // long (windowed) queues the band warms the FULL band again, so visible
  // off-center cards get pre-decoded covers instead of relying on the
  // unsynchronized per-card <img> burst (the round-2 "dead zone" fix).
  useEffect(() => {
    // issue50 F1: for a fully-mounted (short) list the band only warms
    // OUTSIDE the mounted window — inside [start - SCROLL_SAFE_MARGIN,
    // end + SCROLL_SAFE_MARGIN) of what the carousel mounts (pure math, same
    // windowRange() slice with scroll = null), the mounted cards' own <img>
    // is the authoritative fetch and warming the same urls again would only
    // duplicate work. The pure-math window under-covers the scroll-widened
    // one on very wide viewports; the few overlaps it leaves are exactly the
    // pre-F1 behavior. Only the displayed category mounts a carousel — every
    // other category's cards are mounted nowhere, so its band is never
    // skipped (the sidebar-preview swap still pays no fetch, bug8.2).
    // issue50 F4-A: on a long (windowed) list this skip is DROPPED (null):
    // the unsynchronized burst of per-card <img> requests of the freshly
    // mounted window is what leaves visible off-center cards on permanent
    // placeholders, so the band warms the FULL PREDECODE_RADIUS band again —
    // pre-F1 coverage restored. Memory-safe: only WHICH indices are warmed
    // changes (urls stay band-bounded), and warmedArt keeps its
    // MAX_WARM_INFLIGHT cap + completion tracking for either case.
    const mountedSkip = (count: number, focusIndex: number) => {
      const mounted = windowRange(count, focusIndex, null)
      return {
        start: Math.max(0, mounted.start - SCROLL_SAFE_MARGIN),
        end: Math.min(count, mounted.end + SCROLL_SAFE_MARGIN),
      }
    }
    const warmRange = (
      category: MenuCategory,
      from: number,
      to: number,
      skip: { start: number; end: number } | null,
    ) => {
      for (let i = from; i < to; i++) {
        if (skip && i >= skip.start && i < skip.end) continue
        const art = category.cards[i].art
        if (!art) continue
        // epic10 task 2: warm the url the cards actually load (ArtImage)
        const url = remoteBlur ? remoteArtUrl(art) : art
        // issue50 F1: completion-aware — warmedArt tracks pending/done/failed,
        // caps in-flight fetches at MAX_WARM_INFLIGHT with a FIFO queue, and
        // retries failures once; the Image + listeners live inside the module
        warmArt(url)
      }
    }
    const lastBand = lastWarmBandRef.current
    for (const category of categories) {
      const isDisplayed = category === displayedCategory
      const focusIndex = isDisplayed && focus.activePane === 'content' ? focus.contentIndex : 0
      const bandStart = Math.max(0, focusIndex - PREDECODE_RADIUS)
      const bandEnd = Math.min(category.cards.length, focusIndex + 1 + PREDECODE_RADIUS)
      // issue50 F4-A: the mounted-window skip applies ONLY while the whole
      // list is mounted (count < NO_WINDOW_THRESHOLD — windowRange returns
      // [0, count), so every card already fetches its own <img>). For a long
      // queue the band warms the full band: pass null, no skip.
      const skip =
        isDisplayed && category.cards.length < NO_WINDOW_THRESHOLD
          ? mountedSkip(category.cards.length, focusIndex)
          : null
      const prev = lastBand.get(category.id)
      if (prev && prev.category === category && prev.remote === remoteBlur) {
        // same card list and same url flavor: warm only what the band gained
        // since the last run (a dial tick gained one edge card; a
        // back-and-forth slide gains nothing, because the dropped edge was
        // already warmed or is still inside the mounted-window skip)
        if (bandStart < prev.start)
          warmRange(category, bandStart, Math.min(bandEnd, prev.start), skip)
        if (bandEnd > prev.end) warmRange(category, Math.max(bandStart, prev.end), bandEnd, skip)
      } else {
        // first sighting, rebuilt card list, or a remoteBlur flip: warm the
        // full band — warmArt de-dupes urls already done, pending, queued, or
        // retrying
        warmRange(category, bandStart, bandEnd, skip)
      }
      lastBand.set(category.id, { start: bandStart, end: bandEnd, category, remote: remoteBlur })
    }
  }, [categories, displayedCategory, focus.activePane, focus.contentIndex, remoteBlur])

  const freshMenuStyle = {
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

  // bug58: freeze ambient menu-bg/glow vars while dial ticks are in progress
  // — measured 2x FPS on S905D2 (Bug58 A/B, staticBg). While the move kind is
  // 'dial' (contentMoveKind 'dial'), keep the PREVIOUSLY committed --menu-bg /
  // --menu-glow-a/b values instead of rewriting them every tick; once the
  // move kind stops being 'dial' the fresh values flow through and get
  // committed again. Small guard over a ref of the last committed value —
  // the styling computation above is untouched. The ref is read/written in
  // the render body deliberately (accepted pattern here, cf. viewportWidthRef
  // in ContentCarousel.tsx): the value only feeds the style object below and
  // never drives React state, so a concurrent double-invocation would just
  // commit the same freshMenuStyle twice — no render dependency on it.
  const lastCommittedMenuStyleRef = useRef<CSSProperties | null>(null)
  let viewStyle: CSSProperties
  if (
    focus.contentMoveKind === 'dial' &&
    // eslint-disable-next-line react-hooks/refs -- bug58 static-bg freeze, see hunk comment above
    lastCommittedMenuStyleRef.current !== null
  ) {
    // eslint-disable-next-line react-hooks/refs -- bug58 static-bg freeze, see hunk comment above
    viewStyle = lastCommittedMenuStyleRef.current
  } else {
    lastCommittedMenuStyleRef.current = freshMenuStyle
    viewStyle = freshMenuStyle
  }

  useSwipeGestures(viewRef, {
    // right swipe enters the content pane, left swipe returns to the sidebar
    onNext: () => focus.setActivePane('content'),
    onPrev: () => focus.setActivePane('sidebar'),
    onToggleView: () => focus.setActivePane(focus.activePane === 'sidebar' ? 'content' : 'sidebar'),
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
      className={[
        styles.view,
        focus.activePane === 'sidebar' ? styles.sidebarFocus : styles.contentFocus,
        // bug54/bug58: the underflow modifier slides the content under the
        // sidebar (applied in 'blur' mode only — see slidesUnderSidebar)
        slidesUnderSidebar ? styles.viewUnderflow : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={viewStyle}
    >
      {/* bug8/bug24: ambient background — static per category, or driven by
          the focused card's artwork colors */}
      <div className={styles.bg} aria-hidden="true" />
      <aside
        className={[styles.sidebarPane, sidebarCollapsed ? styles.collapsed : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="Menü-Navigation"
      >
        <SidebarNav
          categories={categories}
          activeId={activeCategoryId}
          onSelect={onCategorySelect}
          focusedIndex={focus.activePane === 'sidebar' ? focus.sidebarIndex : undefined}
          background={sidebarNavBackground}
          collapsed={sidebarCollapsed}
        />
      </aside>
      <main className={styles.contentPane} aria-label="Menü-Inhalt">
        {displayedCategory.id === 'settings' ? (
          // bug25: the settings pane is a vertical list; the sidebar preview
          // always shows the root rows, the confirmed pane the open level.
          // bug54/bug58: in underflow mode ('blur' only — see
          // slidesUnderSidebar) the wrapper keeps the list out from under the
          // glass (display:contents otherwise — no layout change)
          <div
            className={
              slidesUnderSidebar
                ? `${styles.settingsWrap} ${
                    sidebarCollapsed ? styles.settingsUnderflowCollapsed : styles.settingsUnderflow
                  }`
                : styles.settingsWrap
            }
          >
            <SettingsList
              rows={settingsRows}
              focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
              adjustingRowId={activeAdjustingRowId}
              onRowTap={(index) => selectFocusedCard(index)}
              onSliderChange={handleSliderChange}
              onToggleAuto={() => updateSettings({ autoBrightness: !settings.autoBrightness })}
            />
          </div>
        ) : displayedCategory.id === 'home' ? (
          // ticket 9.6 (Task C): the Home category renders the dashboard grid
          // instead of the content carousel. bug54/bug58 + issue #24: in
          // underflow mode ('blur' only — see slidesUnderSidebar) the wrapper
          // keeps the grid out from under the glass, mirroring the settings
          // .settingsUnderflow inset (display:contents otherwise — no layout
          // change). ticket 8.1: while the sidebar is auto-collapsed (see
          // sidebarCollapsed above) the collapsed variant tracks the 72px
          // icon-only width instead (same pairing as the carousel's
          // .underflowCollapsed; applied exclusively, so no cascade involved).
          <div
            className={
              slidesUnderSidebar
                ? `${styles.homeWrap} ${
                    sidebarCollapsed ? styles.homeUnderflowCollapsed : styles.homeUnderflow
                  }`
                : styles.homeWrap
            }
          >
            <HomeDashboardView
              entities={selectedEntities}
              // issue #57 T1: the dial focus hides after a touch scroll until a
              // dial tick or slot tap restores it (homeTouchFocusCleared above)
              focusedIndex={
                focus.activePane === 'content' && !homeTouchFocusCleared
                  ? focus.contentIndex
                  : undefined
              }
              // ticket 9.6 W2: short-press wiring (tap + dial confirm)
              onSceneTap={homeSceneTap}
              onLightTap={homeLightTap}
              onCoverAction={homeCoverAction}
              // ticket 9.6 W2-3: touch HOLD — the SAME shared routing as the
              // dial hold (homeHoldRoute), so both input paths stay in lockstep
              onLightHold={(tile) => homeHoldRoute(tile, null)}
              onCoverHold={(column) => homeHoldRoute(null, column)}
              // issue #57 T1: tap → focus re-root — a SHORT tap moves the dial
              // onto the tapped slot WITHOUT confirming (the slot's own tap
              // callback already ran) and restores any cleared focus
              onSlotTapped={(index) => {
                setHomeTouchFocusCleared(false)
                focus.focusContent(index)
              }}
              // issue #57 T1: touch scroll → clear the dial focus until the next
              // dial tick or slot tap (gated into focusedIndex above)
              onTouchScroll={() => setHomeTouchFocusCleared(true)}
            />
          </div>
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
            activeTrackKey={displayedCategory.id === 'now-playing' ? nowPlayingTrackKey : undefined}
            // selectContent confirms the tapped card (runs the card action exactly once)
            onCardTap={handleCardTap}
            // bug53: touch HOLD on a card (≥ CARD_HOLD_MS) — same routing as
            // the dial hold (dimmable light → dim view, everything else press)
            onCardHold={handleCardHold}
            focusedIndex={focus.activePane === 'content' ? focus.contentIndex : undefined}
            // bug58 T4: the BLUR set follows the content index UNCONDITIONALLY
            // (no activePane ternary). While the UI focus sits in the sidebar
            // pane (dialing the menu rows), focusedIndex above is undefined —
            // but the cards under the glass must keep their blur, so the blur
            // state must not depend on the active pane (device report Build
            // #110/#111). focus.contentIndex stays a valid number in both
            // panes (the hook clamps it to [0, contentCount) — it never goes
            // undefined) and stays put during sidebar dialing: a preview
            // switch resets it to 0, which matches the carousel's card-0
            // remount on that categoryId change.
            blurIndex={focus.contentIndex}
            // bug47: dial ticks scroll instantly, taps/confirms/switches keep
            // the smooth scroll (the hook tags the last focus change)
            focusScrollBehavior={focus.contentMoveKind === 'dial' ? 'auto' : 'smooth'}
            // bug54/bug58: in underflow mode ('blur' — see slidesUnderSidebar
            // above) the carousel viewport spans the full screen — the
            // geometry underflow is the sidebar width. The three other
            // background modes ('solid' / 'translucent' / 'clear') pass 0:
            // the solid geometry (cards clipped at the sidebar's right edge).
            // ticket8.1: while the sidebar is auto-collapsed (see
            // sidebarCollapsed above) the underflow shifts by the COLLAPSED
            // glass width instead — the blurred slides pass under the narrow
            // 72px icon-only state, not the full 250px pane.
            underflowPx={
              slidesUnderSidebar ? (sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : SIDEBAR_WIDTH) : 0
            }
            underflowCollapsed={sidebarCollapsed}
          />
        )}
      </main>
    </div>
  )
}
