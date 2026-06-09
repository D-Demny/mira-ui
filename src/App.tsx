import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { AuthScreen } from '@/components/AuthScreen'
import { BootSplash } from '@/components/BootSplash'
import { ConnectionChooser } from '@/components/ConnectionChooser'
import { Controls } from '@/components/Controls'
import { DaemonError } from '@/components/DaemonError'
import { DevicePicker } from '@/components/DevicePicker'
import { IdleScreen } from '@/components/IdleScreen'
import { Lyrics } from '@/components/Lyrics'
import { Menu } from '@/components/Menu'
import { NeedsNetwork } from '@/components/NeedsNetwork'
import { NoLyricsView } from '@/components/NoLyricsView'
import { PairingDialog } from '@/components/PairingDialog'
import { PcConnect } from '@/components/PcConnect'
import { PowerMenu } from '@/components/PowerMenu'
import { ProgressBar } from '@/components/ProgressBar'
import { TrackInfo } from '@/components/TrackInfo'
import { VolumeOverlay } from '@/components/VolumeOverlay'
import { useDevScreen } from '@/dev/devContext'
import { makeMockStatus } from '@/dev/mockStatus'
import { useAuth } from '@/hooks/useAuth'
import { useBluetooth } from '@/hooks/useBluetooth'
import { useConnectDevices } from '@/hooks/useConnectDevices'
import { suspendDevice } from '@/api/system'
import { useControls } from '@/hooks/useControls'
// Disabled for now needs more testing
// import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { useNotify } from '@/notify/notifyContext'
import { useObserver } from '@/hooks/useObserver'
import { usePlayerControls } from '@/hooks/usePlayerControls'
import { usePrefetch } from '@/hooks/usePrefetch'
import { transferToDevice } from '@/api/client'
import type { ConnectDevice, ObserverStatusActive } from '@/api/types'
import { loadShowLyrics, saveShowLyrics } from '@/viewPref'
import styles from './App.module.scss'

export default function App() {
  const auth = useAuth()
  // TODO: currently broken so set to false
  const daemonDown = false
  const { status: realStatus, loading, connected } = useObserver()
  const notify = useNotify()
  const { play, pause, next, prev, seek, playContext, setVolume, setShuffle, setRepeat } =
    useControls()
  const handleSeek = useCallback(
    (positionMs: number) => {
      void seek(positionMs).catch(() => notify('Seek failed', { variant: 'error' }))
    },
    [notify, seek],
  )
  usePrefetch(realStatus)
  const { online, pairing: realPairing, lastDevice, setDiscoverable } = useBluetooth()
  const connectDevices = useConnectDevices()
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)

  // notification for the playback device changes
  const prevDeviceRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (realStatus == null) return
    const curId = realStatus.active ? realStatus.device_id : ''
    const prev = prevDeviceRef.current
    if (prev !== undefined && prev !== curId) {
      if (realStatus.active) {
        notify(`Now playing on ${realStatus.device_name}`, { variant: 'info' })
      } else {
        notify('Nothing is playing. Pick a device or start Spotify', { variant: 'info' })
      }
    }
    prevDeviceRef.current = curId
  }, [realStatus, notify])

  const onPickDevice = useCallback(
    (d: ConnectDevice) => {
      setDeviceMenuOpen(false)
      notify(`Switching to ${d.name}…`, { variant: 'info' })
      void transferToDevice(d.id).catch((err) => {
        console.warn('transfer failed', err)
        notify(`Couldn't switch to ${d.name}`, { variant: 'error' })
      })
    },
    [notify],
  )

  const [showLyricsReal, setShowLyrics] = useState(loadShowLyrics)
  const [menuOpenReal, setMenuOpen] = useState(false)
  const [powerMenuOpenReal, setPowerMenuOpen] = useState(false)
  const [offlineMethod, setOfflineMethod] = useState<'chooser' | 'bluetooth' | 'pc'>('chooser')

  // Cold-boot rescue: fall through from BootSplash to NeedsNetwork after
  // BOOT_STUCK_MS without an online signal, so the user gets actionable
  // instructions instead of staring at a splash forever.
  const BOOT_STUCK_MS = 12000
  const [bootStuck, setBootStuck] = useState(false)
  useEffect(() => {
    setBootStuck(false)
    const t = window.setTimeout(() => setBootStuck(true), BOOT_STUCK_MS)
    return () => window.clearTimeout(t)
  }, [])

  // if something goes wrong change the text to try restarting
  // TODO: maybe not needed at this point since some further changes while developing the bluetooth flow showed this was not an issue as i thought
  const LOAD_STUCK_MS = 30000
  const [loadStuck, setLoadStuck] = useState(false)
  useEffect(() => {
    setLoadStuck(false)
    const t = window.setTimeout(() => setLoadStuck(true), LOAD_STUCK_MS)
    return () => window.clearTimeout(t)
  }, [])

  const { forced, setForced } = useDevScreen()

  const mockStatus = useMemo<ObserverStatusActive>(() => makeMockStatus(), [])

  const status =
    forced === 'playing-lyrics' ||
    forced === 'playing-no-lyrics' ||
    forced === 'pairing' ||
    forced === 'menu' ||
    forced === 'power-menu'
      ? mockStatus
      : realStatus

  const isPodcast = status?.active === true && status.track_uri.startsWith('spotify:episode:')

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
  const menuOpen = forced === 'menu' ? true : menuOpenReal
  const powerMenuOpen = forced === 'power-menu' ? true : powerMenuOpenReal
  const pairing =
    forced === 'pairing' ? { address: 'AB:CD:EF:01:23:45', passkey: '123456' } : realPairing

  // offline setup flow
  const knownOffline = online === false && status?.active !== true
  const stuckOffline = bootStuck && online !== true && status?.active !== true
  const onOfflineSetup = !forced && (knownOffline || stuckOffline)

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    if (forced === 'menu') setForced('playing-lyrics')
  }, [forced, setForced])

  const closePowerMenu = useCallback(() => {
    setPowerMenuOpen(false)
    if (forced === 'power-menu') setForced('playing-lyrics')
  }, [forced, setForced])

  const onSleep = useCallback(() => {
    closePowerMenu()
    void suspendDevice().catch(() => {})
  }, [closePowerMenu])

  // hardware back button
  const goBack = useCallback(() => {
    if (deviceMenuOpen) {
      setDeviceMenuOpen(false)
      return
    }
    if (powerMenuOpen) {
      closePowerMenu()
      return
    }
    if (menuOpen) {
      closeMenu()
      return
    }
    if (onOfflineSetup && offlineMethod !== 'chooser') {
      setOfflineMethod('chooser')
      return
    }
    // nothing to go back to
  }, [
    deviceMenuOpen,
    powerMenuOpen,
    closePowerMenu,
    menuOpen,
    closeMenu,
    onOfflineSetup,
    offlineMethod,
  ])

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

  const hardware = useHardwareButtons({
    status: status && status.active ? status : null,
    onPlayPause: controls.onPlayPause,
    setVolume,
    playContext,
    onBack: goBack,
    onTogglePowerMenu: () => setPowerMenuOpen((v) => !v),
    onSleep,
    notify,
  })

  const globalOverlays = (
    <>
      {pairing ? <PairingDialog passkey={pairing.passkey} address={pairing.address} /> : null}
      {daemonDown || forced === 'daemon-error' ? <DaemonError /> : null}
      <VolumeOverlay state={hardware.volumeOverlay} />
      <PowerMenu open={powerMenuOpen} onClose={closePowerMenu} />
      {deviceMenuOpen ? (
        <DevicePicker
          devices={connectDevices}
          onSelect={onPickDevice}
          placement="modal"
          onClose={() => setDeviceMenuOpen(false)}
        />
      ) : null}
    </>
  )

  const onNeedsNetworkMount = useCallback(() => {
    void lastDevice
    setDiscoverable(true).catch((err) => {
      console.warn('setDiscoverable failed (will retry):', err)
    })
  }, [lastDevice, setDiscoverable])

  if (forced === 'connection-chooser') {
    return (
      <div className={styles.app}>
        <ConnectionChooser
          onPickPc={() => setForced('pc-connect')}
          onPickBluetooth={() => setForced('needs-network')}
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
  if (forced === 'needs-network') {
    return (
      <div className={styles.app}>
        <NeedsNetwork onMount={onNeedsNetworkMount} />
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
  if (forced === 'boot-splash') {
    return (
      <div className={styles.app}>
        <BootSplash />
        {globalOverlays}
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
  if (forced === 'idle') {
    return (
      <div className={styles.app}>
        <IdleScreen connected={connected} devices={connectDevices} onSelectDevice={onPickDevice} />
        {globalOverlays}
      </div>
    )
  }

  if (!forced) {
    if (knownOffline || stuckOffline) {
      return (
        <div className={styles.app}>
          {offlineMethod === 'chooser' && (
            <ConnectionChooser
              onPickPc={() => setOfflineMethod('pc')}
              onPickBluetooth={() => setOfflineMethod('bluetooth')}
            />
          )}
          {offlineMethod === 'pc' && <PcConnect />}
          {offlineMethod === 'bluetooth' && <NeedsNetwork onMount={onNeedsNetworkMount} />}
          {globalOverlays}
        </div>
      )
    }

    if (auth.required && auth.url) {
      return (
        <>
          <AuthScreen url={auth.url} />
          {globalOverlays}
        </>
      )
    }

    // used to hide the starting up screen on first boot after a sucessful bluetooth pairing with pan
    // TODO: cleant this up so the qr code isnt shown on every boot
    if (online === true && auth.loading && !auth.url && (!status || !status.active)) {
      const preAuthHint = loadStuck
        ? 'Still fetching from Spotify if this persists, try unplugging and replugging.'
        : undefined
      return (
        <>
          <AuthScreen hint={preAuthHint} />
          {globalOverlays}
        </>
      )
    }

    if ((loading && !status) || (auth.loading && (!status || !status.active))) {
      const stuckHint =
        loadStuck && online === true && !auth.url
          ? 'Still connecting to Spotify if this persists for another minute, try unplugging and replugging.'
          : undefined
      return (
        <div className={styles.app}>
          <BootSplash caption="starting up" hint={stuckHint} />
          {globalOverlays}
        </div>
      )
    }

    if (!status || !status.active) {
      return (
        <div className={styles.app}>
          <IdleScreen
            connected={connected}
            devices={connectDevices}
            onSelectDevice={onPickDevice}
          />
          {globalOverlays}
        </div>
      )
    }
  }

  if (!status || !status.active) return null

  return (
    <div className={`${styles.app} ${styles.appPlaying}`}>
      {showLyrics ? (
        <div className={styles.top} key="lyrics">
          <div className={`${styles.left} ${controls.transitioning ? styles.transitioning : ''}`}>
            <AlbumArt src={status.track_image} size={200} />
            <TrackInfo trackName={status.track_name} artist={status.track_artist} />
          </div>
          <div className={styles.right}>
            <Lyrics status={status} onSeek={handleSeek} />
          </div>
        </div>
      ) : (
        <div
          className={`${styles.topNoLyrics} ${controls.transitioning ? styles.transitioning : ''}`}
          key="no-lyrics"
        >
          <NoLyricsView status={status} />
        </div>
      )}

      <div className={styles.bottom}>
        <ProgressBar status={status} onSeek={handleSeek} />
        <Controls
          isPaused={controls.isPaused}
          shuffle={controls.shuffle}
          repeat={controls.repeat}
          disallowPrev={status.disallow_prev}
          disallowNext={status.disallow_next}
          isPodcast={isPodcast}
          onPrev={controls.onPrev}
          onNext={controls.onNext}
          onPlayPause={controls.onPlayPause}
          onToggleShuffle={controls.onToggleShuffle}
          onCycleRepeat={controls.onCycleRepeat}
          onRewind15={() => seekRelative(-15000)}
          onForward15={() => seekRelative(15000)}
          onMore={() => setMenuOpen(true)}
        />
      </div>

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        showLyrics={showLyrics}
        onToggleLyrics={() =>
          setShowLyrics((v) => {
            const next = !v
            saveShowLyrics(next)
            return next
          })
        }
        currentDevice={status.device_name}
        onOpenDevices={() => {
          setMenuOpen(false)
          setDeviceMenuOpen(true)
        }}
      />

      {globalOverlays}
    </div>
  )
}
