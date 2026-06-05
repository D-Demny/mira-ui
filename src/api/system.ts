import { API_BASE } from '@/config'

async function systemPost(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`${path}: ${res.status}`)
  }
}

// full factory reset
export function resetDevice(): Promise<void> {
  return systemPost('/system/reset')
}

// restart without wiping anything
export function restartDevice(): Promise<void> {
  return systemPost('/system/restart')
}

// suspend to RAM (sleep), power button wakes it
export function suspendDevice(): Promise<void> {
  return systemPost('/system/suspend')
}
