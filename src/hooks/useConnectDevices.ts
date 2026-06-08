import { useEffect, useState } from 'react'
import { fetchConnectDevices } from '@/api/client'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, ConnectDevice } from '@/api/types'

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
