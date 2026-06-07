import { useEffect, useState } from 'react'
import { fetchConnectDevices } from '@/api/client'
import { subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, ConnectDevice } from '@/api/types'

// selectable spotify connect devices
export function useConnectDevices(): ConnectDevice[] {
  const [devices, setDevices] = useState<ConnectDevice[]>([])

  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()

    void fetchConnectDevices(ac.signal)
      .then((d) => {
        if (!cancelled) setDevices(d)
      })
      .catch(() => {})

    const unsub = subscribeEvents((evt: ApiEvent) => {
      if (evt.type !== 'connect_devices') return
      if (Array.isArray(evt.data)) setDevices(evt.data as ConnectDevice[])
    })

    return () => {
      cancelled = true
      ac.abort()
      unsub()
    }
  }, [])

  return devices
}
