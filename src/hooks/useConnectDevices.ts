import { useEffect, useState } from 'react'
import { fetchConnectDevices, fetchMaDevices } from '@/api/client'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, ConnectDevice, MaDevice } from '@/api/types'

// issue #138: delay before re-asking the daemon for MA players after a
// failed fetch (the daemon 503s until the player session is up, which can
// take minutes right after boot/flash)
const MA_DEVICES_RETRY_MS = 15_000

// selectable spotify connect devices
export function useConnectDevices(): ConnectDevice[] {
  const [devices, setDevices] = useState<ConnectDevice[]>([])

  useEffect(() => {
    let cancelled = false
    let ac: AbortController | null = null

    const refetch = () => {
      ac?.abort()
      ac = new AbortController()
      void fetchConnectDevices(ac.signal)
        .then((d) => {
          if (!cancelled) setDevices(d)
        })
        .catch(() => {})
    }

    refetch()

    const unsub = subscribeEvents((evt: ApiEvent) => {
      if (evt.type !== 'connect_devices') return
      if (Array.isArray(evt.data)) setDevices(evt.data as ConnectDevice[])
    })
    const unsubConnection = subscribeConnection((connected) => {
      if (connected) refetch()
    })

    return () => {
      cancelled = true
      ac?.abort()
      unsub()
      unsubConnection()
    }
  }, [])

  return devices
}

// issue #134: the selectable Music Assistant players for the idle device
// picker (playbackSource 'ma') — the same lifecycle shape as
// useConnectDevices, fetched from GET /ma/devices (the daemon answers an
// empty list when MA is unconfigured/unreachable; a failed fetch keeps the
// previous list). Inactive while the Spotify source is selected: no request
// at all. NOTE: unlike connect devices there is no MA event on the stream
// (the pinned contract defines none), so the refetches are the initial one
// per enable, after websocket reconnect, and a fixed-delay retry after any
// failed fetch — issue #138: the daemon answers 503 while the player session
// is still coming up (minutes after boot/flash), and a one-shot fetch would
// otherwise leave an empty device list until the UI is reloaded. Mirroring
// this file's refetch-on-reconnect behavior, not its event subscription.
export function useMaDevices(enabled: boolean): MaDevice[] {
  const [devices, setDevices] = useState<MaDevice[]>([])
  useEffect(() => {
    if (!enabled) {
      // back on the Spotify source — forget the list; the next enable refetches
      setDevices([])
      return
    }
    let cancelled = false
    let ac: AbortController | null = null
    let retryTimer: number | undefined
    const refetch = () => {
      ac?.abort()
      ac = new AbortController()
      void fetchMaDevices(ac.signal)
        .then((d) => {
          if (!cancelled) setDevices(d)
        })
        .catch(() => {
          if (cancelled) return
          // issue #138: 503 while the player session is still coming up -
          // retry on a fixed delay until the daemon answers
          window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(() => {
            if (!cancelled) refetch()
          }, MA_DEVICES_RETRY_MS)
        })
    }
    refetch()
    const unsubConnection = subscribeConnection((connected) => {
      if (connected) {
        window.clearTimeout(retryTimer)
        refetch()
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
      ac?.abort()
      unsubConnection()
    }
  }, [enabled])
  return devices
}
