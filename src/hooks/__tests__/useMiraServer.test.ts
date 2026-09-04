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
  fetchMiraServerCapabilities,
  MIRA_SERVER_TIMEOUT_MS,
  standaloneMiraServerState,
  toMiraServerState,
  type MiraServerCapabilities,
} from '@/api/miraServer'
import { __resetSettings, getSettings, updateSettings } from '@/settings'

const STANDBY = standaloneMiraServerState()

// ticket10-5A: the poll only runs for the ip of an ACTIVE profile — the
// mount tests seed one (fresh installs have none and stay standalone
// WITHOUT polling, which is asserted in its own test below)
const DEFAULT_PROFILE_IP = '192.168.7.1'

function setActiveProfile(ip: string = DEFAULT_PROFILE_IP): void {
  updateSettings({
    piProfiles: [
      { id: 'pi-1', label: 'Pi 1', ip, user: 'root', password: '', keyInstalled: false },
    ],
    activePiId: 'pi-1',
  })
}

const COMPUTE: MiraServerCapabilities = {
  tier: 'compute',
  disk_cache: true,
  remote_colors: true,
  remote_blur: true,
}

const CACHE: MiraServerCapabilities = {
  tier: 'cache',
  disk_cache: true,
  remote_colors: false,
  remote_blur: false,
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
    localStorage.clear()
    __resetSettings()
    __resetMiraServerState()
  })

  it('stays standalone WITHOUT polling while no profile is configured (fresh install)', () => {
    // ticket10-5A: no active profile → no capabilities target, no request
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { result } = renderHook(() => useMiraServer())
    expect(result.current.mode).toBe('standalone')
    expect(result.current.checking).toBe(false)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), MIRA_SERVER_POLL_MS)
    setIntervalSpy.mockRestore()
  })

  it('loads the capabilities on mount and maps mode + features', async () => {
    setActiveProfile()
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
    setActiveProfile()
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
    setActiveProfile()
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
  })

  it('falls back to standalone on a non-JSON response (parse error)', async () => {
    setActiveProfile()
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
    setActiveProfile()
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
    setActiveProfile()
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
    setActiveProfile()
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
    setActiveProfile()
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
    setActiveProfile()
    // offline first (default handler)
    const { result } = renderHook(() => useMiraServer())
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.mode).toBe('standalone')
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    await act(async () => {
      await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    expect(result.current.mode).toBe('compute')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
  })

  it('checkMiraServer(ip) pings the custom ip instead of the active profile', async () => {
    // only the custom address answers — the active profile stays offline.
    // Fake timers before the render so the poll interval is a fake timer too.
    vi.useFakeTimers(FAKE_CLOCK)
    setActiveProfile()
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const host = new URL(request.url).hostname
        return host === '10.9.8.7' ? HttpResponse.json(COMPUTE) : HttpResponse.error()
      }),
    )
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    await act(async () => {
      await checkMiraServer('10.9.8.7')
    })
    expect(result.current.mode).toBe('compute')
    // the poll (active profile) is unaffected: a tick later it is offline
    // again (the extra 0-drain settles the poll request's resolution)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    unmount()
    vi.useRealTimers()
  })

  it('a manual re-check for a custom ip does not join the in-flight poll', async () => {
    // the mount-time check targets the active profile's address (offline
    // here); the custom address answers. The re-check is issued
    // synchronously while that check is still in flight — joining it would
    // report the profile's (offline) result instead of the custom ip's
    setActiveProfile()
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const host = new URL(request.url).hostname
        return host === '10.9.8.7' ? HttpResponse.json(COMPUTE) : HttpResponse.error()
      }),
    )
    const { result } = renderHook(() => useMiraServer())
    const pending = checkMiraServer('10.9.8.7')
    await act(async () => {
      await pending
    })
    expect(result.current.mode).toBe('compute')
  })

  it('fetchMiraServerCapabilities targets http://<ip>:8080 for a custom ip', async () => {
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const url = new URL(request.url)
        return url.origin === 'http://10.9.8.7:8080' ? HttpResponse.json(CACHE) : HttpResponse.error()
      }),
    )
    const state = await fetchMiraServerCapabilities('10.9.8.7')
    expect(state.mode).toBe('lightweight')
  })

  it('keeps multiple hook instances in sync (shared store)', async () => {
    setActiveProfile()
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
    setActiveProfile()
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

describe('useMiraServer: active profile targeting (ticket10-5A)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    __resetMiraServerState()
  })

  it('starts the poll when a profile appears while mounted', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    // the user saves the first profile (wizard / settings) — the poll
    // must start for its ip immediately, without a poll-tick wait
    setActiveProfile()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('compute')
    unmount()
    vi.useRealTimers()
  })

  it('re-targets the poll when the active profile switches', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    // A answers with compute, B with cache — after the switch the mode can
    // only be 'lightweight' if the request really went to B
    server.use(
      http.get('*/api/v1/capabilities', ({ request }) => {
        const host = new URL(request.url).hostname
        if (host === '10.0.0.1') return HttpResponse.json(COMPUTE)
        if (host === '10.0.0.2') return HttpResponse.json(CACHE)
        return HttpResponse.error()
      }),
    )
    setActiveProfile('10.0.0.1')
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('compute')
    // switch the active profile — the new ip must be pinged (not A)
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '10.0.0.1', user: 'root', password: '', keyInstalled: false },
        { id: 'pi-2', label: 'Pi 2', ip: '10.0.0.2', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-2',
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('lightweight')
    // the poll now targets B: a tick later it still reports B's tier
    // (hitting A again would keep the mode 'compute')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('lightweight')
    unmount()
    vi.useRealTimers()
  })

  it('degrades to standalone and stops polling when all profiles are removed', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    setActiveProfile()
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('compute')
    const hitsAfterMount = hits
    expect(hitsAfterMount).toBeGreaterThan(0)
    // the last profile is removed (deletion UI arrives with 10-5C)
    updateSettings({ piProfiles: [], activePiId: null })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    // the poll is stopped: a full tick later there is no new request
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hits).toBe(hitsAfterMount)
    unmount()
    vi.useRealTimers()
  })
})

describe('useMiraServer: hybridDisabled (ticket10-7 KR4)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    __resetMiraServerState()
  })

  it('with a profile, the flag stops the poll and forces standalone (no requests per tick)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    setActiveProfile()
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('compute')
    const hitsWhileActive = hits
    expect(hitsWhileActive).toBeGreaterThan(0)
    // the Deaktivieren flag is set while the profile still exists
    updateSettings({ hybridDisabled: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // exactly the no-profile state: standalone, all features false
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
    // a mere coexistence of flag + existing profile must NOT clear the flag
    expect(getSettings().hybridDisabled).toBe(true)
    // the poll is stopped: several full 30 s ticks produce zero requests
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hits).toBe(hitsWhileActive)
    unmount()
    vi.useRealTimers()
  })

  it('creating a profile while disabled clears the flag and re-starts the poll', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    // the Deaktivieren end state: flag set, no profile
    updateSettings({ hybridDisabled: true })
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    expect(hits).toBe(0)
    // the user creates a profile while hybrid is disabled (wizard mount,
    // add button and lazy keyboard creation all land here as a plain
    // profile write)
    setActiveProfile()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // the hook cleared the flag (settings write) and re-activated hybrid
    expect(getSettings().hybridDisabled).toBe(false)
    expect(result.current.mode).toBe('compute')
    expect(hits).toBeGreaterThan(0)
    // and the ambient poll runs again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hits).toBe(2)
    expect(result.current.mode).toBe('compute')
    unmount()
    vi.useRealTimers()
  })

  it('the clearing write does not loop (one settings PUT, stable request counter)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    let settingsPuts = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
      http.put('*/settings', () => {
        settingsPuts += 1
        return HttpResponse.json({ ok: true })
      }),
    )
    updateSettings({ hybridDisabled: true })
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    setActiveProfile()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getSettings().hybridDisabled).toBe(false)
    expect(result.current.mode).toBe('compute')
    const hitsAfterClear = hits
    // three full poll cycles (all debounce windows included): only the
    // ambient poll may grow the counter, no clearing write may re-fire
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    expect(hits).toBe(hitsAfterClear + 3)
    // profile write + clearing write coalesce into a single daemon PUT
    expect(settingsPuts).toBe(1)
    expect(getSettings().hybridDisabled).toBe(false)
    unmount()
    vi.useRealTimers()
  })

  it('no profile + disabled behaves exactly like no profile (standalone regression)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    updateSettings({ hybridDisabled: true })
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.mode).toBe('standalone')
    expect(result.current.features).toEqual(STANDBY.features)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    expect(hits).toBe(0) // like a fresh standalone: zero ambient requests
    // unmount + remount stays quiet too (no profile = no poll target)
    unmount()
    const second = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hits).toBe(0)
    expect(second.result.current.mode).toBe('standalone')
    second.unmount()
    vi.useRealTimers()
  })

  it('a manual check while disabled is published, but the poll stays stopped', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    updateSettings({ hybridDisabled: true })
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // "Verbindung testen" — a deliberate user action, allowed while disabled
    await act(async () => {
      await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    // the result is published to the shared store...
    expect(result.current.mode).toBe('compute')
    // ...but the ambient poll never started: a full tick later, no request
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(hits).toBe(1)
    unmount()
    vi.useRealTimers()
  })
})
