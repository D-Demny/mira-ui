import { useCallback, useEffect, useRef, useState } from 'react'
import * as bt from '@/api/bluetooth'
import { subscribeEvents } from '@/api/eventBus'
import type {
  ApiEvent,
  DeviceConnectedPayload,
  DeviceDisconnectedPayload,
  DevicePairedPayload,
  NetworkStatusPayload,
  PairingStartedPayload,
} from '@/api/types'

const LAST_DEVICE_KEY = 'mira.bluetooth.lastDevice'

function readLastDevice(): string | null {
  try {
    return window.localStorage.getItem(LAST_DEVICE_KEY)
  } catch {
    return null
  }
}

function writeLastDevice(addr: string | null) {
  try {
    if (addr) window.localStorage.setItem(LAST_DEVICE_KEY, addr)
    else window.localStorage.removeItem(LAST_DEVICE_KEY)
  } catch {
    // ignore
  }
}

export interface PairingPrompt {
  address: string
  passkey: string
}

export interface Carriers {
  usb: boolean
  bt: boolean
}

// offline screen hintt
export type BtTroubleHint = 'hotspot-off' | 'bond-lost' | null

export interface BluetoothState {
  online: boolean | null // null = havent heard yet
  carriers: Carriers | null // which physical links are up
  pairing: PairingPrompt | null
  lastDevice: string | null
  trouble: BtTroubleHint
}

export interface BluetoothActions {
  setDiscoverable: (enable: boolean) => Promise<void>
  reconnectLast: () => Promise<void>
}

export function useBluetooth(): BluetoothState & BluetoothActions {
  const [online, setOnline] = useState<boolean | null>(null)
  const [carriers, setCarriers] = useState<Carriers | null>(null)
  const [pairing, setPairing] = useState<PairingPrompt | null>(null)
  const [lastDevice, setLastDevice] = useState<string | null>(() => readLastDevice())
  const [trouble, setTrouble] = useState<BtTroubleHint>(null)

  const lastDeviceRef = useRef(lastDevice)
  lastDeviceRef.current = lastDevice

  // auto-reconnect with 503 retry, chromium rn loads before the bluetooth manager
  useEffect(() => {
    const addr = lastDeviceRef.current
    if (!addr) return

    let cancelled = false
    const attempt = async (n: number) => {
      if (cancelled) return
      try {
        await bt.connectNetwork(addr)
      } catch (err) {
        const msg = (err as Error).message ?? ''
        const transient = / 503\b/.test(msg)
        if (transient && n < 4) {
          window.setTimeout(() => attempt(n + 1), 2000)
        }
      }
    }

    void attempt(1)
    return () => {
      cancelled = true
    }
  }, [])

  // websocket event can fire before chromium subscribes
  useEffect(() => {
    bt.getPendingPairing()
      .then((res) => {
        if (!res.pending || !res.request?.passkey) return
        const devPath = res.request.device ?? ''
        const tail = devPath.split('/').pop() ?? ''
        const addr = tail.replace(/^dev_/, '').replace(/_/g, ':')
        if (addr) setPairing({ address: addr, passkey: res.request.passkey })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onEvent = (evt: ApiEvent) => {
      switch (evt.type) {
        case 'network_status': {
          const p = evt.data as NetworkStatusPayload
          const isOnline = p?.status === 'online'
          setOnline(isOnline)
          if (isOnline) setTrouble(null)
          if (typeof p?.usb === 'boolean' || typeof p?.bt === 'boolean') {
            setCarriers({ usb: p.usb === true, bt: p.bt === true })
          }
          break
        }
        case 'bluetooth/pairing': {
          const p = evt.data as PairingStartedPayload
          if (p?.address && p?.pairingKey) {
            setPairing({ address: p.address, passkey: p.pairingKey })
          }
          break
        }
        case 'bluetooth/pairing/cancelled':
          setPairing(null)
          break
        case 'bluetooth/paired': {
          const p = evt.data as DevicePairedPayload
          if (p?.device?.address) {
            writeLastDevice(p.device.address)
            setLastDevice(p.device.address)
            bt.connectNetwork(p.device.address).catch(() => {})
          }
          setPairing(null)
          setTrouble(null) // fresh pair resolves a lost bond
          break
        }
        case 'bluetooth/connect': {
          const p = evt.data as DeviceConnectedPayload
          const addr = p?.device?.address ?? p?.address
          if (addr) {
            writeLastDevice(addr)
            setLastDevice(addr)
          }
          // defensive dismiss for the pair-then-PAN race
          setPairing((cur) => (cur && addr && cur.address === addr ? null : cur))
          break
        }
        case 'bluetooth/disconnect': {
          const p = evt.data as DeviceDisconnectedPayload
          // keep lastDevice, disconnect is normal
          void p
          break
        }
        case 'bluetooth/network/connect':
          // PAN up implies pair succeeded
          setPairing(null)
          setTrouble(null)
          break
        case 'bluetooth/network/disconnect':
          break // network_status will follow
        case 'bluetooth/network/unavailable':
          // no hotspot
          setTrouble((cur) => (cur === 'bond-lost' ? cur : 'hotspot-off'))
          break
        case 'bluetooth/bond-lost':
          // the phone deleted the pairing; only a re-pair fixes this
          setTrouble('bond-lost')
          break
      }
    }

    return subscribeEvents(onEvent)
  }, [])

  const setDiscoverable = useCallback(async (enable: boolean) => {
    await bt.setDiscoverable(enable)
  }, [])

  const reconnectLast = useCallback(async () => {
    const addr = lastDeviceRef.current
    if (!addr) return
    await bt.connectNetwork(addr)
  }, [])

  return {
    online,
    carriers,
    pairing,
    lastDevice,
    trouble,
    setDiscoverable,
    reconnectLast,
  }
}
