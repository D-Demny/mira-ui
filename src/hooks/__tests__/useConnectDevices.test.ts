import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

import { useConnectDevices } from '../useConnectDevices'

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
