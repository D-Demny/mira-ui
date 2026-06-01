import { WS_URL } from '@/config'
import type { ApiEvent } from './types'

// singleton /events WS shared across hooks

type EventListener = (evt: ApiEvent) => void
type ConnectionListener = (connected: boolean) => void

const listeners = new Set<EventListener>()
const connListeners = new Set<ConnectionListener>()

let ws: WebSocket | null = null
let reconnectTimer = 0
let reconnectDelay = 500
let connected = false

function dispatchConnection(c: boolean) {
  if (c === connected) return
  connected = c
  for (const fn of connListeners) fn(c)
}

function open() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  try {
    ws = new WebSocket(WS_URL)
  } catch {
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    reconnectDelay = 500
    dispatchConnection(true)
  }

  ws.onmessage = (msg) => {
    let evt: ApiEvent
    try {
      evt = JSON.parse(msg.data) as ApiEvent
    } catch {
      return
    }
    // snapshot in case a handler unsubs during iteration
    for (const fn of [...listeners]) {
      try {
        fn(evt)
      } catch (err) {
        // one buggy listener shouldn't block delivery to the others
        console.error('eventBus listener error', err)
      }
    }
  }

  ws.onclose = () => {
    dispatchConnection(false)
    if (listeners.size === 0 && connListeners.size === 0) return
    scheduleReconnect()
  }

  ws.onerror = () => ws?.close()
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 8000)
    open()
  }, reconnectDelay)
}

function shutdownIfIdle() {
  if (listeners.size > 0 || connListeners.size > 0) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = 0
  reconnectDelay = 500
  ws?.close()
  ws = null
  dispatchConnection(false)
}

export function subscribeEvents(fn: EventListener): () => void {
  listeners.add(fn)
  open()
  return () => {
    listeners.delete(fn)
    shutdownIfIdle()
  }
}

export function subscribeConnection(fn: ConnectionListener): () => void {
  connListeners.add(fn)
  // replay current state so subscribers see the initial value immediately
  fn(connected)
  open()
  return () => {
    connListeners.delete(fn)
    shutdownIfIdle()
  }
}
