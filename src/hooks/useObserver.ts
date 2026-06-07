import { useEffect, useReducer, useRef } from 'react'
import { fetchObserverStatus, remoteStateToStatus } from '@/api/client'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, ObserverStatus, ObserverStatusActive, RemoteStateWire } from '@/api/types'

interface ObserverState {
  status: ObserverStatus | null
  loading: boolean
  error: string | null
  connected: boolean
}

type Action =
  | { type: 'loading' }
  | { type: 'status'; status: ObserverStatus }
  | { type: 'error'; error: string }
  | { type: 'ws'; connected: boolean }

const initial: ObserverState = {
  status: null,
  loading: true,
  error: null,
  connected: false,
}

function reducer(state: ObserverState, action: Action): ObserverState {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true }
    case 'status':
      return { ...state, status: action.status, loading: false, error: null }
    case 'error':
      return { ...state, error: action.error, loading: false }
    case 'ws':
      return { ...state, connected: action.connected }
  }
}

const POLL_MS = 3000
const POLL_TIMEOUT_MS = 5000

export function useObserver() {
  const [state, dispatch] = useReducer(reducer, initial)
  const latestRef = useRef<ObserverStatus | null>(null)
  latestRef.current = state.status

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      const ac = new AbortController()
      const timeoutId = window.setTimeout(() => ac.abort(), POLL_TIMEOUT_MS)
      try {
        const next = await fetchObserverStatus(ac.signal)
        if (!cancelled) dispatch({ type: 'status', status: next })
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        dispatch({ type: 'error', error: (err as Error).message })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void poll()
    const pollTimer = window.setInterval(poll, POLL_MS)

    const applyEvent = (evt: ApiEvent) => {
      if (evt.type === 'observer_track_changed' || evt.type === 'observer_state_changed') {
        const rs = evt.data as RemoteStateWire
        if (!rs || typeof rs !== 'object') return
        const status = remoteStateToStatus(rs)
        dispatch({ type: 'status', status })
        return
      }

      // no device is active anymore, flip to idle immediately
      if (evt.type === 'observer_inactive') {
        dispatch({
          type: 'status',
          status: { active: false, message: 'no remote device is currently playing' },
        })
        return
      }

      // patch events only mutate part of the snapshot
      const cur = latestRef.current
      if (!cur || !cur.active) return

      const patched: ObserverStatusActive = { ...cur }
      switch (evt.type) {
        case 'paused':
          patched.is_paused = true
          patched.is_playing = false
          patched.received_at = Date.now()
          break
        case 'playing':
          patched.is_paused = false
          patched.is_playing = true
          patched.received_at = Date.now()
          break
        case 'seek': {
          const d = evt.data as { position?: number }
          if (typeof d?.position === 'number') {
            patched.position = d.position
            patched.received_at = Date.now()
          }
          break
        }
        case 'stopped':
        case 'not_playing':
          patched.is_playing = false
          patched.received_at = Date.now()
          break
        default:
          return
      }
      dispatch({ type: 'status', status: patched })
    }

    const unsubEvents = subscribeEvents(applyEvent)
    const unsubConn = subscribeConnection((c) => dispatch({ type: 'ws', connected: c }))

    return () => {
      cancelled = true
      window.clearInterval(pollTimer)
      unsubEvents()
      unsubConn()
    }
  }, [])

  return state
}
