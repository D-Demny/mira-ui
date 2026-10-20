import { useEffect, useState } from 'react'
import { fetchConnectDevices, fetchMaDevices } from '@/api/client'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, ConnectDevice, MaDevice } from '@/api/types'

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
// (the pinned contract defines none), so the only refetches are the initial
// one per enable and after websocket reconnect — mirroring this file's
// refetch-on-reconnect behavior, not its event subscription.
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
    const refetch = () => {
      ac?.abort()
      ac = new AbortController()
      void fetchMaDevices(ac.signal)
        .then((d) => {
          if (!cancelled) setDevices(d)
        })
        .catch(() => {})
    }
    refetch()
    const unsubConnection = subscribeConnection((connected) => {
      if (connected) refetch()
    })
    return () => {
      cancelled = true
      ac?.abort()
      unsubConnection()
    }
  }, [enabled])
  return devices
}
