import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import {
  useDefaultDevicePrompt,
  DEFAULT_DEVICE_PROMPT_SUPPRESS_MS,
  type UseDefaultDevicePromptParams,
} from '../useDefaultDevicePrompt'
import { server } from '../../__tests__/msw-server'
import { activeStatus } from '../../__tests__/fixtures/observer'
import { __resetSettings, updateSettings } from '@/settings'
import type { ConnectDevice, ObserverStatus } from '@/api/types'

// issue #79: the default-device switch prompt wraps every playback
// interaction. The unit tests pin when it defers (vs runs straight through),
// what each answer does to the deferred action and the transfer request, and
// the 10-minute decline suppression window.

const idle: ObserverStatus = { active: false, message: 'no session' }

function makeDevice(overrides: Partial<ConnectDevice> = {}): ConnectDevice {
  return {
    id: 'dev-1',
    name: 'Office PC',
    type: 'COMPUTER',
    volume: 60,
    volume_steps: 100,
    volume_disabled: false,
    is_active: true,
    is_offline: false,
    can_transfer: true,
    ...overrides,
  }
}

const DEVICES = [makeDevice(), makeDevice({ id: 'dev-2', name: 'Living Room', is_active: false })]

function params(over: Partial<UseDefaultDevicePromptParams> = {}): UseDefaultDevicePromptParams {
  return {
    status: activeStatus, // fixture device_id is 'pixel'
    connectDevices: DEVICES,
    notify: vi.fn(),
    ...over,
  }
}

// the prompt's own seam: wrap a throwaway action and observe whether it ran
function renderPrompt(over: Partial<UseDefaultDevicePromptParams> = {}) {
  return renderHook((p: UseDefaultDevicePromptParams) => useDefaultDevicePrompt(p), {
    initialProps: params(over),
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
})

afterEach(() => {
  server.resetHandlers()
})

describe('useDefaultDevicePrompt straight-through cases', () => {
  it('runs the interaction directly when no default device is set', () => {
    const action = vi.fn()
    const { result } = renderPrompt()

    expect(result.current.wrapAction(action)).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
    expect(result.current.prompt).toBeNull()
  })

  it('runs directly while no session is active', () => {
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt({ status: idle })

    expect(result.current.wrapAction(action)).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('runs directly when the active device already matches the default', () => {
    updateSettings({ defaultDeviceId: 'pixel' }) // == fixture device_id
    const action = vi.fn()
    const { result } = renderPrompt()

    expect(result.current.wrapAction(action)).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('runs directly when the stored default is not in the connect list', () => {
    updateSettings({ defaultDeviceId: 'dev-gone' }) // stale id after a device vanished
    const action = vi.fn()
    const { result } = renderPrompt()

    expect(result.current.wrapAction(action)).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
  })
})

describe('useDefaultDevicePrompt deferral + answers', () => {
  it('defers the interaction and opens the prompt when the devices differ', () => {
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt()
    let deferred: boolean | undefined
    act(() => {
      deferred = result.current.wrapAction(action)
    })
    expect(deferred).toBe(true)
    expect(action).not.toHaveBeenCalled()
    expect(result.current.prompt).toEqual({
      action,
      deviceId: 'dev-2',
      deviceName: 'Living Room',
    })
  })

  it('accept runs the deferred interaction AND transfers to the default device', async () => {
    const transfers: string[] = []
    server.use(
      http.post('*/connect/transfer', async ({ request }) => {
        const body = (await request.json()) as { device_id?: string } // hook-sent shape
        transfers.push(body.device_id ?? '')
        return HttpResponse.json({ ok: true })
      }),
    )
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt()

    act(() => result.current.wrapAction(action))
    act(() => result.current.accept())

    expect(result.current.prompt).toBeNull()
    expect(action).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(transfers).toEqual(['dev-2']))
  })

  it('decline runs the deferred interaction without a transfer and suppresses the prompt', () => {
    const transfers: string[] = []
    server.use(
      http.post('*/connect/transfer', ({ request }) => {
        transfers.push(String(request.url))
        return HttpResponse.json({ ok: true })
      }),
    )
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt()

    act(() => result.current.wrapAction(action))
    act(() => result.current.decline())

    expect(result.current.prompt).toBeNull()
    expect(action).toHaveBeenCalledTimes(1)
    expect(transfers).toEqual([])

    // within the 10-minute window the next interaction runs straight through
    const again = vi.fn()
    expect(result.current.wrapAction(again)).toBe(false)
    expect(again).toHaveBeenCalledTimes(1)
    expect(result.current.prompt).toBeNull()
  })

  it('asks again once the 10-minute suppression window has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_716_390_000_000)
    try {
      updateSettings({ defaultDeviceId: 'dev-2' })
      const first = vi.fn()
      const { result } = renderPrompt()

      act(() => expect(result.current.wrapAction(first)).toBe(true))
      act(() => result.current.decline())
      expect(first).toHaveBeenCalledTimes(1)

      // still inside the window: straight through
      const early = vi.fn()
      act(() => expect(result.current.wrapAction(early)).toBe(false))
      expect(early).toHaveBeenCalledTimes(1)

      // past the window: defers again
      vi.advanceTimersByTime(DEFAULT_DEVICE_PROMPT_SUPPRESS_MS + 1)
      const late = vi.fn()
      act(() => expect(result.current.wrapAction(late)).toBe(true))
      expect(late).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel closes without running or transferring and does not suppress', () => {
    const transfers: string[] = []
    server.use(
      http.post('*/connect/transfer', ({ request }) => {
        transfers.push(String(request.url))
        return HttpResponse.json({ ok: true })
      }),
    )
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt()

    act(() => expect(result.current.wrapAction(action)).toBe(true))
    act(() => result.current.cancel())

    expect(result.current.prompt).toBeNull()
    expect(action).not.toHaveBeenCalled()
    expect(transfers).toEqual([])

    // a cancel is not a decline: the very next interaction asks again
    const again = vi.fn()
    expect(result.current.wrapAction(again)).toBe(true)
    expect(again).not.toHaveBeenCalled()
  })

  it('accept reports a failed transfer, but the interaction still runs', async () => {
    server.use(http.post('*/connect/transfer', () => HttpResponse.error()))
    const notify = vi.fn()
    updateSettings({ defaultDeviceId: 'dev-2' })
    const action = vi.fn()
    const { result } = renderPrompt({ notify })

    act(() => result.current.wrapAction(action))
    act(() => result.current.accept())

    expect(result.current.prompt).toBeNull()
    expect(action).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(`Couldn't switch to the default device`, {
        variant: 'error',
      }),
    )
  })

  it('swallows an interaction while a prompt is already open', () => {
    updateSettings({ defaultDeviceId: 'dev-2' })
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderPrompt()

    act(() => expect(result.current.wrapAction(first)).toBe(true))
    // the prompt is up: the second press must not replace the deferred action
    act(() => expect(result.current.wrapAction(second)).toBe(true))
    expect(second).not.toHaveBeenCalled()

    act(() => result.current.cancel())
    // cancel runs nothing — the swallowed second press never happened either
    expect(first).not.toHaveBeenCalled()
  })
})
