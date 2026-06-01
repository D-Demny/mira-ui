import { API_BASE } from '@/config'
import type { BluetoothDeviceInfo, PairingStartedPayload } from './types'

async function bt<T = void>(
  path: string,
  init?: RequestInit,
  parse?: (res: Response) => Promise<T>,
): Promise<T> {
  const res = await fetch(`${API_BASE}/bluetooth${path}`, init)
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error ?? ''
    } catch {
      // body wasn't JSON, ignore
    }
    throw new Error(`bluetooth${path}: ${res.status}${detail ? ` (${detail})` : ''}`)
  }
  return parse ? parse(res) : (undefined as T)
}

export const setDiscoverable = (enable: boolean) =>
  bt(`/discover/${enable ? 'on' : 'off'}`, { method: 'POST' })

export const listDevices = () => bt<BluetoothDeviceInfo[]>('/devices', undefined, (r) => r.json())

export const removeDevice = (addr: string) =>
  bt(`/remove/${encodeURIComponent(addr)}`, { method: 'POST' })

export const connectDevice = (addr: string) =>
  bt(`/connect/${encodeURIComponent(addr)}`, { method: 'POST' })

export const disconnectDevice = (addr: string) =>
  bt(`/disconnect/${encodeURIComponent(addr)}`, { method: 'POST' })

export const connectNetwork = (addr: string) =>
  bt(`/network/${encodeURIComponent(addr)}`, { method: 'POST' })

export const networkStatus = () => bt<{ up: boolean }>('/network', undefined, (r) => r.json())

export const acceptPairing = () => bt('/pairing/accept', { method: 'POST' })

export const denyPairing = () => bt('/pairing/deny', { method: 'POST' })

export const getPendingPairing = () =>
  bt<
    | { pending: false }
    | {
        pending: true
        request: PairingStartedPayload & { device: string; passkey: string; requestType: string }
      }
  >('/pairing', undefined, (r) => r.json())
