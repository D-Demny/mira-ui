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

const STALE_MS = 45000
const WATCHDOG_MS = 10000
let lastMsgAt = 0
let watchdogTimer = 0

function dispatchConnection(c: boolean) {
  if (c === connected) return
  connected = c
  for (const fn of connListeners) fn(c)
}

function startWatchdog() {
  if (watchdogTimer) return
  watchdogTimer = window.setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (Date.now() - lastMsgAt > STALE_MS) reconnectNow()
  }, WATCHDOG_MS)
}

function stopWatchdog() {
  if (!watchdogTimer) return
  window.clearInterval(watchdogTimer)
  watchdogTimer = 0
}

// reconnectNow drops a presumed-dead socket and opens a fresh one
function reconnectNow() {
  const old = ws
  ws = null
  if (old) {
    old.onopen = old.onmessage = old.onclose = old.onerror = null
    try {
      old.close()
    } catch {
      // already closing/closed
    }
  }
  dispatchConnection(false)
  reconnectDelay = 500
  open()
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
    lastMsgAt = Date.now()
    startWatchdog()
    dispatchConnection(true)
  }

  ws.onmessage = (msg) => {
    lastMsgAt = Date.now()
    let evt: ApiEvent
    try {
      evt = JSON.parse(msg.data) as ApiEvent
    } catch {
      return
    }
    if (evt.type === 'ping') return
    for (const fn of [...listeners]) {
      try {
        fn(evt)
      } catch (err) {
        // one buggy listener shouldnt block delivery to the others
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
  stopWatchdog()
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
