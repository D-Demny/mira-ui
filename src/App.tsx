import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { AuthScreen } from '@/components/AuthScreen'
import { BootSplash } from '@/components/BootSplash'
import { ConnectionChooser, TetheringWizard } from '@/components/ConnectionChooser'
import { Controls } from '@/components/Controls'
import { HomeMenuView } from '@/components/HomeMenuView'
import { IdleScreen } from '@/components/IdleScreen'
import { LibraryView } from '@/components/LibraryView'
import { Lyrics } from '@/components/Lyrics'
import { MainMenuView } from '@/components/MainMenuView'
import { Menu } from '@/components/Menu'
import { NeedsNetwork } from '@/components/NeedsNetwork'
import { NoLyricsView } from '@/components/NoLyricsView'
import { ReportDialog } from '@/components/ReportDialog'
import { PcConnect } from '@/components/PcConnect'
import { PlaylistsView } from '@/components/PlaylistsView'
import { ProgressBar } from '@/components/ProgressBar'
import { ReconnectBanner, type ReconnectReason } from '@/components/ReconnectBanner'
import { ReconnectingScreen } from '@/components/ReconnectingScreen'
import { Screensaver } from '@/components/Screensaver'
import { TrackInfo } from '@/components/TrackInfo'
import { HALightControlModal } from '@/components/MainMenuView/HALightControlModal'
import { HomeEntityPickerModal } from '@/components/MainMenuView/HomeEntityPickerModal'
import { DefaultDeviceModal } from '@/components/SettingsSheet/DefaultDeviceModal'
import { HaSettingsModal } from '@/components/SettingsSheet/HaSettingsModal'
import { PiKeyboardOverlay, type PiKeyboardField } from '@/components/SettingsSheet/PiKeyboardOverlay'
import { PiServerModal } from '@/components/SettingsSheet/PiServerModal'
import { DebugScreen } from '@/components/DebugScreen'
import { resolveRoute } from '@/app/routes'
import { useDevScreen } from '@/dev/devContext'
import { makeMockStatus } from '@/dev/mockStatus'
import { useAuth } from '@/hooks/useAuth'
import { useConnectDevices } from '@/hooks/useConnectDevices'
import { useConnectivity } from '@/hooks/useConnectivity'
import { useControls } from '@/hooks/useControls'
import { useDelayedFlag } from '@/hooks/useDelayedFlag'
import { useDiscoverableWhilePairing } from '@/hooks/useDiscoverableWhilePairing'
import { useDeviceSwitch } from '@/hooks/useDeviceSwitch'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { useIdleScreensaver } from '@/hooks/useIdleScreensaver'
import { useLastArtUrl } from '@/hooks/useLastArtUrl'
import { useLyrics } from '@/hooks/useLyrics'
import { useNotify } from '@/notify/notifyContext'
import { useObserver } from '@/hooks/useObserver'
import { useOfflineScreen } from '@/hooks/useOfflineScreen'
import { useOverlays, type OverlayId } from '@/hooks/useOverlays'
import { OverlayContext, useOverlayState } from '@/overlays/overlayContext'
import { OverlayHost } from '@/overlays/OverlayHost'
import { AuthPage } from '@/pages/Auth/AuthPage'
import { BootPage } from '@/pages/Boot/BootPage'
import { OfflinePage } from '@/pages/Offline/OfflinePage'
import { usePlayerControls } from '@/hooks/usePlayerControls'
import { usePrefetch } from '@/hooks/usePrefetch'
import { resolveDropReason, useHeldStatus } from '@/hooks/useReconnect'
import { useSavedTrack } from '@/hooks/useSavedTrack'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import { useUtcOffset } from '@/hooks/useUtcOffset'
import { useNavigation } from '@/navigation/navigationContext'
import { resumeLastDevice } from '@/api/client'
import type { ObserverStatusActive, PlayOffset } from '@/api/types'
import { getSettings, initSettings, updateSettings, useSettings } from '@/settings'
import { artSizeFor, heroArtSizeFor, registerUiScaleTarget, usePlayerViewport } from '@/uiScale'
import styles from './App.module.scss'

/**
 * Owns the overlay stack so every screen below can reach it, and nothing else.
 * The dev-screen override lives here because it is what `useOverlays` needs to
 * treat a forced menu as open.
 */
export default function App() {
  const { forced, setForced } = useDevScreen()

  // a forced screen shows its overlay without touching the real state
  const forcedOpen = useMemo(
    () => ({
      menu: forced === 'menu' || undefined,
      powerMenu: forced === 'power-menu' || undefined,
      btMenu: forced === 'bluetooth-menu' || undefined,
      settings: forced === 'settings' || undefined,
    }),
    [forced],
  )
  // closing a forced menu has to drop the override too, or it springs back
  const onOverlayClosed = useCallback(
    (id: OverlayId) => {
      if ((id === 'menu' && forced === 'menu') || (id === 'powerMenu' && forced === 'power-menu')) {
        setForced('playing-lyrics')
      }
    },
    [forced, setForced],
  )
  const overlays = useOverlays({ forcedOpen, onClosed: onOverlayClosed })

  return (
    <OverlayContext.Provider value={overlays}>
      <AppContent />
    </OverlayContext.Provider>
  )
}

function AppContent() {
  const auth = useAuth()
  const {
    status: realStatus,
    loading,
    connected,
    setupProgress,
  } = useObserver()
  const notify = useNotify()
  const { forced, setForced } = useDevScreen()
  const overlays = useOverlayState()
  // `overlays` itself is a new object on every open and close; these three are
  // not, so anything that ends up in a dep array is built from them
  const { open: openOverlay, close: closeOverlay, openScreensaver } = overlays

  const { play, pause, next, prev, seek, playContext, setVolume, setShuffle, setRepeat } =
    useControls()
  const handleSeek = useCallback(
    (positionMs: number) => {
      void seek(positionMs).catch(() => notify('Seek failed', { variant: 'error' }))
    },
    [notify, seek],
  )
  usePrefetch(realStatus)
  const {
    online,
    carriers,
    pairing: realPairing,
    trouble: btTrouble,
    setDiscoverable,
    hasKnownDevice,
    btConnectedDevice,
    topKnownDeviceName,
    wasOnline,
  } = useConnectivity()
  const connectDevices = useConnectDevices()

  const closeDeviceMenu = useCallback(() => overlays.close('deviceMenu'), [overlays])
  const onPickDevice = useDeviceSwitch({
    status: realStatus,
    notify,
    onPicked: closeDeviceMenu,
  })

  const settings = useSettings()
  const showLyricsReal = settings.showLyrics
  const artSize = artSizeFor(settings.uiScalePct)
  const heroArtSize = heroArtSizeFor(settings.uiScalePct)
  // bug38: the display size zooms only the now-playing screen — the logical viewport +
  // zoom the player wrapper below renders (and registers as the scale target)
  const playerViewport = usePlayerViewport()
  const stageRef = useRef<HTMLDivElement | null>(null)

  // fork app-level panels for the library / main menu (rendered by globalOverlays)
  const [defaultDeviceModalOpen, setDefaultDeviceModalOpen] = useState(false)
  // epic10 task 4: the Raspberry Pi provisioning/connection view
  const [piServerModalOpen, setPiServerModalOpen] = useState(false)
  // ticket 9.4: the Home Assistant connection settings view (its on-screen
  // keyboard is rendered inside the modal's own backdrop — no App-level
  // keyboard state)
  const [haSettingsOpen, setHaSettingsOpen] = useState(false)
  // ticket10-2: the on-screen keyboard for the Pi credential fields (null = closed)
  const [piKeyboardField, setPiKeyboardField] = useState<PiKeyboardField | null>(null)
  // bug46: the dimmable HA light control popup (entity + label while open)
  const [lightControl, setLightControl] = useState<{ entityId: string; label: string } | null>(null)
  // ticket 9.3: the home carousel entity picker overlay
  const [entityPickerOpen, setEntityPickerOpen] = useState(false)
  // navigation stack for library menu system
  const navigation = useNavigation()
  // library navigation mode (fork route /settings/library): replaces
  // idle/playing until the user exits it or presses back again
  const [showingLibrary, setShowingLibrary] = useState(false)

  const toggleLyrics = useCallback(() => {
    updateSettings({ showLyrics: !getSettings().showLyrics })
  }, [])

  const toggleKaraoke = useCallback(() => {
    updateSettings({ karaokeLyrics: !getSettings().karaokeLyrics })
  }, [])

  const toggleVoiceMic = useCallback(() => {
    updateSettings({ voiceMic: !getSettings().voiceMic })
  }, [])

  // get settings from the daemon
  useEffect(() => {
    void initSettings()
  }, [])

  // Cold-boot rescue: fall through from BootSplash to NeedsNetwork after
  // BOOT_STUCK_MS without an online signal, so the user gets actionable
  // instructions instead of staring at a splash forever.
  const BOOT_STUCK_MS = 12000
  const bootStuck = useDelayedFlag(true, BOOT_STUCK_MS)

  // if something goes wrong change the text to try restarting
  // TODO: maybe not needed at this point since some further changes while developing the bluetooth flow showed this was not an issue as i thought
  const LOAD_STUCK_MS = 30000
  const loadStuck = useDelayedFlag(true, LOAD_STUCK_MS)

  const mockStatus = useMemo<ObserverStatusActive>(() => makeMockStatus(), [])

  const status =
    forced === 'playing-lyrics' ||
    forced === 'playing-no-lyrics' ||
    forced === 'pairing' ||
    forced === 'menu' ||
    forced === 'power-menu' ||
    forced === 'bluetooth-menu' ||
    forced === 'reconnect-banner' ||
    forced === 'settings' ||
    forced === 'library' ||
    forced === 'playlists' ||
    forced === 'home' ||
    forced === 'mainmenu'
      ? mockStatus
      : realStatus

  const SPOTIFY_STUCK_MS = 60000
  const playerStartingUp = status != null && !status.active && status.message === 'starting up'
  const splashOnlineStuck = playerStartingUp && online === true && !auth.url
  const spotifyStuck = useDelayedFlag(splashOnlineStuck, SPOTIFY_STUCK_MS)

  // hold the last now-playing through any small drops in network
  const heldStatus = useHeldStatus(realStatus)

  // small drops while the phone is still reachable
  const dropReason = resolveDropReason({
    suppressed: !!forced,
    held: heldStatus,
    status: realStatus,
    online,
    connected,
  })
  const reconnecting = dropReason !== null

  const offline = useOfflineScreen({
    suppressed: !!forced,
    online,
    carriers,
    btConnectedDevice,
    hasKnownDevice,
    wasOnline,
    heldStatus,
    bootStuck,
    reconnecting,
  })
  const offlineScreen = offline.screen

  // seek relative to the live position
  const seekRelative = useCallback(
    (deltaMs: number) => {
      if (!status?.active) return
      const base = status.is_paused
        ? status.position
        : status.position + (Date.now() - status.received_at)
      const target = Math.min(status.duration, Math.max(0, base + deltaMs))
      void seek(target).catch(() => notify('Seek failed', { variant: 'error' }))
    },
    [status, seek, notify],
  )

  const showLyrics = forced === 'playing-no-lyrics' ? false : showLyricsReal
  // live status when active otherwise the last playing — hoisted above every early
  // return so hook order stays stable across screens (useLyrics below is a hook)
  const playerStatus = status && status.active ? status : reconnecting ? heldStatus : null
  // bug52: the split-view vs. standard-layout decision needs the real lyrics state,
  // so the fetch is hoisted from the Lyrics component into its layout owner (App).
  // The Lyrics component renders this state and only fetches on its own when none is
  // passed (single source of truth, no double fetch per track)
  const lyricsState = useLyrics({
    trackId: playerStatus?.track_id || null,
    trackName: playerStatus?.track_name ?? '',
    artist: playerStatus?.track_artist ?? '',
    album: playerStatus?.track_album,
    durationMs: playerStatus?.duration,
    episode: playerStatus ? playerStatus.track_uri.startsWith('spotify:episode:') : false,
    enabled: showLyrics,
    karaoke: settings.karaokeLyrics,
  })
  // bug52: the split lyrics layout only renders when lyrics actually exist. A track
  // without lyrics (404, empty result, fetch error) — or while the fetch is still in
  // flight — falls back to the standard full-width layout, exactly like the layout
  // "Show lyrics" OFF renders
  const hasLyrics =
    lyricsState.error === null && lyricsState.lyrics !== null && lyricsState.lyrics.lines.length > 0
  const renderLyricsLayout = showLyrics && hasLyrics && !lyricsState.loading
  const pairing =
    forced === 'pairing' ? { address: 'AB:CD:EF:01:23:45', passkey: '123456' } : realPairing

  // an overlay owns the screen, or something that is not an overlay does
  const overlayBusy = overlays.busy || !!forced || auth.required || reconnecting || !!pairing

  const openScreensaverAuto = useCallback(() => openScreensaver('auto'), [openScreensaver])
  const closeScreensaver = useCallback(() => closeOverlay('screensaver'), [closeOverlay])

  useIdleScreensaver({
    open: overlays.isOpen('screensaver'),
    openedBy: overlays.screensaverBy,
    busy: overlayBusy,
    consentOpen: false, // fork: no consent overlay (excluded)
    updateCardOpen: false, // fork: no update card (excluded)
    loading,
    status: realStatus,
    onOpen: openScreensaverAuto,
    onClose: closeScreensaver,
  })

  // discoverable while the Bluetooth pairing screen is up
  const pairingScreenShown = forced === 'needs-network' || offlineScreen === 'bluetooth'
  useDiscoverableWhilePairing({
    pairingScreenShown,
    btMenuOpen: overlays.isOpen('btMenu'),
    setDiscoverable,
  })

  const closeMenu = useCallback(() => overlays.close('menu'), [overlays])
  const closePowerMenu = useCallback(() => overlays.close('powerMenu'), [overlays])

  const onOpenScreensaver = useCallback(() => {
    closePowerMenu()
    overlays.openScreensaver('manual')
  }, [closePowerMenu, overlays])

  // remembered across boots: the screensaver needs both on a cold start
  const lastArtUrl = useLastArtUrl(realStatus)
  const utcOffsetMin = useUtcOffset(realStatus)

  // issue #56: a refused/failed play used to die in a silent `.catch(() => {})`
  // while the menu had already optimistically switched panes — old cards on
  // screen, zero feedback. Toast like the preset buttons do, and keep the
  // rejection so the menu can defer its pane switch until success.
  const onPlayFromMenu = useCallback(
    (uri: string, offset?: PlayOffset): Promise<void> => {
      return playContext(uri, offset).catch((error: unknown) => {
        notify("Couldn't start playback", { variant: 'error' })
        throw error
      })
    },
    [playContext, notify],
  )

  const statusActive = status?.active === true

  // hardware back button
  const goBack = useCallback(() => {
    if (overlays.goBack()) return
    if (defaultDeviceModalOpen) {
      setDefaultDeviceModalOpen(false)
      return
    }
    // ticket10-2: the open keyboard is closed FIRST (its own ListFocusContext entry
    // normally already consumes the press; App-level fallback), a second back then
    // closes the Pi menu
    if (piKeyboardField) {
      setPiKeyboardField(null)
      return
    }
    // ticket10-6C: tethering wizard — after its keyboard closed, back returns to the chooser
    if (
      forced === 'tethering-onboarding' ||
      (!forced && offline.method === 'tethering-onboarding')
    ) {
      if (forced === 'tethering-onboarding') setForced('connection-chooser')
      else offline.setMethod('chooser')
      setPiKeyboardField(null)
      return
    }
    if (piServerModalOpen) {
      setPiServerModalOpen(false)
      return
    }
    // ticket 9.4: HA settings modal (App-level fallback)
    if (haSettingsOpen) {
      setHaSettingsOpen(false)
      return
    }
    // library navigation: back from playing → open library
    if (statusActive && !showingLibrary) {
      setShowingLibrary(true)
      navigation.resetStack()
      const targetRoute = navigation.goBackFromPlaying() ?? 'library'
      navigation.setCurrentRoute(targetRoute)
      return
    }
    // library navigation: within library, pop stack or return to playing
    if (showingLibrary) {
      const popped = navigation.popRoute()
      if (popped == null) {
        setShowingLibrary(false)
        return
      }
      return
    }
    if (offline.active && offline.method !== 'chooser') {
      offline.setMethod('chooser')
      return
    }
    // back out of the chooser the reconnecting screen pushed us into
    if (offline.active && offline.setupOverride) {
      offline.setSetupOverride(false)
      return
    }
    // nothing to go back to
  }, [overlays, offline, defaultDeviceModalOpen, piKeyboardField, forced, setForced, piServerModalOpen, haSettingsOpen, statusActive, navigation, showingLibrary])

  const controls = usePlayerControls({
    status: status && status.active ? status : null,
    play,
    pause,
    next,
    prev,
    seek,
    setShuffle,
    setRepeat,
    onCommandError: (message) => notify(message, { variant: 'error' }),
  })

  const savableStatus = status && status.active ? status : reconnecting ? heldStatus : null
  const savableUri =
    savableStatus && !savableStatus.track_uri.startsWith('spotify:episode:')
      ? savableStatus.track_uri
      : null
  const liked = useSavedTrack(savableUri, (message) => notify(message, { variant: 'error' }))

  const onPlayPauseActive = controls.onPlayPause
  const resumeLast = useCallback(() => {
    void resumeLastDevice().catch(() => {
      notify('Nothing to resume. Start playback on a device', { variant: 'info' })
    })
  }, [notify])
  const onHardwarePlayPause = useCallback(() => {
    if (statusActive) onPlayPauseActive()
    else resumeLast()
  }, [statusActive, onPlayPauseActive, resumeLast])

  const openDebug = useCallback(() => openOverlay('debug'), [openOverlay])

  const hardware = useHardwareButtons({
    status: status && status.active ? status : null,
    onPlayPause: onHardwarePlayPause,
    setVolume,
    playContext,
    onBack: goBack,
    onTogglePowerMenu: () => {
      if (overlays.isOpen('screensaver')) {
        overlays.close('screensaver')
        return
      }
      overlays.toggle('powerMenu')
    },
    onScreensaver: onOpenScreensaver,
    onOpenDebug: openDebug,
    notify,
  })

  // touch gestures
  const swipeEnabled =
    status?.active === true &&
    !overlays.isOpen('menu') &&
    !overlays.isOpen('powerMenu') &&
    !overlays.isOpen('deviceMenu') &&
    !overlays.isOpen('btMenu') &&
    !overlays.isOpen('settings') &&
    !pairing
  useSwipeGestures(stageRef, {
    onNext: controls.onNext,
    onPrev: controls.onPrevTrack,
    onToggleView: toggleLyrics,
    enabled: swipeEnabled,
  })

  // ambient screensaver background
  let screensaverArt: string | null = null
  if (overlays.isOpen('screensaver') || forced === 'screensaver') {
    screensaverArt =
      (status?.active === true ? status.track_image : '') || heldStatus?.track_image || lastArtUrl
  }

  const globalOverlays = (
    <>
      <OverlayHost
        volumeOverlay={hardware.volumeOverlay}
        phoneVolume={status !== null && status.active === true && status.volume_disabled === true}
        online={online}
        connectDevices={connectDevices}
        onPickDevice={onPickDevice}
        pairing={pairing}
        screensaverArt={screensaverArt}
        utcOffsetMin={utcOffsetMin}
      />
      {defaultDeviceModalOpen ? (
        <DefaultDeviceModal
          devices={connectDevices}
          currentDefaultId={settings.defaultDeviceId}
          isActiveDevice={status?.active === true}
          onTransfer={() => {
            const target = connectDevices.find((d) => d.is_active) || connectDevices[0]
            if (target) onPickDevice(target)
            return Promise.resolve()
          }}
          onChange={(deviceId) => updateSettings({ defaultDeviceId: deviceId })}
          onClose={() => setDefaultDeviceModalOpen(false)}
        />
      ) : null}
      {piServerModalOpen ? (
        <PiServerModal
          onClose={() => {
            setPiServerModalOpen(false)
            setPiKeyboardField(null)
          }}
          onOpenKeyboard={(field) => setPiKeyboardField(field)}
        />
      ) : null}
      {haSettingsOpen ? <HaSettingsModal onClose={() => setHaSettingsOpen(false)} /> : null}
      {piKeyboardField ? (
        <PiKeyboardOverlay field={piKeyboardField} onClose={() => setPiKeyboardField(null)} />
      ) : null}
      {lightControl ? (
        <HALightControlModal
          entityId={lightControl.entityId}
          label={lightControl.label}
          onClose={() => setLightControl(null)}
        />
      ) : null}
      {entityPickerOpen ? (
        <HomeEntityPickerModal onClose={() => setEntityPickerOpen(false)} />
      ) : null}
    </>
  )

  if (forced === 'connection-chooser') {
    return (
      <div className={styles.app}>
        <ConnectionChooser
          onPickPc={() => setForced('pc-connect')}
          onPickBluetooth={() => setForced('needs-network')}
          onPickUsbTethering={() => setForced('tethering-onboarding')}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'pc-connect') {
    return (
      <div className={styles.app}>
        <PcConnect />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'tethering-onboarding') {
    return (
      <div className={styles.app}>
        <TetheringWizard
          onBack={() => setForced('connection-chooser')}
          onOpenKeyboard={(field) => setPiKeyboardField(field)}
          keyboardField={piKeyboardField}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'needs-network') {
    return (
      <div className={styles.app}>
        <NeedsNetwork />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'starting') {
    return (
      <div className={styles.app}>
        <BootSplash caption="starting up" />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'setting-up') {
    return (
      <div className={styles.app}>
        <BootSplash caption="setting things up" progress={47} />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'boot-splash') {
    return (
      <div className={styles.app}>
        <BootSplash />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'screensaver') {
    return (
      <div className={styles.app}>
        <Screensaver
          artUrl={mockStatus.track_image}
          utcOffsetMin={utcOffsetMin}
          onClose={() => setForced(null)}
        />
      </div>
    )
  }
  if (forced === 'debug') {
    return (
      <div className={styles.app}>
        <DebugScreen open onClose={() => setForced(null)} onReport={overlays.openReport} />
        {overlays.reportId ? (
          <ReportDialog id={overlays.reportId} onDismiss={() => overlays.close('report')} />
        ) : null}
      </div>
    )
  }
  if (forced === 'auth') {
    return (
      <>
        <AuthScreen url="https://accounts.spotify.com/authorize?response_type=code&client_id=dev-mock&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&scope=user-read-private" />
        {globalOverlays}
      </>
    )
  }
  if (forced === 'library') {
    return (
      <div className={styles.app}>
        <LibraryView
          onNavigate={(route) => {
            if (route === 'playlist') {
              setForced('playlists')
            }
          }}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'playlists') {
    return (
      <div className={styles.app}>
        <PlaylistsView
          onNavigate={() => {}}
          onPlay={(uri) => {
            setForced(null)
            void playContext(uri).catch(() => {})
          }}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'home') {
    return (
      <div className={styles.app}>
        {/* ticket 9.5: no picker opener here — the picker is in Einstellungen → Home */}
        <HomeMenuView />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'mainmenu') {
    return (
      <div className={styles.app}>
        <MainMenuView
          // bug46: the dev screen also gets the light control popup
          onOpenLightControl={(entityId, label) => setLightControl({ entityId, label })}
          // ticket 9.5: the dev screen also gets the entity picker (Einstellungen → Home)
          onOpenEntityPicker={() => setEntityPickerOpen(true)}
          // epic10 task 4: the dev screen also gets the Pi settings view
          onOpenPiServer={() => setPiServerModalOpen(true)}
          // ticket 9.4: the dev screen also gets the HA settings view
          onOpenHaSettings={() => setHaSettingsOpen(true)}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'idle') {
    return (
      <div className={styles.app}>
        <IdleScreen
          connected={connected}
          devices={connectDevices}
          onSelectDevice={onPickDevice}
          defaultDeviceId={settings.defaultDeviceId}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'reconnecting') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen
          deviceName="Kaz’s S24"
          carriers={{ usb: false, bt: false }}
          onSetUpOther={() => {}}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'no-internet') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen
          phase="no-internet"
          deviceName="Kaz’s S24"
          carriers={{ usb: false, bt: false }}
          onSetUpOther={() => {}}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'checking') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen phase="checking" />
        {globalOverlays}
      </div>
    )
  }

  if (!forced) {
    const route = resolveRoute({
      offlineScreen,
      auth,
      status,
      setupProgress,
      loading,
      online,
      reconnecting,
      playerStartingUp,
      spotifyStuck,
      splashOnlineStuck,
      loadStuck,
      showingLibrary,
    })

    switch (route.kind) {
      case 'offline':
        if (route.screen === 'tethering-onboarding') {
          // ticket10-6C: the USB-tethering onboarding wizard — unmounts by
          // itself as soon as the internet arrives
          return (
            <div className={styles.app}>
              <TetheringWizard
                onBack={() => offline.setMethod('chooser')}
                onOpenKeyboard={(field) => setPiKeyboardField(field)}
                keyboardField={piKeyboardField}
              />
              {globalOverlays}
            </div>
          )
        }
        return (
          <div className={styles.app}>
            <OfflinePage
              screen={route.screen}
              deviceName={topKnownDeviceName}
              carriers={carriers}
              trouble={btTrouble}
              onSetUpOther={() => offline.setSetupOverride(true)}
              onPickMethod={offline.setMethod}
            />
            {globalOverlays}
          </div>
        )
      case 'auth':
        return (
          <>
            <AuthPage url={route.url} />
            {globalOverlays}
          </>
        )
      case 'spotify-unreachable':
        return (
          <div className={styles.app}>
            <ReconnectingScreen phase="spotify-unreachable" />
            {globalOverlays}
          </div>
        )
      case 'auth-pending':
        return (
          <>
            <AuthPage stuck={route.stuck} />
            {globalOverlays}
          </>
        )
      case 'booting':
        return (
          <div className={styles.app}>
            <BootPage phase="starting" stuck={route.stuck} />
            {globalOverlays}
          </div>
        )
      case 'setting-up':
        return (
          <div className={styles.app}>
            <BootPage phase="setting-up" progress={route.progress} />
            {globalOverlays}
          </div>
        )
      case 'library':
        return (
          <div className={styles.app}>
            <MainMenuView
              onPlay={onPlayFromMenu}
              nowPlaying={status && status.active ? status : null}
              onExit={() => setShowingLibrary(false)}
              // bug25: the settings list's link rows open the App-level panels
              // (rendered by globalOverlays above the menu)
              defaultDevice={
                settings.defaultDeviceId
                  ? connectDevices.find((d) => d.id === settings.defaultDeviceId)?.name
                  : undefined
              }
              phoneVolume={status?.active === true && status.volume_disabled === true}
              onOpenDefaultDevice={() => setDefaultDeviceModalOpen(true)}
              onOpenDevices={() => overlays.open('deviceMenu')}
              onOpenBluetooth={() => overlays.open('btMenu')}
              // bug46: dimmable HA light cards open the control popup
              onOpenLightControl={(entityId, label) => setLightControl({ entityId, label })}
              // ticket 9.5: the Einstellungen → Home row opens the entity picker
              onOpenEntityPicker={() => setEntityPickerOpen(true)}
              // epic10 task 4: the Raspberry Pi row opens the provisioning view
              onOpenPiServer={() => setPiServerModalOpen(true)}
              // ticket 9.4: the Home Assistant row opens the settings view
              onOpenHaSettings={() => setHaSettingsOpen(true)}
            />
            {globalOverlays}
          </div>
        )
      case 'idle':
        return (
          <div className={styles.app}>
            <IdleScreen
              connected={connected}
              devices={connectDevices}
              onSelectDevice={onPickDevice}
              defaultDeviceId={settings.defaultDeviceId}
            />
            {globalOverlays}
          </div>
        )
      case 'player':
        break
    }
  }

  if (!playerStatus || !playerStatus.active) return null
  const isPodcast = playerStatus.track_uri.startsWith('spotify:episode:')

  // noti over the player on a network drops
  const bannerReason: ReconnectReason | null =
    forced === 'reconnect-banner' ? 'offline' : reconnecting ? dropReason : null

  return (
    <>
      {/* bug38: the display size scales this wrapper (the now-playing screen) only — it
          renders the logical viewport + zoom inline and registers itself as the scale
          target; #root and every other view stay a fixed 800x480 at 100% */}
      <div
        className={styles.app}
        ref={registerUiScaleTarget}
        style={
          {
            width: `${playerViewport.w}px`,
            height: `${playerViewport.h}px`,
            zoom: playerViewport.zoom === 1 ? undefined : playerViewport.zoom,
            // the art is the only fixed-height block in the left column and never
            // shrinks, so it has to give way when a larger display size shortens the
            // logical viewport
            '--art-size': `${artSize}px`,
          } as React.CSSProperties
        }
      >
        <div className={styles.appPlaying}>
        {bannerReason ? <ReconnectBanner reason={bannerReason} carriers={carriers} /> : null}
        <div className={styles.stage} ref={stageRef}>
          <div
            className={`${styles.viewLayer} ${renderLyricsLayout ? styles.viewActive : styles.viewInactive}`}
          >
            <div className={styles.top}>
              <div
                className={`${styles.left} ${controls.transitioning ? styles.transitioning : ''}`}
              >
                <AlbumArt src={playerStatus.track_image} size={artSize} />
                <TrackInfo trackName={playerStatus.track_name} artist={playerStatus.track_artist} />
              </div>
              <div className={styles.right}>
                  <Lyrics
                    status={playerStatus}
                    onSeek={handleSeek}
                    active={renderLyricsLayout}
                    lyricsState={lyricsState}
                  />
              </div>
            </div>
          </div>
          <div
            className={`${styles.viewLayer} ${!renderLyricsLayout ? styles.viewActive : styles.viewInactive}`}
          >
            <div
              className={`${styles.topNoLyrics} ${controls.transitioning ? styles.transitioning : ''}`}
            >
              <NoLyricsView status={playerStatus} active={!renderLyricsLayout} artSize={heroArtSize} />
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <ProgressBar status={playerStatus} onSeek={handleSeek} />
          <Controls
            isPaused={controls.isPaused}
            shuffleMode={controls.shuffleMode}
            repeat={controls.repeat}
            disallowPrev={playerStatus.disallow_prev}
            disallowNext={playerStatus.disallow_next}
            isPodcast={isPodcast}
            showSave={!isPodcast}
            saved={liked.saved}
            onToggleSaved={liked.toggle}
            onPrev={controls.onPrev}
            onNext={controls.onNext}
            onPlayPause={controls.onPlayPause}
            onCycleShuffle={controls.onCycleShuffle}
            onCycleRepeat={controls.onCycleRepeat}
            onRewind15={() => seekRelative(-15000)}
            onForward15={() => seekRelative(15000)}
            onMore={() => overlays.open('menu')}
          />
        </div>

        <Menu
          open={overlays.isOpen('menu')}
          onClose={closeMenu}
          showLyrics={showLyrics}
          onToggleLyrics={toggleLyrics}
          karaokeLyrics={settings.karaokeLyrics}
          onToggleKaraoke={toggleKaraoke}
          voiceMic={settings.voiceMic}
          onToggleVoiceMic={toggleVoiceMic}
          currentDevice={playerStatus.device_name}
          onOpenDevices={() => {
            overlays.close('menu')
            overlays.open('deviceMenu')
          }}
          onOpenBluetooth={() => {
            overlays.close('menu')
            overlays.open('btMenu')
          }}
          onOpenSettings={() => {
            overlays.close('menu')
            overlays.open('settings')
          }}
        />

        </div>
      </div>

      {/* the settings sheet and every other overlay stays a fixed 100% (bug38) — it
          renders as a sibling of the zoomed player wrapper, never inside it */}
      {globalOverlays}
    </>
  )
}
