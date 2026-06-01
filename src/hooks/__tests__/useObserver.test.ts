import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ApiEvent, ObserverStatusActive } from '../../api/types'
import { server } from '../../__tests__/msw-server'
import { activeStatus, baseWire } from '../../__tests__/fixtures/observer'

const busState = vi.hoisted(() => ({
  listeners: [] as Array<(evt: { type: string; data: unknown }) => void>,
  connListeners: [] as Array<(c: boolean) => void>,
  connected: false,
}))

vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (evt: { type: string; data: unknown }) => void) => {
    busState.listeners.push(fn)
    return () => {
      const i = busState.listeners.indexOf(fn)
      if (i >= 0) busState.listeners.splice(i, 1)
    }
  },
  subscribeConnection: (fn: (c: boolean) => void) => {
    busState.connListeners.push(fn)
    fn(busState.connected)
    return () => {
      const i = busState.connListeners.indexOf(fn)
      if (i >= 0) busState.connListeners.splice(i, 1)
    }
  },
}))

import { useObserver } from '../useObserver'

function fireEvent(evt: ApiEvent) {
  for (const l of busState.listeners) l(evt)
}

function fireConnection(c: boolean) {
  busState.connected = c
  for (const l of busState.connListeners) l(c)
}

beforeEach(() => {
  busState.listeners.length = 0
  busState.connListeners.length = 0
  busState.connected = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useObserver', () => {
  it('exposes the initial state synchronously on first render', () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    expect(result.current.status).toBeNull()
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.connected).toBe(false)
  })

  it('populates status and clears loading on a successful first poll', async () => {
    server.use(http.get('*/observer/status', () => HttpResponse.json(activeStatus)))

    const { result } = renderHook(() => useObserver())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.status).toMatchObject({
      active: true,
      track_name: 'Test Song',
    })
    expect(result.current.error).toBeNull()
  })

  it('does not reset status when a subsequent poll errors', async () => {
    // bar would blank every time the daemon hiccupped if we cleared on error
    server.use(
      http.get('*/observer/status', async () => {
        await new Promise((r) => setTimeout(r, 50))
        return new HttpResponse(null, { status: 500 })
      }),
    )

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({ type: 'observer_track_changed', data: baseWire })
    })
    expect(result.current.status).toMatchObject({ active: true })

    await waitFor(() => expect(result.current.error).not.toBeNull())

    expect(result.current.status).toMatchObject({ active: true })
    expect(result.current.loading).toBe(false)
  })

  it('replaces full status on observer_state_changed via remoteStateToStatus', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, TrackName: 'Renamed' },
      })
    })

    expect(result.current.status).toMatchObject({
      active: true,
      track_name: 'Renamed',
    })
    expect(result.current.loading).toBe(false)
  })

  it('replaces full status on observer_track_changed via remoteStateToStatus', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_track_changed',
        data: { ...baseWire, TrackName: 'Next Track' },
      })
    })

    expect(result.current.status).toMatchObject({
      active: true,
      track_name: 'Next Track',
    })
  })

  it('applies a `paused` patch to the current status', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, IsPlaying: true, IsPaused: false },
      })
    })

    await act(async () => {
      fireEvent({ type: 'paused', data: null })
    })

    expect(result.current.status).toMatchObject({
      active: true,
      is_paused: true,
      is_playing: false,
    })
  })

  it('applies a `playing` patch to the current status', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, IsPlaying: false, IsPaused: true },
      })
    })

    await act(async () => {
      fireEvent({ type: 'playing', data: null })
    })

    expect(result.current.status).toMatchObject({
      active: true,
      is_paused: false,
      is_playing: true,
    })
  })

  it('applies a `seek` patch with a numeric position', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, PositionAsOfTimestamp: 30_000 },
      })
    })

    // received_at must advance, else interpolation compounds elapsed onto the new pos
    const before = (result.current.status as ObserverStatusActive).received_at

    await act(async () => {
      fireEvent({ type: 'seek', data: { position: 45_000 } })
    })

    const after = (result.current.status as ObserverStatusActive).received_at
    expect((result.current.status as ObserverStatusActive).position).toBe(45_000)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('applies `stopped` and `not_playing` patches by setting is_playing=false', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, IsPlaying: true, IsPaused: false },
      })
    })

    await act(async () => {
      fireEvent({ type: 'stopped', data: null })
    })
    expect((result.current.status as ObserverStatusActive).is_playing).toBe(false)

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, IsPlaying: true, IsPaused: false },
      })
    })
    expect((result.current.status as ObserverStatusActive).is_playing).toBe(true)

    await act(async () => {
      fireEvent({ type: 'not_playing', data: null })
    })
    expect((result.current.status as ObserverStatusActive).is_playing).toBe(false)
  })

  it('ignores a seek event with no numeric position field', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({
        type: 'observer_state_changed',
        data: { ...baseWire, PositionAsOfTimestamp: 30_000 },
      })
    })

    await act(async () => {
      fireEvent({ type: 'seek', data: {} })
    })

    expect((result.current.status as ObserverStatusActive).position).toBe(30_000)
  })

  it('ignores patch-style events when there is no baseline status', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    await act(async () => {
      fireEvent({ type: 'paused', data: null })
    })

    expect(result.current.status).toBeNull()
  })

  it('reflects connection bus transitions on the `connected` field', async () => {
    server.use(http.get('*/observer/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useObserver())

    expect(result.current.connected).toBe(false)

    await act(async () => {
      fireConnection(true)
    })
    expect(result.current.connected).toBe(true)

    await act(async () => {
      fireConnection(false)
    })
    expect(result.current.connected).toBe(false)
  })

  it('polls again after POLL_MS even if WS events keep state fresh', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    let requests = 0
    server.use(
      http.get('*/observer/status', () => {
        requests++
        return HttpResponse.json(activeStatus)
      }),
    )

    renderHook(() => useObserver())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(requests).toBe(1)

    await vi.advanceTimersByTimeAsync(2_999)
    expect(requests).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(requests).toBe(2)
  })
})
