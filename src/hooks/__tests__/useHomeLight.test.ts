import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { __resetHomeLightStore, HOME_LIGHTS, useHomeLight, useHomeLights } from '../useHomeLight'

describe('useHomeLight', () => {
  beforeEach(() => {
    __resetHomeLightStore()
  })

  it('loads the light state on mount', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'on' }),
      ),
    )
    const { result } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state).toBe('on')
    expect(result.current.error).toBeNull()
  })

  it('sets an error when the state fetch fails', async () => {
    server.use(
      http.get(
        '*/ha-api/states/light.*',
        () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state).toBeNull()
    expect(result.current.error).toMatch(/401/)
    warn.mockRestore()
  })

  it('toggles optimistically and confirms with the service response', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' }),
      ),
      http.post('*/ha-api/services/light/toggle', () =>
        HttpResponse.json([
          { entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'on' },
        ]),
      ),
    )
    const { result } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.state).toBe('off'))
    act(() => {
      void result.current.toggle()
    })
    // optimistic flip lands before the request resolves
    expect(result.current.state).toBe('on')
    await waitFor(() => expect(result.current.toggling).toBe(false))
    expect(result.current.state).toBe('on')
    expect(result.current.error).toBeNull()
  })

  it('reverts the optimistic state when the toggle fails', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'on' }),
      ),
      http.post(
        '*/ha-api/services/light/toggle',
        () => HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.state).toBe('on'))
    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('off') // optimistic
    await waitFor(() => expect(result.current.toggling).toBe(false))
    expect(result.current.state).toBe('on') // reverted
    expect(result.current.error).toMatch(/500/)
    warn.mockRestore()
  })

  // bug57: same race class as useHomeEntities — a state read that starts
  // BEFORE the toggle must not clobber the optimistic flip — deterministic
  // replay: the state fetch is in flight (deferred), the toggle flips
  // optimistically, THEN the stale read resolves with the pre-toggle state
  // while the toggle answer is still pending (without the guard the store
  // flickers back to 'off' here)
  it('a stale read that started before the toggle cannot clobber the optimistic flip', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: LIGHT_ID, state: 'off' }),
      ),
    )
    const first = renderHook(() => useHomeLight())
    await waitFor(() => expect(first.result.current.state).toBe('off'))
    first.unmount()

    let releaseStaleRead: () => void = () => {}
    let releaseToggle: () => void = () => {}
    const staleReadPending = new Promise<void>((resolve) => {
      releaseStaleRead = resolve
    })
    const togglePending = new Promise<void>((resolve) => {
      releaseToggle = resolve
    })
    let staleReads = 0
    server.use(
      http.get('*/ha-api/states/light.*', async () => {
        staleReads += 1
        await staleReadPending
        return HttpResponse.json({ entity_id: LIGHT_ID, state: 'off' }) // STALE
      }),
      http.post('*/ha-api/services/light/toggle', async () => {
        await togglePending
        return HttpResponse.json([{ entity_id: LIGHT_ID, state: 'on' }])
      }),
    )

    const { result } = renderHook(() => useHomeLight())
    // the fresh read (same path as the 5s poll) is in flight and parked on
    // the deferred response — staleReads===1 is the in-flight proof (the
    // loading flag is not observable here: the mount refresh writes it
    // BEFORE the hook subscribes, so the render snapshot keeps the settled
    // value from the first instance)
    await waitFor(() => expect(staleReads).toBe(1))
    expect(result.current.state).toBe('off')

    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('on') // optimistic flip
    expect(result.current.toggling).toBe(true)

    // the stale read resolves NOW — with the pre-toggle state — while the
    // toggle answer is still pending: it must be discarded, no flicker
    act(() => {
      releaseStaleRead()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25)) // let the stale response reach the store
    })
    expect(result.current.state).toBe('on') // NOT clobbered back to 'off'
    expect(result.current.toggling).toBe(true)

    act(() => {
      releaseToggle()
    })
    await waitFor(() => expect(result.current.toggling).toBe(false))
    expect(result.current.state).toBe('on') // confirmed by the service answer
    expect(result.current.error).toBeNull()
  })

  it('keeps multiple hook instances in sync (shared store)', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' }),
      ),
      http.post('*/ha-api/services/light/toggle', () =>
        HttpResponse.json([
          { entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'on' },
        ]),
      ),
    )
    const first = renderHook(() => useHomeLight())
    const second = renderHook(() => useHomeLight())
    await waitFor(() => expect(first.result.current.state).toBe('off'))
    expect(second.result.current.state).toBe('off')
    act(() => {
      void first.result.current.toggle()
    })
    await waitFor(() => expect(first.result.current.toggling).toBe(false))
    expect(first.result.current.state).toBe('on')
    // the other instance (e.g. MainMenuView while HomeMenuView toggled) sees it
    expect(second.result.current.state).toBe('on')
  })

  it('resyncs external changes via refetch', async () => {
    let serveState = 'off'
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: serveState }),
      ),
    )
    const { result } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.state).toBe('off'))
    // the light was switched from the phone — refetch picks it up
    serveState = 'on'
    act(() => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.state).toBe('on'))
  })

  it('keeps different entities in the shared store independent', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', ({ request }) => {
        const id = request.url.split('/').pop() ?? ''
        return HttpResponse.json({
          entity_id: id,
          state: id === 'light.esstisch_hangelampe_3er' ? 'on' : 'off',
        })
      }),
    )
    const first = renderHook(() => useHomeLight())
    const second = renderHook(() => useHomeLight('light.esstisch_hangelampe_3er'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(first.result.current.state).toBe('off')
    expect(second.result.current.state).toBe('on')
  })

  it('exposes every menu light via useHomeLights and toggles them independently', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.esstisch_hangelampe_3er', state: 'off' }),
      ),
      http.post('*/ha-api/services/light/toggle', () =>
        HttpResponse.json([{ entity_id: 'light.esstisch_hangelampe_3er', state: 'on' }]),
      ),
    )
    const { result } = renderHook(() => useHomeLights())
    await waitFor(() =>
      expect(result.current.every((l) => !l.loading)).toBe(true),
    )
    expect(result.current.map((l) => l.entityId)).toEqual(HOME_LIGHTS.map((l) => l.entityId))
    expect(result.current[1].label).toBe('Esstisch Hängelampe')
    act(() => {
      result.current[1].toggle()
    })
    await waitFor(() => expect(result.current[1].toggling).toBe(false))
    expect(result.current[1].state).toBe('on')
    expect(result.current[0].state).toBe('off')
  })

  // bug57 v2: the poll interval is 3s (was 5s); the poll runs while a
  // consumer is mounted (the light-control popup — mounted = visible), so
  // it is already gated on visibility by the mount/subscription
  it('polls the state every 3s while mounted and stops polling after unmount', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' }),
      ),
    )
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result, unmount } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000)
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  // bug57 v2: same race class as useHomeEntities — a poll read that starts
  // AFTER the optimistic flip (the v1 revision check lets it through) but
  // while the toggle's service call is still in flight fetches HA's state
  // BEFORE the POST is processed (still the pre-toggle state) and would
  // clobber the flip.
  it('a poll read that starts during an in-flight toggle cannot clobber the flip (bug57 v2)', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    vi.useFakeTimers()
    let stateGets = 0
    let releasePollRead: () => void = () => {}
    const pollReadPending = new Promise<void>((resolve) => {
      releasePollRead = resolve
    })
    let releaseToggle: () => void = () => {}
    const togglePending = new Promise<void>((resolve) => {
      releaseToggle = resolve
    })
    server.use(
      http.get('*/ha-api/states/light.*', async () => {
        stateGets += 1
        if (stateGets === 1) {
          // the mount fetch — instant
          return HttpResponse.json({ entity_id: LIGHT_ID, state: 'off' })
        }
        // the poll GET — deferred, and HA has not processed the POST yet
        await pollReadPending
        return HttpResponse.json({ entity_id: LIGHT_ID, state: 'off' })
      }),
      http.post('*/ha-api/services/light/toggle', async () => {
        await togglePending
        return HttpResponse.json([{ entity_id: LIGHT_ID, state: 'on' }])
      }),
    )

    const { result, unmount } = renderHook(() => useHomeLight())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('off')
    expect(stateGets).toBe(1) // the mount fetch

    // toggle: off → on, the POST is slow
    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('on') // optimistic flip
    expect(result.current.toggling).toBe(true)

    // the 3s poll tick fires while the POST is still in flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(stateGets).toBe(2) // the poll GET went out during the toggle

    // the stale poll answer arrives — it MUST be discarded, the store stays
    // at the flipped value
    act(() => {
      releasePollRead()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on') // NOT clobbered back to 'off'
    expect(result.current.toggling).toBe(true)

    // the toggle answer arrives — confirms 'on'
    act(() => {
      releaseToggle()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on')
    expect(result.current.toggling).toBe(false)
    expect(result.current.error).toBeNull()
    unmount()
    vi.useRealTimers()
  })

  // bug57 v3: the Build #110 mid-fade flicker — HA keeps reporting the
  // PRE-flip state while the light is still fading, so even the toggle's
  // OWN service answer can carry the old state (v1/v2 let it through: it
  // starts after the flip and after the settlement). The transition hold
  // discards that divergent report within 1500 ms of the flip and a single
  // confirming re-read at the window's end lands the true post-fade state —
  // without waiting for the next 3 s poll.
  it('a mid-fade service answer is held back and a confirming re-read lands at hold end (bug57 v3)', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    vi.useFakeTimers()
    let stateGets = 0
    let releaseToggle: () => void = () => {}
    const togglePending = new Promise<void>((resolve) => {
      releaseToggle = resolve
    })
    server.use(
      http.get('*/ha-api/states/light.*', () => {
        stateGets += 1
        // GET#1 (mount): the pre-flip state. GET#2 (the confirming re-read
        // at the hold's end): the fade is done, the light really is off
        return HttpResponse.json({ entity_id: LIGHT_ID, state: stateGets === 1 ? 'on' : 'off' })
      }),
      http.post('*/ha-api/services/light/toggle', async () => {
        await togglePending
        // mid-fade: HA has processed the POST but still reports the
        // pre-flip state
        return HttpResponse.json([{ entity_id: LIGHT_ID, state: 'on' }])
      }),
    )

    const { result, unmount } = renderHook(() => useHomeLight())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on')
    expect(stateGets).toBe(1)

    // flip on → off
    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('off') // optimistic flip
    expect(result.current.toggling).toBe(true)

    // the service answer arrives ~500 ms in — still mid-fade ('on')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    act(() => {
      releaseToggle()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // without the hold it would flicker back to 'on' here
    expect(result.current.state).toBe('off')
    expect(result.current.toggling).toBe(false)

    // nothing else may be fetched yet — exactly ONE confirming re-read,
    // firing at the window's end (t = 1500)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(stateGets).toBe(1)
    expect(result.current.state).toBe('off')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700) // → t = 1600, the re-read lands
    })
    expect(stateGets).toBe(2)
    expect(result.current.state).toBe('off') // confirmed post-fade

    unmount()
    vi.useRealTimers()
  })

  // bug57 v3: the hold must NOT over-block — a divergent value reported
  // AFTER the 1500 ms window (a genuine external change, e.g. the next 3 s
  // poll) lands normally
  it('a divergent read after the hold window still lands (external change, bug57 v3)', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    vi.useFakeTimers()
    let stateGets = 0
    server.use(
      http.get('*/ha-api/states/light.*', () => {
        stateGets += 1
        // GET#1 (mount): 'on'. GET#2 (the 3 s poll, after the hold expired):
        // externally switched on again during the fade
        return HttpResponse.json({ entity_id: LIGHT_ID, state: 'on' })
      }),
      http.post('*/ha-api/services/light/toggle', () =>
        // the service answer already carries the flipped state ('off'), so
        // it lands as an in-hold confirmation — no confirming re-read is
        // scheduled (the test isolates the post-window poll path)
        HttpResponse.json([{ entity_id: LIGHT_ID, state: 'off' }]),
      ),
    )

    const { result, unmount } = renderHook(() => useHomeLight())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on')
    expect(stateGets).toBe(1)

    // flip on → off — the service answer confirms 'off' instantly (in-hold,
    // equal to the target → lands as confirmation)
    act(() => {
      void result.current.toggle()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('off') // confirmed
    expect(result.current.toggling).toBe(false)

    // the 3 s poll tick (t = 3000, AFTER the 1500 ms hold) serves the
    // external 'on' — it must land (self-correction)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(stateGets).toBe(2)
    expect(result.current.state).toBe('on')

    unmount()
    vi.useRealTimers()
  })

  // bug57 v3: an external change that happens DURING the hold (wall switch /
  // phone) is picked up by the confirming re-read at the window's end — no
  // waiting for the next 3 s poll
  it('an external change during the hold lands via the confirming re-read (bug57 v3)', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    vi.useFakeTimers()
    let stateGets = 0
    let releaseToggle: () => void = () => {}
    const togglePending = new Promise<void>((resolve) => {
      releaseToggle = resolve
    })
    server.use(
      http.get('*/ha-api/states/light.*', () => {
        stateGets += 1
        // the light is really ON (pre-flip 'on', and externally switched on
        // again mid-fade)
        return HttpResponse.json({ entity_id: LIGHT_ID, state: 'on' })
      }),
      http.post('*/ha-api/services/light/toggle', async () => {
        await togglePending
        // mid-fade: HA still reports the pre-flip state ('on')
        return HttpResponse.json([{ entity_id: LIGHT_ID, state: 'on' }])
      }),
    )

    const { result, unmount } = renderHook(() => useHomeLight())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on')
    expect(stateGets).toBe(1)

    // flip on → off (the user wanted it off)
    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('off') // optimistic flip

    // the service answer arrives ~500 ms in — mid-fade, still 'on'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    act(() => {
      releaseToggle()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('off') // held back, no flicker

    // ~800 ms in: the user flips it back on at the wall — a fresh read (the
    // light-control popup re-opens) reports 'on' — divergent within the hold
    // → held back as well (the confirming re-read is deduped)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300) // → t = 800
    })
    act(() => {
      result.current.refetch()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(stateGets).toBe(2)
    expect(result.current.state).toBe('off') // still held

    // at the window's end (t = 1500) the confirming re-read lands 'on' —
    // the external change is adopted right after the hold
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(stateGets).toBe(3)
    expect(result.current.state).toBe('on')

    unmount()
    vi.useRealTimers()
  })

  // bug57 v3: a value equal to the flipped target is a confirmation — it
  // lands immediately AND cancels the pending confirming re-read (no
  // redundant fetch at the window's end)
  it('a confirming read before the hold ends cancels the pending re-read (bug57 v3)', async () => {
    const LIGHT_ID = HOME_LIGHTS[0].entityId
    vi.useFakeTimers()
    let stateGets = 0
    let releaseToggle: () => void = () => {}
    const togglePending = new Promise<void>((resolve) => {
      releaseToggle = resolve
    })
    server.use(
      http.get('*/ha-api/states/light.*', () => {
        stateGets += 1
        // GET#1 (mount): 'on'. GET#2 (the refetch at ~800 ms): the fade
        // finished early — the flipped state is confirmed
        return HttpResponse.json({ entity_id: LIGHT_ID, state: stateGets === 1 ? 'on' : 'off' })
      }),
      http.post('*/ha-api/services/light/toggle', async () => {
        await togglePending
        // mid-fade: still the pre-flip state
        return HttpResponse.json([{ entity_id: LIGHT_ID, state: 'on' }])
      }),
    )

    const { result, unmount } = renderHook(() => useHomeLight())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('on')

    // flip on → off
    act(() => {
      void result.current.toggle()
    })
    expect(result.current.state).toBe('off') // optimistic flip

    // the service answer arrives ~500 ms in — mid-fade ('on'): held back, a
    // confirming re-read is scheduled for t = 1500
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    act(() => {
      releaseToggle()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toBe('off') // held back, no flicker

    // ~800 ms in: a fresh read confirms 'off' — it lands AND cancels the
    // pending re-read
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300) // → t = 800
    })
    act(() => {
      result.current.refetch()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(stateGets).toBe(2)
    expect(result.current.state).toBe('off')

    // past the window's end (and well before the next 3 s poll tick at
    // t = 3000): no further fetch happens — the re-read was cancelled
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500) // → t = 2300
    })
    expect(stateGets).toBe(2)
    expect(result.current.state).toBe('off')

    unmount()
    vi.useRealTimers()
  })

  it('has unique entity ids in HOME_LIGHTS', () => {
    const ids = HOME_LIGHTS.map((l) => l.entityId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
