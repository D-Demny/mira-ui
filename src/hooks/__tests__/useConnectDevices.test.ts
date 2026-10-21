import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../__tests__/msw-server'

const busState = vi.hoisted(() => ({
  connListeners: [] as Array<(connected: boolean) => void>,
  eventListeners: [] as Array<(evt: { type: string; data: unknown }) => void>,
}))

vi.mock('@/api/eventBus', () => ({
  subscribeConnection: (fn: (connected: boolean) => void) => {
    busState.connListeners.push(fn)
    return () => {
      const i = busState.connListeners.indexOf(fn)
      if (i >= 0) busState.connListeners.splice(i, 1)
    }
  },
  subscribeEvents: (fn: (evt: { type: string; data: unknown }) => void) => {
    busState.eventListeners.push(fn)
    return () => {
      const i = busState.eventListeners.indexOf(fn)
      if (i >= 0) busState.eventListeners.splice(i, 1)
    }
  },
}))

// issue #134: the api client is PARTIALLY mocked — only fetchMaDevices is
// replaced by a spy (deterministic call counting + fixtures, no network, no
// timers); fetchConnectDevices stays real for the useConnectDevices tests
vi.mock('@/api/client', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ClientModule
  return { ...actual, fetchMaDevices: vi.fn() }
})

import { useConnectDevices, useMaDevices } from '../useConnectDevices'
import { fetchMaDevices } from '@/api/client'
import type * as ClientModule from '@/api/client'

function fireConnection(connected: boolean) {
  for (const fn of busState.connListeners) fn(connected)
}

describe('useConnectDevices', () => {
  it('refetches the device list after websocket reconnect', async () => {
    let requests = 0
    server.use(
      http.get('*/connect/devices', () => {
        requests++
        return HttpResponse.json({
          devices: [{ id: `dev-${requests}`, name: `Device ${requests}` }],
        })
      }),
    )

    const { result } = renderHook(() => useConnectDevices())

    await waitFor(() => expect(result.current[0]?.id).toBe('dev-1'))

    await act(async () => {
      fireConnection(true)
    })

    await waitFor(() => expect(result.current[0]?.id).toBe('dev-2'))
  })
})

describe('useMaDevices (issue #134)', () => {
  beforeEach(() => {
    vi.mocked(fetchMaDevices).mockReset()
  })

  it('fetches the player list on enable and refetches after websocket reconnect', async () => {
    let call = 0
    vi.mocked(fetchMaDevices).mockImplementation(async () => {
      call++
      return [{ id: `ma-${call}`, name: `Player ${call}`, available: true }]
    })

    const { result } = renderHook(() => useMaDevices(true))

    await waitFor(() => expect(result.current[0]?.id).toBe('ma-1'))

    await act(async () => {
      fireConnection(true)
    })

    await waitFor(() => expect(result.current[0]?.id).toBe('ma-2'))
  })

  it('issues no request while disabled (the spotify source is selected)', () => {
    vi.mocked(fetchMaDevices).mockResolvedValue([{ id: 'ma-1', name: 'Player', available: true }])

    const { result } = renderHook(() => useMaDevices(false))

    // the effect ran during the act-wrapped render — the spy proves no fetch
    // was started (a deterministic negative, no timing involved)
    expect(fetchMaDevices).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('clears the list when disabled again (back on the spotify source)', async () => {
    vi.mocked(fetchMaDevices).mockResolvedValue([{ id: 'ma-1', name: 'Player', available: true }])

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMaDevices(enabled),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => expect(result.current[0]?.id).toBe('ma-1'))

    rerender({ enabled: false })

    expect(result.current).toEqual([])
    // exactly one fetch — the initial enable; disabling must not refetch
    expect(fetchMaDevices).toHaveBeenCalledTimes(1)
  })

  it('retries on a fixed delay after failed fetches until the daemon answers (issue #138)', async () => {
    vi.useFakeTimers()
    try {
      // the daemon answers 503 while the player session is still coming up -
      // the hook must keep asking, not accept a spurious empty list
      let call = 0
      vi.mocked(fetchMaDevices).mockImplementation(async () => {
        call++
        if (call < 3) throw new Error('player session not ready')
        return [{ id: 'ma-3', name: 'Player 3', available: true }]
      })

      const { result } = renderHook(() => useMaDevices(true))

      await act(async () => {})
      expect(result.current).toEqual([])
      expect(fetchMaDevices).toHaveBeenCalledTimes(1)

      await act(async () => {
        vi.advanceTimersByTime(15_000) // == MA_DEVICES_RETRY_MS
      })
      expect(fetchMaDevices).toHaveBeenCalledTimes(2)
      expect(result.current).toEqual([])

      await act(async () => {
        vi.advanceTimersByTime(15_000)
      })
      expect(fetchMaDevices).toHaveBeenCalledTimes(3)
      expect(result.current[0]?.id).toBe('ma-3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending retry when disabled again before it fires', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetchMaDevices).mockRejectedValue(new Error('player session not ready'))

      const { result, rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) => useMaDevices(enabled),
        { initialProps: { enabled: true } },
      )

      await act(async () => {})
      expect(fetchMaDevices).toHaveBeenCalledTimes(1)

      // back on the spotify source before the retry delay elapsed - no
      // further request may go out
      rerender({ enabled: false })
      vi.advanceTimersByTime(60_000)
      expect(fetchMaDevices).toHaveBeenCalledTimes(1)
      expect(result.current).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
