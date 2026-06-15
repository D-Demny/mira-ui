import { useCallback, useEffect, useState } from 'react'
import * as bt from '@/api/bluetooth'
import { subscribeEvents } from '@/api/eventBus'
import type { KnownBluetoothDevice } from '@/api/types'

// known (paired) BT devices for the Bluetooth pairing menu
export function useKnownDevices(active: boolean) {
  // null = not loaded yet
  const [devices, setDevices] = useState<KnownBluetoothDevice[] | null>(null)

  const refresh = useCallback(() => {
    bt.listKnownDevices()
      .then(setDevices)
      .catch(() => {
        // ignore
      })
  }, [])

  useEffect(() => {
    if (!active) return
    refresh()
    return subscribeEvents((evt) => {
      if (typeof evt.type === 'string' && evt.type.startsWith('bluetooth/')) refresh()
    })
  }, [active, refresh])

  return { devices, refresh }
}
