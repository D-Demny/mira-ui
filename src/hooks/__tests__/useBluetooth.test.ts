import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ApiEvent } from '../../api/types'
import { server } from '../../__tests__/msw-server'

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

import { useBluetooth } from '../useBluetooth'

const LAST_DEVICE_KEY = 'mira.bluetooth.lastDevice'

function fireEvent(evt: ApiEvent) {
  for (const l of busState.listeners) l(evt)
}

beforeEach(() => {
  busState.listeners.length = 0
  busState.connListeners.length = 0
  busState.connected = false
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBluetooth mount-time pair-state recovery', () => {
  it('surfaces a pending pairing prompt, converting the BlueZ path to a MAC', async () => {
    server.use(
      http.get('*/bluetooth/pairing', () =>
        HttpResponse.json({
          pending: true,
          request: {
            address: 'AB:CD:EF:01:23:45',
            pairingKey: '123456',
            device: '/org/bluez/hci0/dev_AB_CD_EF_01_23_45',
            passkey: '123456',
            requestType: 'confirmation',
          },
        }),
      ),
    )

    const { result } = renderHook(() => useBluetooth())

    await waitFor(() => expect(result.current.pairing).not.toBeNull())
    expect(result.current.pairing).toEqual({
      address: 'AB:CD:EF:01:23:45',
      passkey: '123456',
    })
  })

  it('leaves pairing null when the daemon reports no pending pair', async () => {
    server.use(http.get('*/bluetooth/pairing', () => HttpResponse.json({ pending: false })))

    const { result } = renderHook(() => useBluetooth())

    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.pairing).toBeNull()
  })

  it('swallows daemon errors from getPendingPairing and stays calm', async () => {
    // BT manager waits ~7s for the adapter, hitting 503 here must not crash the hook
    server.use(http.get('*/bluetooth/pairing', () => new HttpResponse(null, { status: 503 })))

    const { result } = renderHook(() => useBluetooth())

    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.pairing).toBeNull()
  })
})

describe('useBluetooth WS events', () => {
  it('opens the pairing dialog on a bluetooth/pairing event', async () => {
    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      fireEvent({
        type: 'bluetooth/pairing',
        data: { address: 'AA:BB:CC:DD:EE:FF', pairingKey: '654321' },
      })
    })

    expect(result.current.pairing).toEqual({
      address: 'AA:BB:CC:DD:EE:FF',
      passkey: '654321',
    })
  })

  it('persists lastDevice + clears pairing + auto-connects PAN on bluetooth/paired', async () => {
    let connectAttempts = 0
    server.use(
      http.post('*/bluetooth/network/*', () => {
        connectAttempts++
        return HttpResponse.json({})
      }),
    )

    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      fireEvent({
        type: 'bluetooth/pairing',
        data: { address: '11:22:33:44:55:66', pairingKey: '0' },
      })
    })
    expect(result.current.pairing).not.toBeNull()

    await act(async () => {
      fireEvent({
        type: 'bluetooth/paired',
        data: {
          device: {
            address: '11:22:33:44:55:66',
            name: 'Pixel',
            alias: 'Pixel',
            class: '',
            icon: '',
            paired: true,
            trusted: true,
            blocked: false,
            connected: true,
            legacyPairing: false,
          },
        },
      })
    })

    expect(localStorage.getItem(LAST_DEVICE_KEY)).toBe('11:22:33:44:55:66')
    expect(result.current.lastDevice).toBe('11:22:33:44:55:66')
    expect(result.current.pairing).toBeNull()
    await waitFor(() => expect(connectAttempts).toBeGreaterThanOrEqual(1))
  })

  it('dismisses pairing on bluetooth/network/connect regardless of address', async () => {
    // PAN up implies pair succeeded, most reliable dismiss path
    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      fireEvent({
        type: 'bluetooth/pairing',
        data: { address: '99:99:99:99:99:99', pairingKey: '0' },
      })
    })
    expect(result.current.pairing).not.toBeNull()

    await act(async () => {
      // different address, must still clear
      fireEvent({
        type: 'bluetooth/network/connect',
        data: { address: '88:88:88:88:88:88' },
      })
    })

    expect(result.current.pairing).toBeNull()
  })

  it('does NOT clear lastDevice on a bluetooth/disconnect event', async () => {
    // disconnect is normal, we only forget on explicit remove
    localStorage.setItem(LAST_DEVICE_KEY, 'AA:BB:CC:DD:EE:FF')

    const { result } = renderHook(() => useBluetooth())
    expect(result.current.lastDevice).toBe('AA:BB:CC:DD:EE:FF')

    await act(async () => {
      fireEvent({
        type: 'bluetooth/disconnect',
        data: { address: 'AA:BB:CC:DD:EE:FF' },
      })
    })

    expect(result.current.lastDevice).toBe('AA:BB:CC:DD:EE:FF')
    expect(localStorage.getItem(LAST_DEVICE_KEY)).toBe('AA:BB:CC:DD:EE:FF')
  })

  it('dismisses pairing on bluetooth/connect only when address matches', async () => {
    // defensive dismiss, but not for unrelated headphones reconnects
    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      fireEvent({
        type: 'bluetooth/pairing',
        data: { address: 'AA:AA:AA:AA:AA:AA', pairingKey: '0' },
      })
    })
    expect(result.current.pairing).not.toBeNull()

    await act(async () => {
      fireEvent({
        type: 'bluetooth/connect',
        data: { address: 'BB:BB:BB:BB:BB:BB' },
      })
    })
    expect(result.current.pairing).not.toBeNull()

    await act(async () => {
      fireEvent({
        type: 'bluetooth/connect',
        data: { address: 'AA:AA:AA:AA:AA:AA' },
      })
    })
    expect(result.current.pairing).toBeNull()
  })
})

describe('useBluetooth auto-reconnect with 503 retry', () => {
  it('retries up to four times on 503 then stops, succeeding when the daemon catches up', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    localStorage.setItem(LAST_DEVICE_KEY, 'AA:BB:CC:DD:EE:FF')

    let attempts = 0
    server.use(
      http.post('*/bluetooth/network/*', () => {
        attempts++
        if (attempts <= 3) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json({})
      }),
    )

    renderHook(() => useBluetooth())

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(attempts).toBe(2)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(attempts).toBe(3)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(attempts).toBe(4)

    // locks the n < 4 cap so off-by-one doesn't accidentally keep hammering
    await vi.advanceTimersByTimeAsync(30_000)
    expect(attempts).toBe(4)
  })

  it('does not retry on a permanent error like 404', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    localStorage.setItem(LAST_DEVICE_KEY, 'AA:BB:CC:DD:EE:FF')

    let attempts = 0
    server.use(
      http.post('*/bluetooth/network/*', () => {
        attempts++
        return new HttpResponse(null, { status: 404 })
      }),
    )

    renderHook(() => useBluetooth())

    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(attempts).toBe(1)
  })

  it('skips auto-reconnect entirely when no device is stored', async () => {
    let attempts = 0
    server.use(
      http.post('*/bluetooth/network/*', () => {
        attempts++
        return HttpResponse.json({})
      }),
    )

    renderHook(() => useBluetooth())

    await new Promise((r) => setTimeout(r, 50))
    expect(attempts).toBe(0)
  })
})

describe('useBluetooth action callbacks', () => {
  it('setDiscoverable(true) posts to /bluetooth/discover/on', async () => {
    let mode: 'on' | 'off' | null = null
    server.use(
      http.post('*/bluetooth/discover/on', () => {
        mode = 'on'
        return HttpResponse.json({})
      }),
      http.post('*/bluetooth/discover/off', () => {
        mode = 'off'
        return HttpResponse.json({})
      }),
    )

    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      await result.current.setDiscoverable(true)
    })
    expect(mode).toBe('on')

    await act(async () => {
      await result.current.setDiscoverable(false)
    })
    expect(mode).toBe('off')
  })

  it('reconnectLast is a no-op when no device is stored', async () => {
    let attempts = 0
    server.use(
      http.post('*/bluetooth/network/*', () => {
        attempts++
        return HttpResponse.json({})
      }),
    )

    const { result } = renderHook(() => useBluetooth())

    await act(async () => {
      await result.current.reconnectLast()
    })

    expect(attempts).toBe(0)
  })

  it('reconnectLast posts to /bluetooth/network/<addr> when a device is stored', async () => {
    const addrs: string[] = []
    server.use(
      http.post('*/bluetooth/network/*', ({ request }) => {
        const url = new URL(request.url)
        addrs.push(decodeURIComponent(url.pathname.replace('/bluetooth/network/', '')))
        return HttpResponse.json({})
      }),
    )

    localStorage.setItem(LAST_DEVICE_KEY, 'AA:BB:CC:DD:EE:FF')

    const { result } = renderHook(() => useBluetooth())

    // mount-time auto-reconnect also fires, capture count then assert +1
    await new Promise((r) => setTimeout(r, 0))
    const beforeImperative = addrs.length

    await act(async () => {
      await result.current.reconnectLast()
    })

    expect(addrs).toHaveLength(beforeImperative + 1)
    expect(addrs[addrs.length - 1]).toBe('AA:BB:CC:DD:EE:FF')
  })
})
