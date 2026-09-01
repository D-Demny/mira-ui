import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  MIRA_SERVER_POLL_MS,
  __resetMiraServerState,
  checkMiraServer,
  useMiraServer,
} from '../useMiraServer'
import {
  MIRA_SERVER_TIMEOUT_MS,
  standaloneMiraServerState,
  toMiraServerState,
  type MiraServerCapabilities,
} from '@/api/miraServer'

const STANDBY = standaloneMiraServerState()

const COMPUTE: MiraServerCapabilities = {
  tier: 'compute',
  disk_cache: true,
  remote_colors: true,
  remote_blur: true,
}

type FakeMethod = 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'
const FAKE_CLOCK: { toFake: FakeMethod[] } = {
  toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
}

describe('toMiraServerState (capabilities mapping)', () => {
  it('maps tier cache to lightweight mode with 1:1 flag mapping', () => {
    expect(
      toMiraServerState({
        tier: 'cache',
        disk_cache: true,
        remote_colors: false,
        remote_blur: true,
      }),
    ).toEqual({
      mode: 'lightweight',
      features: { diskCache: true, remoteColors: false, remoteBlur: true },
    })
  })

  it('maps tier compute to compute mode with 1:1 flag mapping', () => {
    expect(toMiraServerState(COMPUTE)).toEqual({
      mode: 'compute',
      features: { diskCache: true, remoteColors: true, remoteBlur: true },
    })
  })

  it('degrades to standalone for an unknown tier', () => {
    expect(toMiraServerState({ ...COMPUTE, tier: 'bogus' })).toEqual(STANDBY)
  })

  it('degrades to standalone for non-object payloads', () => {
    expect(toMiraServerState(null)).toEqual(STANDBY)
    expect(toMiraServerState('nope')).toEqual(STANDBY)
    expect(toMiraServerState([])).toEqual(STANDBY)
  })

  it('treats missing or non-boolean flags as disabled', () => {
    expect(toMiraServerState({ tier: 'cache' })).toEqual({
      mode: 'lightweight',
      features: { diskCache: false, remoteColors: false, remoteBlur: false },
    })
    expect(
      toMiraServerState({
        tier: 'compute',
        disk_cache: 'yes',
        remote_colors: true,
        remote_blur: 1,
      }),
    ).toEqual({
      mode: 'compute',
      features: { diskCache: false, remoteColors: true, remoteBlur: false },
    })
  })
})

describe('useMiraServer', () => {
  beforeEach(() => {
    __resetMiraServerState()
  })

  it('loads the capabilities on mount and maps mode + features', async () => {
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('compute')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
  })

  it('maps a cache-tier response to lightweight mode', async () => {
    server.use(
      http.get('*/api/v1/capabilities', () =>
        HttpResponse.json({
          tier: 'cache',
          disk_cache: true,
          remote_colors: false,
          remote_blur: false,
        }),
      ),
    )
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('lightweight')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: false,
      remoteBlur: false,
    })
  })

  it('falls back to standalone when the Pi is offline', async () => {
    // the default MSW handler makes the capabilities request fail
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
  })

  it('falls back to standalone on a non-JSON response (parse error)', async () => {
    server.use(
      http.get(
        '*/api/v1/capabilities',
        () =>
          new HttpResponse('<html>gateway error</html>', {
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    warn.mockRestore()
  })

  it('falls back to standalone on a non-OK status', async () => {
    server.use(
      http.get('*/api/v1/capabilities', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    warn.mockRestore()
  })

  it('falls back to standalone when the request times out', async () => {
    // full fake timers (like homeassistant.test.ts): the MSW interceptor
    // resolves the request through microtasks, which advanceTimersByTimeAsync
    // only flushes reliably when the clock is fully faked
    vi.useFakeTimers()
    // a handler that never answers — only our 2.5s abort can end the request
    server.use(http.get('*/api/v1/capabilities', () => new Promise<Response>(() => {})))
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_TIMEOUT_MS)
    })
    expect(result.current.checking).toBe(false)
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
    unmount()
    vi.useRealTimers()
  })

  it('re-polls and picks up a Pi that comes online later', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    // offline at startup (default handler)
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    // the Pi is plugged in before the next poll tick
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    expect(result.current.mode).toBe('compute')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
    unmount()
    vi.useRealTimers()
  })

  it('degrades to standalone when the Pi goes away (re-poll failure)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('compute')
    // the Pi loses power before the next poll tick
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.error()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
    unmount()
    vi.useRealTimers()
  })

  it('re-checks on demand via checkMiraServer without waiting for the poll', async () => {
    // offline first (default handler)
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    await act(async () => {
      await checkMiraServer()
    })
    expect(result.current.mode).toBe('compute')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
  })

  it('keeps multiple hook instances in sync (shared store)', async () => {
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const first = renderHook(() => useMiraServer())
    const second = renderHook(() => useMiraServer())
    await waitFor(() => expect(first.result.current.mode).toBe('compute'))
    expect(second.result.current.mode).toBe('compute')
    expect(second.result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
  })

  it('polls while mounted and stops polling after unmount', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result, unmount } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), MIRA_SERVER_POLL_MS)
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})
