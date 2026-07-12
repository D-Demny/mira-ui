import { memo, useEffect, useState } from 'react'
import { restartDevice } from '@/api/system'
import { BT_DEVICE_NAME } from '@/brand'
import type { BtTroubleHint, Carriers } from '@/hooks/useBluetooth'
import styles from './ReconnectingScreen.module.scss'

type Phase = 'checking' | 'reconnecting' | 'no-internet' | 'spotify-unreachable'

interface Props {
  // 'checking'    = brief grace while a link is still handshaking
  // 'reconnecting'= a known phone/USB is offline we aree actively retrying
  // 'no-internet' = show the prolonged "lost connection + Restart" view
  // 'spotify-unreachable' = the link is up (pings work) but no answer from spotify
  phase?: Phase
  // the phone we are paging (priority device), if known
  deviceName?: string | null
  // physical links that are up, for cause-aware messaging
  carriers?: Carriers | null
  // hotspot off/phone deleted the pair
  trouble?: BtTroubleHint
  // escape into the connection chooser to set up a different phone/PC
  onSetUpOther?: () => void
}

// how long Reconnecting runs before escalating to "No internet" + Restart
const PROLONGED_MS = 25000

// Offline status view
function ReconnectingScreenImpl({
  phase = 'reconnecting',
  deviceName,
  carriers,
  trouble,
  onSetUpOther,
}: Props) {
  const [timedOut, setTimedOut] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (phase !== 'reconnecting') return
    const t = window.setTimeout(() => setTimedOut(true), PROLONGED_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  const checking = phase === 'checking'
  const prolonged = phase === 'no-internet' || phase === 'spotify-unreachable' || timedOut

  const onRestart = () => {
    if (restarting) return
    setRestarting(true)
    restartDevice().catch(() => setRestarting(false))
  }

  const name = deviceName?.trim() || 'your phone'

  let title: string
  let body: string
  if (trouble === 'bond-lost' && !checking) {
    title = 'Pairing needed'
    body = `${name.charAt(0).toUpperCase() + name.slice(1)} no longer remembers ${BT_DEVICE_NAME}. Forget ${BT_DEVICE_NAME} in your phone's Bluetooth settings, then pair again.`
  } else if (trouble === 'hotspot-off' && !checking) {
    title = 'Turn on hotspot'
    body = `Connected to ${name}, but internet sharing is off. Turn on Personal Hotspot (iPhone) or Bluetooth tethering (Android) and it connects on its own.`
  } else if (checking) {
    title = 'Checking connection...'
    body = 'Finishing the connection, one moment.'
  } else if (phase === 'spotify-unreachable') {
    title = "Can't reach Spotify"
    body = `The connection works, but Spotify isn't responding. Turn internet sharing off and on again on the connected phone or PC, or restart ${BT_DEVICE_NAME}.`
  } else if (prolonged) {
    title = 'No internet'
    body = causeMessage(deviceName, carriers)
  } else {
    title = deviceName ? `Reconnecting to ${name}...` : 'Reconnecting...'
    body = deviceName
      ? `Bring ${name} back in range. ${BT_DEVICE_NAME} reconnects on its own. If it doesn't connect from your device.`
      : `${BT_DEVICE_NAME} is trying to get back online.`
  }

  return (
    <div className={styles.container}>
      <div className={styles.headline}>
        <span className={styles.pulseDot} aria-hidden />
        <span className={styles.title}>{title}</span>
      </div>

      <div className={styles.body}>{body}</div>

      {!checking ? (
        <div className={styles.actions}>
          {prolonged ? (
            <button type="button" className={styles.restartBtn} onClick={onRestart}>
              {restarting ? 'Restarting...' : 'Restart'}
            </button>
          ) : null}
          {onSetUpOther ? (
            <button type="button" className={styles.altBtn} onClick={onSetUpOther}>
              Set up a different connection
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// a more cause aware "why there's no internet" line
function causeMessage(
  deviceName: string | null | undefined,
  carriers: Carriers | null | undefined,
) {
  const phone = deviceName?.trim() || 'your phone'
  if (deviceName) {
    return `Can't reach ${phone}. Make sure it's nearby and Bluetooth tethering is still on.`
  }
  if (carriers?.usb) {
    return "USB is connected but your computer isn't sharing internet."
  }
  return 'Lost the connection, check your phone or USB cable.'
}

export const ReconnectingScreen = memo(ReconnectingScreenImpl)
