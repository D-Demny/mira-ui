import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { AuthScreen } from '@/components/AuthScreen'
import { BootSplash } from '@/components/BootSplash'
import { ConnectionChooser } from '@/components/ConnectionChooser'
import { Controls } from '@/components/Controls'
import { DaemonError } from '@/components/DaemonError'
import { IdleScreen } from '@/components/IdleScreen'
import { Lyrics } from '@/components/Lyrics'
import { Menu } from '@/components/Menu'
import { NeedsNetwork } from '@/components/NeedsNetwork'
import { NoLyricsView } from '@/components/NoLyricsView'
import { PairingDialog } from '@/components/PairingDialog'
import { PcConnect } from '@/components/PcConnect'
import { ProgressBar } from '@/components/ProgressBar'
import { TrackInfo } from '@/components/TrackInfo'
import { VolumeOverlay } from '@/components/VolumeOverlay'
import { useDevScreen } from '@/dev/devContext'
import { makeMockStatus } from '@/dev/mockStatus'
import { useAuth } from '@/hooks/useAuth'
import { useBluetooth } from '@/hooks/useBluetooth'
import { useControls } from '@/hooks/useControls'
// Disabled for now needs more testing
// import { useDaemonHealth } from '@/hooks/useDaemonHealth'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { useObserver } from '@/hooks/useObserver'
import { usePlayerControls } from '@/hooks/usePlayerControls'
import { usePrefetch } from '@/hooks/usePrefetch'
import type { ObserverStatusActive } from '@/api/types'
import styles from './App.module.scss'

export default function App() {
  const auth = useAuth()
  // TODO: currently broken so set to false
  const daemonDown = false
  const { status: realStatus, loading, connected } = useObserver()
  const { togglePlayPause, next, prev, seek, playContext, setVolume, setShuffle, setRepeat } =
    useControls()
  const handleSeek = useCallback(
    (positionMs: number) => {
      void seek(positionMs)
    },
    [seek],
  )
  usePrefetch(realStatus)
  const { online, pairing: realPairing, lastDevice, setDiscoverable } = useBluetooth()

  const [showLyricsReal, setShowLyrics] = useState(true)
  const [menuOpenReal, setMenuOpen] = useState(false)
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
    forced === 'menu'
      ? mockStatus
      : realStatus

  const showLyrics = forced === 'playing-no-lyrics' ? false : showLyricsReal
  const menuOpen = forced === 'menu' ? true : menuOpenReal
  const pairing =
    forced === 'pairing' ? { address: 'AB:CD:EF:01:23:45', passkey: '123456' } : realPairing

  const controls = usePlayerControls({
    status: status && status.active ? status : null,
    togglePlayPause,
    next,
    prev,
    seek,
    setShuffle,
    setRepeat,
  })

  const hardware = useHardwareButtons({
    status: status && status.active ? status : null,
    onPlayPause: controls.onPlayPause,
    setVolume,
    playContext,
  })

  const globalOverlays = (
    <>
      {pairing ? <PairingDialog passkey={pairing.passkey} address={pairing.address} /> : null}
      {daemonDown || forced === 'daemon-error' ? <DaemonError /> : null}
      <VolumeOverlay state={hardware.volumeOverlay} />
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
        <IdleScreen connected={connected} />
        {globalOverlays}
      </div>
    )
  }

  if (!forced) {
    const knownOffline = online === false && status?.active !== true
    const stuckOffline = bootStuck && online !== true && status?.active !== true

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

    if ((loading && !status) || auth.loading) {
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
            message={status && !status.active ? status.message : undefined}
            connected={connected}
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
          onPrev={controls.onPrev}
          onNext={controls.onNext}
          onPlayPause={controls.onPlayPause}
          onToggleShuffle={controls.onToggleShuffle}
          onCycleRepeat={controls.onCycleRepeat}
          onMore={() => setMenuOpen(true)}
        />
      </div>

      <Menu
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false)
          if (forced === 'menu') setForced('playing-lyrics')
        }}
        showLyrics={showLyrics}
        onToggleLyrics={() => setShowLyrics((v) => !v)}
      />

      {globalOverlays}
    </div>
  )
}
