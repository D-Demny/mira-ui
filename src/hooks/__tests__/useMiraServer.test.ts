import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  MIRA_SERVER_POLL_MS,
  __onMiraServerEmit,
  __resetMiraServerState,
  checkMiraServer,
  getMiraServerState,
  useMiraServer,
  type MiraServerView,
} from '../useMiraServer'
import {
  fetchMiraServerCapabilities,
  MIRA_SERVER_TIMEOUT_MS,
  standaloneMiraServerState,
  toMiraServerState,
  type MiraServerCapabilities,
  type MiraServerState,
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
    // G1: an unchanged result (standalone→standalone) settles silently —
    // no emit — so the settle is observed via the live store read, not the
    // rendered checking flag
    await waitFor(() => expect(getMiraServerState().checking).toBe(false))
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
    await waitFor(() => expect(getMiraServerState().checking).toBe(false)) // G1: silent settle
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
    await waitFor(() => expect(getMiraServerState().checking).toBe(false)) // G1: silent settle
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
    // G1: the timeout settle (standalone→standalone) is silent — the
    // rendered checking flag is not re-published, the live store read is
    expect(getMiraServerState().checking).toBe(false)
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
    await waitFor(() => expect(getMiraServerState().checking).toBe(false)) // G1: silent settle
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
    const { unmount } = renderHook(() => useMiraServer())
    await waitFor(() => expect(getMiraServerState().checking).toBe(false)) // G1: silent settle
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

  it('a manual check while disabled (no profile) is returned but NOT published; the poll stays stopped', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    let hits = 0
    server.use(
      http.get('*/api/v1/capabilities', () => {
        hits += 1
        return HttpResponse.json(COMPUTE)
      }),
    )
    // the Deaktivieren end state: flag set, no profile — behaviorally
    // identical to "no profile" (targetIp null, no poll target)
    updateSettings({ hybridDisabled: true })
    const { result, unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // "Verbindung testen" — a deliberate user action, allowed while disabled
    // (KR4) — ticket10-7 G12: without an active profile the result is
    // RETURNED to the caller but NOT published to the shared store, so the
    // disabled end state stays a stable standalone
    let state: MiraServerState | null = null
    await act(async () => {
      state = await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    expect(state).toEqual({
      mode: 'compute',
      features: { diskCache: true, remoteColors: true, remoteBlur: true },
    })
    expect(getMiraServerState().mode).toBe('standalone')
    expect(result.current.mode).toBe('standalone')
    // the ambient poll never started: a full tick later, no request
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

describe('useMiraServer: emit guard (ticket10-7 G1)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    __resetMiraServerState()
  })

  // The store is subscribed at the root of the App (usePrefetch), so every
  // raw store emission re-renders the whole app tree. There is no app-level
  // re-render test (too large) — the emit count below is the proxy
  // assertion for the G1 goal: with a profile and a dead Pi exactly ONE
  // emission per 30 s poll tick (the checking:true flip), not two.
  // __onMiraServerEmit observes the raw emissions (listener set) without
  // the refcount/poll side effects of a hook subscription.

  it('publishes exactly once per poll cycle while the Pi is dead (checking flip only)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    setActiveProfile() // dead Pi: the default MSW handler fails the request
    const emitted: MiraServerView[] = []
    const unsubscribe = __onMiraServerEmit(() => {
      emitted.push({ ...getMiraServerState() })
    })
    const { unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // mount: one publish — the checking:true flip; the dead-Pi settle
    // (standalone→standalone) is suppressed
    expect(emitted).toEqual([
      { mode: 'standalone', features: STANDBY.features, checking: true },
    ])
    // three full poll cycles — exactly one publish per cycle (was 2 before G1)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }
    expect(emitted.length).toBe(4) // mount flip + exactly one per cycle
    for (const view of emitted) {
      expect(view.checking).toBe(true) // the flip is the only published state
      expect(view.mode).toBe('standalone')
    }
    unmount()
    unsubscribe()
    vi.useRealTimers()
  })

  it('still publishes a mode change as soon as the Pi answers (result carries the checking reset)', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    setActiveProfile()
    const emitted: MiraServerView[] = []
    const unsubscribe = __onMiraServerEmit(() => {
      emitted.push({ ...getMiraServerState() })
    })
    const { unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(emitted.length).toBe(1) // mount flip; the dead settle is suppressed
    // the Pi is plugged in before the next poll tick
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // the change-carrying result is published (flip + result = one more each)
    expect(emitted.length).toBe(3)
    expect(emitted[emitted.length - 1]).toEqual({
      mode: 'compute',
      features: { diskCache: true, remoteColors: true, remoteBlur: true },
      checking: false,
    })
    unmount()
    unsubscribe()
    vi.useRealTimers()
  })

  it('the checking flip is visible in the published state, once per cycle', async () => {
    vi.useFakeTimers(FAKE_CLOCK)
    setActiveProfile()
    let flipEmits = 0
    const unsubscribe = __onMiraServerEmit(() => {
      if (getMiraServerState().checking) flipEmits += 1
    })
    const { unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(flipEmits).toBe(1) // the mount check's flip
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRA_SERVER_POLL_MS)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(flipEmits).toBe(i + 2) // exactly one new flip publish per cycle
    }
    unmount()
    unsubscribe()
    vi.useRealTimers()
  })

  it('a manual check with an unchanged result updates the store but publishes only the flip', async () => {
    // documented decision (ticket10-7 D.1): checkMiraServer always WRITES
    // its result to the shared store (getMiraServerState after the await —
    // the settings UI reads it synchronously), but the listener
    // notification is gated like every other emit (G1). A changeless manual
    // result (dead Pi, standalone→standalone) publishes nothing beyond the
    // checking flip — consistent with the 10-5A "manual results reach the
    // shared store" contract and audit G12 (no visible deviation in the
    // usual case).
    vi.useFakeTimers(FAKE_CLOCK)
    setActiveProfile()
    const emitted: MiraServerView[] = []
    const unsubscribe = __onMiraServerEmit(() => {
      emitted.push({ ...getMiraServerState() })
    })
    const { unmount } = renderHook(() => useMiraServer())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(emitted.length).toBe(1) // mount flip; the dead settle is suppressed
    // "Verbindung testen" against the same dead Pi
    await act(async () => {
      await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(emitted.length).toBe(2) // the manual check's flip — no result publish
    expect(emitted[1].checking).toBe(true)
    // the store itself carries the settled result for synchronous readers
    expect(getMiraServerState()).toEqual({
      mode: 'standalone',
      features: STANDBY.features,
      checking: false,
    })
    unmount()
    unsubscribe()
    vi.useRealTimers()
  })
})

describe('useMiraServer: manual check without profile (ticket10-7 G12)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    __resetMiraServerState()
  })

  it('a successful manual check WITHOUT a profile does not publish to the shared store', async () => {
    // the audit scenario: a Pi answers at the default ip while no profile is
    // configured. Without a profile there is no ambient poll and no
    // retarget that would correct the state again, so the result must NOT
    // reach the shared store — the "Raspberry Pi" menu row would otherwise
    // keep showing a connected mode until the next settings write or app
    // restart. The result is returned to the caller instead.
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const emitted: MiraServerView[] = []
    const unsubscribe = __onMiraServerEmit(() => {
      emitted.push({ ...getMiraServerState() })
    })
    const { result, unmount } = renderHook(() => useMiraServer())
    let state: MiraServerState | null = null
    await act(async () => {
      state = await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    // the result is the compute state (the modal shows it locally)...
    expect(state).toEqual({
      mode: 'compute',
      features: { diskCache: true, remoteColors: true, remoteBlur: true },
    })
    // ...but the shared store is completely untouched: standalone, no
    // checking flip, zero emissions (no re-render at all)
    expect(getMiraServerState()).toEqual({
      mode: 'standalone',
      features: STANDBY.features,
      checking: false,
    })
    expect(result.current.mode).toBe('standalone')
    expect(emitted).toEqual([])
    unmount()
    unsubscribe()
  })

  it('a failed manual check without a profile returns standalone and keeps the store untouched', async () => {
    // the default handler answers an error — the check degrades to
    // standalone, which is also the store's state (the visible difference
    // to the success case above is only the returned state)
    const { result, unmount } = renderHook(() => useMiraServer())
    let state: MiraServerState | null = null
    await act(async () => {
      state = await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    expect(state).toEqual(STANDBY)
    expect(getMiraServerState()).toEqual({
      mode: 'standalone',
      features: STANDBY.features,
      checking: false,
    })
    expect(result.current.mode).toBe('standalone')
    unmount()
  })

  it('a manual check WITH an active profile still publishes to the store and returns the result', async () => {
    // behavior unchanged (10-5A contract): with a profile the manual result
    // reaches the shared store (the next ambient tick / retarget keeps it
    // current) AND is returned to the caller
    setActiveProfile()
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    const { result, unmount } = renderHook(() => useMiraServer())
    let state: MiraServerState | null = null
    await act(async () => {
      state = await checkMiraServer(DEFAULT_PROFILE_IP)
    })
    expect(state).toEqual({
      mode: 'compute',
      features: { diskCache: true, remoteColors: true, remoteBlur: true },
    })
    expect(getMiraServerState().mode).toBe('compute')
    expect(result.current.mode).toBe('compute')
    expect(result.current.features).toEqual({
      diskCache: true,
      remoteColors: true,
      remoteBlur: true,
    })
    unmount()
  })
})
