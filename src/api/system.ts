import { API_BASE } from '@/config'

// Factory reset
// deletes spotify credentials, bluetooth addresses, then reboots the device
// TODO: should wipe the saved ip addresses too (for going from ics to nat)
export async function resetDevice(): Promise<void> {
  const res = await fetch(`${API_BASE}/system/reset`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`system/reset: ${res.status}`)
  }
}
