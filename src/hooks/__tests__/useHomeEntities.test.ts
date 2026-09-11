import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  SELECTION_LS_KEY,
  __homeEntityStoreStats,
  __resetHomeEntityStores,
  useHomeEntityCatalog,
  useHomeEntitySelection,
  useHomeSelectedEntities,
} from '../useHomeEntities'
import { HOME_LIGHTS } from '../useHomeLight'

const FIRST_LIGHT = HOME_LIGHTS[0].entityId
const SWITCH = 'switch.wasserpumpe'
const SCENE = 'scene.abendstimmung'
const MEDIA = 'media_player.wohnzimmer'

function seedSelection(ids: string[]) {
  localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(ids))
}

// the default MSW catalog fixture carries 9 lights + 6 controllable non-lights
// (the sensor is filtered out)
const CATALOG_SIZE = 15

describe('useHomeEntities', () => {
  beforeEach(() => {
    __resetHomeEntityStores()
    localStorage.clear()
  })

  describe('selection', () => {
    it('defaults to the HOME_LIGHTS when nothing is persisted', () => {
      const { result } = renderHook(() => useHomeEntitySelection())
      expect(result.current.selectedIds).toEqual(HOME_LIGHTS.map((l) => l.entityId))
      expect(result.current.isSelected(FIRST_LIGHT)).toBe(true)
      expect(result.current.isSelected(SWITCH)).toBe(false)
      expect(result.current.isCustomized).toBe(false)
    })

    it('toggle appends a new id to the end (insertion order)', () => {
      const { result } = renderHook(() => useHomeEntitySelection())
      act(() => {
        result.current.toggle(SWITCH)
      })
      expect(result.current.selectedIds).toHaveLength(HOME_LIGHTS.length + 1)
      expect(result.current.selectedIds[result.current.selectedIds.length - 1]).toBe(SWITCH)
      expect(result.current.isCustomized).toBe(true)
    })

    it('toggle removes an existing id', () => {
      const { result } = renderHook(() => useHomeEntitySelection())
      act(() => {
        result.current.toggle(FIRST_LIGHT)
      })
      expect(result.current.selectedIds).toHaveLength(HOME_LIGHTS.length - 1)
      expect(result.current.selectedIds).not.toContain(FIRST_LIGHT)
    })

    it('persists the selection on toggle (valid JSON in localStorage)', () => {
      const { result } = renderHook(() => useHomeEntitySelection())
      act(() => {
        result.current.toggle(SWITCH)
      })
      const raw = localStorage.getItem(SELECTION_LS_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(String(raw))).toEqual([...HOME_LIGHTS.map((l) => l.entityId), SWITCH])
    })

    it('loads a valid persisted selection', () => {
      seedSelection([SWITCH, SCENE])
      const { result } = renderHook(() => useHomeEntitySelection())
      expect(result.current.selectedIds).toEqual([SWITCH, SCENE])
      expect(result.current.isCustomized).toBe(true)
    })

    it('drops duplicates while loading a persisted selection', () => {
      seedSelection(['light.a', 'light.a', 'light.b'])
      const { result } = renderHook(() => useHomeEntitySelection())
      expect(result.current.selectedIds).toEqual(['light.a', 'light.b'])
    })

    it('falls back to the default on corrupt storage (without persisting)', () => {
      const defaults = HOME_LIGHTS.map((l) => l.entityId)
      for (const corrupt of ['{oops', '"not-an-array"', '[1, "light.a"]']) {
        localStorage.setItem(SELECTION_LS_KEY, corrupt)
        __resetHomeEntityStores()
        const { result } = renderHook(() => useHomeEntitySelection())
        expect(result.current.selectedIds).toEqual(defaults)
        expect(result.current.isCustomized).toBe(false)
      }
    })

    it('reset restores the default and persists it', () => {
      const { result } = renderHook(() => useHomeEntitySelection())
      act(() => {
        result.current.toggle(SWITCH)
      })
      act(() => {
        result.current.reset()
      })
      expect(result.current.selectedIds).toEqual(HOME_LIGHTS.map((l) => l.entityId))
      expect(result.current.isCustomized).toBe(false)
      expect(JSON.parse(String(localStorage.getItem(SELECTION_LS_KEY)))).toEqual(
        HOME_LIGHTS.map((l) => l.entityId),
      )
    })
  })

  describe('catalog', () => {
    it('fetches the catalog on mount and filters/sorts the domains', async () => {
      const { result } = renderHook(() => useHomeEntityCatalog())
      await waitFor(() => expect(result.current.entries.length).toBe(CATALOG_SIZE))
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
      // sensor is filtered out, all controllable domains are present
      const ids = result.current.entries.map((e) => e.entityId)
      expect(ids).not.toContain('sensor.temperatur_wohnzimmer')
      expect(ids).toContain(SWITCH)
      expect(ids).toContain(SCENE)
      expect(ids).toContain(MEDIA)
      expect(ids).toContain(FIRST_LIGHT)
      // labels come from the fixture friendly_names
      const pump = result.current.entries.find((e) => e.entityId === SWITCH)
      expect(pump?.label).toBe('Wasserpumpe')
      const primary = result.current.entries.find((e) => e.entityId === FIRST_LIGHT)
      expect(primary?.label).toBe('3er Stehlampe Gold')
      // active mapping (fixture states: lights off, scene none, media idle)
      expect(pump?.active).toBe(false)
      expect(result.current.entries.find((e) => e.entityId === SCENE)?.active).toBeNull()
      expect(result.current.entries.find((e) => e.entityId === MEDIA)?.active).toBe(false)
      // lights come first (domain priority)
      expect(result.current.entries[0].domain).toBe('light')
    })

    it('serves mounts inside the TTL from the cache (no second fetch)', async () => {
      const realNow = Date.now
      let fakeNow = realNow()
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
      let calls = 0
      try {
        server.use(
          http.get('*/ha-api/states', () => {
            calls += 1
            return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }]) // bug55: HA array contract
          }),
        )
        const first = renderHook(() => useHomeEntityCatalog())
        await waitFor(() => expect(calls).toBe(1))
        first.unmount()

        const second = renderHook(() => useHomeEntityCatalog())
        await waitFor(() => expect(second.result.current.entries.length).toBe(1))
        expect(calls).toBe(1) // served from the TTL cache
        second.unmount()
        // give a (buggy) in-flight second fetch a chance to arrive
        await new Promise((r) => setTimeout(r, 50))
        expect(calls).toBe(1)

        fakeNow += 61_000 // beyond the 60s TTL
        const third = renderHook(() => useHomeEntityCatalog())
        await waitFor(() => expect(calls).toBe(2))
        third.unmount()
      } finally {
        nowSpy.mockRestore()
      }
    })

    it('refetch forces a fresh fetch inside the TTL', async () => {
      let calls = 0
      server.use(
        http.get('*/ha-api/states', () => {
          calls += 1
          return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }]) // bug55: HA array contract
        }),
      )
      const { result } = renderHook(() => useHomeEntityCatalog())
      await waitFor(() => expect(calls).toBe(1))
      act(() => {
        result.current.refetch()
      })
      await waitFor(() => expect(calls).toBe(2))
      await waitFor(() => expect(result.current.loading).toBe(false))
    })

    // bug53: the picker's "Erneut versuchen" while the endpoint is STILL
    // failing — the retry issues a fresh request (no reused rejected
    // promise, no stale loading state), the error persists, and the moment
    // the endpoint is healthy a retry loads the catalog
    it('retry while the endpoint still fails: fresh request, error persists, recovers when healthy', async () => {
      let calls = 0
      let failing = true
      server.use(
        http.get('*/ha-api/states', () => {
          calls += 1
          return failing
            ? HttpResponse.json({ message: 'boom' }, { status: 500 })
            : HttpResponse.json([{ entity_id: SWITCH, state: 'off' }]) // bug55: HA array contract
        }),
      )
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { result } = renderHook(() => useHomeEntityCatalog())
        await waitFor(() => expect(calls).toBe(1))
        await waitFor(() => expect(result.current.error).toMatch(/500/))
        expect(result.current.entries).toEqual([])
        expect(result.current.loading).toBe(false)

        // retry #1 — the endpoint is still failing: a FRESH request is
        // issued (count 2) and the error state persists
        act(() => {
          result.current.refetch()
        })
        await waitFor(() => expect(calls).toBe(2))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).toMatch(/500/)
        expect(result.current.entries).toEqual([])

        // the endpoint heals → retry #2 loads the catalog
        failing = false
        act(() => {
          result.current.refetch()
        })
        await waitFor(() => expect(calls).toBe(3))
        await waitFor(() => expect(result.current.entries.length).toBe(1))
        expect(result.current.error).toBeNull()
        expect(result.current.entries[0].entityId).toBe(SWITCH)
      } finally {
        warn.mockRestore()
      }
    })

    it('keeps the old entries when the fetch fails', async () => {
      const realNow = Date.now
      let fakeNow = realNow()
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
      let fail = false
      server.use(
        http.get('*/ha-api/states', () =>
          fail
            ? HttpResponse.json({ message: 'boom' }, { status: 500 })
            : HttpResponse.json([{ entity_id: SWITCH, state: 'off' }]) // bug55: HA array contract,
        ),
      )
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { result } = renderHook(() => useHomeEntityCatalog())
        await waitFor(() => expect(result.current.entries.length).toBe(1))
        fail = true
        fakeNow += 61_000
        act(() => {
          result.current.refetch()
        })
        await waitFor(() => expect(result.current.error).not.toBeNull())
        expect(result.current.error).toMatch(/500/)
        expect(result.current.entries.length).toBe(1) // old entries kept
        expect(result.current.entries[0].entityId).toBe(SWITCH)
        expect(result.current.loading).toBe(false)
      } finally {
        nowSpy.mockRestore()
        warn.mockRestore()
      }
    })
  })

  describe('useHomeSelectedEntities', () => {
    it('keeps the selection order and resolves labels (curated > catalog > humanized)', async () => {
      const selection = [MEDIA, 'switch.foobar_baz', FIRST_LIGHT]
      seedSelection(selection)
      server.use(
        http.get('*/ha-api/states/media_player.wohnzimmer', () =>
          HttpResponse.json({ entity_id: MEDIA, state: 'idle' }),
        ),
        http.get('*/ha-api/states/switch.foobar_baz', () =>
          HttpResponse.json({ entity_id: 'switch.foobar_baz', state: 'off' }),
        ),
      )
      // seed the shared catalog store (the picker's hook would do this in the app)
      const catalog = renderHook(() => useHomeEntityCatalog())
      await waitFor(() => expect(catalog.result.current.entries.length).toBeGreaterThan(0))
      catalog.unmount()

      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      expect(result.current.map((v) => v.entityId)).toEqual(selection)
      // catalog label (the humanized label would be 'Wohnzimmer')
      expect(result.current[0].label).toBe('TV Wohnzimmer')
      expect(result.current[0].domain).toBe('media_player')
      expect(result.current[0].room).toBeUndefined()
      expect(result.current[0].state).toBe('idle')
      expect(result.current[0].active).toBe(false)
      // not in the catalog → humanized from the entity id
      expect(result.current[1].label).toBe('Foobar Baz')
      // curated HOME_LIGHTS label + room win over the catalog
      expect(result.current[2].label).toBe('3er Stehlampe Gold')
      expect(result.current[2].room).toBe('Esszimmer')
      expect(result.current[2].domain).toBe('light')
    })

    it('marks dimmable + brightnessPct only for lights', async () => {
      seedSelection([FIRST_LIGHT, SWITCH])
      server.use(
        http.get('*/ha-api/states/light.*', ({ request }) => {
          const id = decodeURIComponent(
            new URL(request.url).pathname.split('/').pop() ?? '',
          )
          return HttpResponse.json({
            entity_id: id,
            state: 'off',
            attributes: { supported_color_modes: ['color_temp', 'xy'], brightness: 255 },
          })
        }),
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: 'off' }),
        ),
      )
      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      expect(result.current[0].dimmable).toBe(true)
      expect(result.current[0].brightnessPct).toBe(100)
      expect(result.current[1].dimmable).toBe(false)
      expect(result.current[1].brightnessPct).toBeNull()
    })

    it('actuates optimistically and confirms with the service response', async () => {
      seedSelection([SWITCH])
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: 'off' }),
        ),
      )
      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current[0].state).toBe('off'))
      act(() => {
        result.current[0].actuate()
      })
      // optimistic flip lands before the request resolves
      expect(result.current[0].actuating).toBe(true)
      expect(result.current[0].state).toBe('on')
      await waitFor(() => expect(result.current[0].actuating).toBe(false))
      expect(result.current[0].state).toBe('on') // echoed by the service response
      expect(result.current[0].error).toBeNull()
      expect(result.current[0].active).toBe(true)
    })

    it('reverts the optimistic state when the service call fails', async () => {
      seedSelection([SWITCH])
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: 'off' }),
        ),
        http.post(
          '*/ha-api/services/switch/toggle',
          () => HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      )
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { result } = renderHook(() => useHomeSelectedEntities())
        await waitFor(() => expect(result.current[0].state).toBe('off'))
        act(() => {
          result.current[0].actuate()
        })
        expect(result.current[0].state).toBe('on') // optimistic
        await waitFor(() => expect(result.current[0].actuating).toBe(false))
        expect(result.current[0].state).toBe('off') // reverted
        expect(result.current[0].error).toMatch(/500/)
      } finally {
        warn.mockRestore()
      }
    })

    // bug57: a read that started BEFORE the press must not clobber the
    // optimistic flip — deterministic replay: the state fetch is in flight
    // (deferred), the press flips optimistically, THEN the stale read
    // resolves with the pre-press state while the toggle answer is still
    // pending (without the guard the store flickers back to 'off' here)
    it('a stale read that started before the press cannot clobber the optimistic flip', async () => {
      seedSelection([SWITCH])
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: 'off' }),
        ),
      )
      const first = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(first.result.current[0].state).toBe('off'))
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
        http.get('*/ha-api/states/switch.wasserpumpe', async () => {
          staleReads += 1
          await staleReadPending
          return HttpResponse.json({ entity_id: SWITCH, state: 'off' }) // STALE
        }),
        http.post('*/ha-api/services/switch/toggle', async () => {
          await togglePending
          return HttpResponse.json([{ entity_id: SWITCH, state: 'on' }])
        }),
      )

      const { result } = renderHook(() => useHomeSelectedEntities())
      // the fresh read (the mount fetch runs the same path as the 5s poll)
      // is in flight and parked on the deferred response — staleReads===1
      // is the in-flight proof (the loading flag is not observable here:
      // the mount refresh writes it BEFORE the hook subscribes, so the
      // render snapshot keeps the settled value from the first instance)
      await waitFor(() => expect(staleReads).toBe(1))
      expect(result.current[0].state).toBe('off')

      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].actuating).toBe(true)
      expect(result.current[0].state).toBe('on') // optimistic flip

      // the stale read resolves NOW — with the pre-press state — while the
      // toggle answer is still pending: it must be discarded, no flicker
      act(() => {
        releaseStaleRead()
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25)) // let the stale response reach the store
      })
      expect(result.current[0].state).toBe('on') // NOT clobbered back to 'off'
      expect(result.current[0].actuating).toBe(true)

      act(() => {
        releaseToggle()
      })
      await waitFor(() => expect(result.current[0].actuating).toBe(false))
      expect(result.current[0].state).toBe('on') // confirmed by the service answer
      expect(result.current[0].error).toBeNull()
    })

    // bug57 (the guard must not over-block): a read that starts AFTER the
    // last write — e.g. the 3s poll after a finished toggle — must still
    // land and mirror external changes (phone / wall switch / automation).
    // bug57 v3: reads within TRANSITION_HOLD_MS of a flip are intentionally
    // held back, so this read starts only AFTER the hold window has expired.
    it('a read that starts after the last write still lands (external change resync)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let servedState = 'off'
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: servedState }),
        ),
      )
      const first = renderHook(() => useHomeSelectedEntities())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(first.result.current[0].state).toBe('off')
      act(() => {
        first.result.current[0].actuate()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(first.result.current[0].actuating).toBe(false)
      expect(first.result.current[0].state).toBe('on') // the toggle settled
      first.unmount()

      // externally the switch was turned off again (phone / wall switch)
      servedState = 'off'
      // bug57 v3: the flip's transition hold is still active — advance PAST
      // it so the fresh read below starts after the hold window (the test's
      // intent is the post-toggle poll, which always lands)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      // a fresh read starts now — AFTER the last write AND after the hold,
      // it must be allowed to land (the mount fetch runs the same path as
      // the 3s poll)
      const second = renderHook(() => useHomeSelectedEntities())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(second.result.current[0].state).toBe('off')
      expect(second.result.current[0].loading).toBe(false)
      expect(second.result.current[0].error).toBeNull()
      second.unmount()
      vi.useRealTimers()
    })

    it('scene actuation does not flip the state and resyncs afterwards', async () => {
      seedSelection([SCENE])
      server.use(
        http.get('*/ha-api/states/scene.abendstimmung', () =>
          HttpResponse.json({ entity_id: SCENE, state: 'none' }),
        ),
      )
      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current[0].state).toBe('none'))
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].actuating).toBe(true)
      expect(result.current[0].state).toBe('none') // no optimistic flip (stateless)
      await waitFor(() => expect(result.current[0].actuating).toBe(false))
      expect(result.current[0].state).toBe('none') // resynced after the actuation
      expect(result.current[0].error).toBeNull()
      expect(result.current[0].active).toBeNull()
    })

    it('fetches newly selected ids on selection changes', async () => {
      const { result } = renderHook(() => {
        const selection = useHomeEntitySelection()
        const views = useHomeSelectedEntities()
        return { selection, views }
      })
      await waitFor(() => expect(result.current.views.every((v) => !v.loading)).toBe(true))
      let switchCalls = 0
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          switchCalls += 1
          return HttpResponse.json({ entity_id: SWITCH, state: 'on' })
        }),
      )
      act(() => {
        result.current.selection.toggle(SWITCH)
      })
      await waitFor(() => {
        expect(result.current.views).toHaveLength(HOME_LIGHTS.length + 1)
        const last = result.current.views[result.current.views.length - 1]
        expect(last.loading).toBe(false)
        expect(last.state).toBe('on')
      })
      expect(switchCalls).toBe(1)
    })

    // bug57 v2: the poll interval is 3s (was 5s) and only runs while the
    // Home carousel is visible (pollActive)
    it('polls every 3s while visible (pollActive) and stops polling after unmount', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      const { result, unmount } = renderHook(() => useHomeSelectedEntities(true))
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000)
      unmount()
      expect(clearIntervalSpy).toHaveBeenCalled()
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    })

    it('does not start the poll timer while hidden (pollActive=false)', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      const { result } = renderHook(() => useHomeSelectedEntities())
      // assert BEFORE awaiting — testing-library's waitFor polls through its
      // own setInterval, which the global spy would count as well
      expect(setIntervalSpy).not.toHaveBeenCalled()
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      setIntervalSpy.mockRestore()
    })

    // bug57 v2: the poll runs only while the Home carousel is visible
    // (pollActive). Hidden: no requests at all. On (re-)visibility: an
    // immediate fresh read (no waiting for the first 3s tick), then exactly
    // one poll per 3s that mirrors external changes (HA app / wall switch).
    it('polls every 3s only while visible; hidden = no requests, re-visible = immediate fresh read', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let reads = 0
      let servedState = 'off'
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          reads += 1
          return HttpResponse.json({ entity_id: SWITCH, state: servedState })
        }),
      )
      const { result, rerender, unmount } = renderHook(
        ({ visible }) => useHomeSelectedEntities(visible),
        { initialProps: { visible: false } },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(reads).toBe(1) // the mount fetch only
      expect(result.current[0].state).toBe('off')

      // hidden for 10s — not a single poll request
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(reads).toBe(1)

      // the Home carousel becomes visible: an immediate fresh read (no
      // waiting for the 3s tick), then exactly one poll per 3s
      rerender({ visible: true })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(reads).toBe(2) // the immediate read on visibility

      // the user changed the switch in the HA app — the first 3s tick
      // picks it up (the "external change" the user reported as slow)
      servedState = 'on'
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(reads).toBe(3)
      expect(result.current[0].state).toBe('on')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(reads).toBe(4)

      unmount()
      vi.useRealTimers()
    })

    // bug57 v2: the Build #109 re-press suspicion check — a press that lands
    // while the previous actuation's service answer is still pending is
    // rejected by the actuating guard (no second POST goes out), so a stale
    // service answer can never arrive after a newer flip: interleaved
    // actuations are structurally impossible. (The actuation's answer
    // sequence check in actuateEntity makes the answer path safe on its own
    // as well.)
    it('a re-press while an actuation is in flight is rejected (no interleaved answers)', async () => {
      seedSelection([SWITCH])
      let toggleCalls = 0
      let releaseToggle1: () => void = () => {}
      const toggle1Pending = new Promise<void>((resolve) => {
        releaseToggle1 = resolve
      })
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () =>
          HttpResponse.json({ entity_id: SWITCH, state: 'off' }),
        ),
        http.post('*/ha-api/services/switch/toggle', async () => {
          toggleCalls += 1
          if (toggleCalls === 1) {
            await toggle1Pending
            return HttpResponse.json([{ entity_id: SWITCH, state: 'on' }])
          }
          return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }])
        }),
      )
      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current[0].state).toBe('off'))

      // press 1: off → on, POST#1 in flight
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('on')
      expect(result.current[0].actuating).toBe(true)

      // press 2 (kurz danach) while POST#1 is still pending: rejected —
      // the store is untouched and no second POST goes out
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('on')
      expect(result.current[0].actuating).toBe(true)

      // POST#1's answer arrives — confirmed, settled
      act(() => {
        releaseToggle1()
      })
      await waitFor(() => expect(result.current[0].actuating).toBe(false))
      expect(result.current[0].state).toBe('on')
      expect(toggleCalls).toBe(1)

      // now a press works again (the actuation is settled)
      act(() => {
        result.current[0].actuate()
      })
      await waitFor(() => expect(result.current[0].actuating).toBe(false))
      expect(toggleCalls).toBe(2)
      expect(result.current[0].state).toBe('off')
    })

    // bug57 v2: the actual Build #109 re-press flicker — a poll read that
    // starts AFTER the optimistic flip (so the v1 revision check lets it
    // through) but while the actuation's service call is still in flight
    // fetches HA's state BEFORE the POST is processed (still the
    // pre-actuation state) and would clobber the flip. Exact user timeline:
    // press 1 off→on (settles), press 2 on→off (POST#2 slow, ~3s), the 3s
    // poll tick lands while POST#2 is in flight and HA still serves 'on' →
    // the stale poll answer must be discarded; POST#2's own answer then
    // confirms 'off'.
    it('a poll read that starts during an in-flight actuation cannot clobber the flip (Build #109)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let toggleCalls = 0
      let pollGets = 0
      let releasePollRead: () => void = () => {}
      const pollReadPending = new Promise<void>((resolve) => {
        releasePollRead = resolve
      })
      let releaseToggle1: () => void = () => {}
      const toggle1Pending = new Promise<void>((resolve) => {
        releaseToggle1 = resolve
      })
      let releaseToggle2: () => void = () => {}
      const toggle2Pending = new Promise<void>((resolve) => {
        releaseToggle2 = resolve
      })
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', async () => {
          pollGets += 1
          if (pollGets === 1) {
            // the mount fetch — instant
            return HttpResponse.json({ entity_id: SWITCH, state: 'off' })
          }
          // every later GET (the poll) is deferred and serves the PRE-POST
          // state — HA has not processed POST#2 yet
          await pollReadPending
          return HttpResponse.json({ entity_id: SWITCH, state: 'on' })
        }),
        http.post('*/ha-api/services/switch/toggle', async () => {
          toggleCalls += 1
          if (toggleCalls === 1) {
            await toggle1Pending
            return HttpResponse.json([{ entity_id: SWITCH, state: 'on' }])
          }
          await toggle2Pending
          return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }])
        }),
      )

      const { result, unmount } = renderHook(() => useHomeSelectedEntities(true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')
      expect(pollGets).toBe(1) // the mount fetch (the visibility read deduped on it)

      // press 1: off → on — the POST settles fast
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('on') // optimistic flip
      act(() => {
        releaseToggle1()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].actuating).toBe(false) // settled

      // press 2 (kurz danach): on → off — POST#2 is slow (the user's ~3s)
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('off') // optimistic flip
      expect(result.current[0].actuating).toBe(true)

      // the 3s poll tick fires while POST#2 is still in flight — the GET
      // goes out and HA still answers with the pre-POST state ('on')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(pollGets).toBe(2) // the poll GET went out during the actuation

      // the stale poll answer arrives — it MUST be discarded, the card
      // stays 'off' (without the guard it flickers back to 'An' here)
      act(() => {
        releasePollRead()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')
      expect(result.current[0].actuating).toBe(true)

      // POST#2's answer arrives (~3s after the press) — confirms 'off'
      act(() => {
        releaseToggle2()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')
      expect(result.current[0].actuating).toBe(false)
      expect(result.current[0].error).toBeNull()
      unmount()
      vi.useRealTimers()
    })

    // bug57 v3: the Build #110 mid-fade flicker — HA keeps reporting the
    // PRE-flip state while the light/entity is still fading, so even the
    // actuation's OWN service answer can carry the old state (v1/v2 let it
    // through: it starts after the flip and after the settlement). The
    // transition hold discards that divergent report within 1500 ms of the
    // flip and a single confirming re-read at the window's end lands the
    // true post-fade state — without waiting for the next 3 s poll.
    it('a mid-fade service answer is held back and a confirming re-read lands at hold end (bug57 v3)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let stateGets = 0
      let releaseToggle: () => void = () => {}
      const togglePending = new Promise<void>((resolve) => {
        releaseToggle = resolve
      })
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          stateGets += 1
          // GET#1 (mount): the pre-flip state. GET#2 (the confirming
          // re-read at the hold's end): the transition is done, HA reports
          // the flipped state
          return HttpResponse.json({ entity_id: SWITCH, state: stateGets === 1 ? 'off' : 'on' })
        }),
        http.post('*/ha-api/services/switch/toggle', async () => {
          await togglePending
          // mid-fade: HA has processed the POST but still reports the
          // pre-flip state
          return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }])
        }),
      )

      const { result, unmount } = renderHook(() => useHomeSelectedEntities())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')
      expect(stateGets).toBe(1)

      // flip off → on
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('on') // optimistic flip
      expect(result.current[0].actuating).toBe(true)

      // the service answer arrives ~500 ms in — still mid-fade ('off')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      act(() => {
        releaseToggle()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      // without the hold it would flicker back to 'off' here
      expect(result.current[0].state).toBe('on')
      expect(result.current[0].actuating).toBe(false)

      // nothing else may be fetched yet — exactly ONE confirming re-read,
      // firing at the window's end (t = 1500)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(stateGets).toBe(1)
      expect(result.current[0].state).toBe('on')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700) // → t = 1600, the re-read lands
      })
      expect(stateGets).toBe(2)
      expect(result.current[0].state).toBe('on') // confirmed post-fade

      unmount()
      vi.useRealTimers()
    })

    // bug57 v3: the hold must NOT over-block — a divergent value that is
    // reported AFTER the 1500 ms window (a genuine external change, e.g. the
    // next 3 s poll) lands normally
    it('a divergent read after the hold window still lands (external change, bug57 v3)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let stateGets = 0
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          stateGets += 1
          // GET#1 (mount): 'off'. GET#2 (the 3 s poll, after the hold
          // expired): externally switched off again during the transition
          return HttpResponse.json({ entity_id: SWITCH, state: stateGets === 1 ? 'off' : 'off' })
        }),
      )

      const { result, unmount } = renderHook(() => useHomeSelectedEntities(true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')
      expect(stateGets).toBe(1)

      // flip off → on — the service answer (generic echo) confirms instantly
      act(() => {
        result.current[0].actuate()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('on') // confirmed
      expect(result.current[0].actuating).toBe(false)

      // the 3 s poll tick (t = 3000, AFTER the 1500 ms hold) serves the
      // external 'off' — it must land (self-correction)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(stateGets).toBe(2)
      expect(result.current[0].state).toBe('off')

      unmount()
      vi.useRealTimers()
    })

    // bug57 v3: an external change that happens DURING the hold (wall
    // switch / phone) is picked up by the confirming re-read at the window's
    // end — no waiting for the next 3 s poll
    it('an external change during the hold lands via the confirming re-read (bug57 v3)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let stateGets = 0
      let releaseToggle: () => void = () => {}
      const togglePending = new Promise<void>((resolve) => {
        releaseToggle = resolve
      })
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          stateGets += 1
          // the switch is really ON (pre-flip 'on', and externally switched
          // on again mid-fade)
          return HttpResponse.json({ entity_id: SWITCH, state: 'on' })
        }),
        http.post('*/ha-api/services/switch/toggle', async () => {
          await togglePending
          // mid-fade: HA still reports the pre-flip state ('on')
          return HttpResponse.json([{ entity_id: SWITCH, state: 'on' }])
        }),
      )

      const { result, rerender, unmount } = renderHook(
        ({ visible }) => useHomeSelectedEntities(visible),
        { initialProps: { visible: false } },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('on')
      expect(stateGets).toBe(1)

      // flip on → off (the user wanted it off)
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('off') // optimistic flip

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
      expect(result.current[0].state).toBe('off') // held back, no flicker

      // ~800 ms in: the user flips it back on at the wall — the immediate
      // visibility read (carousel re-opens) reports 'on' — divergent within
      // the hold → held back as well (the confirming re-read is deduped)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300) // → t = 800
      })
      rerender({ visible: true })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(stateGets).toBe(2)
      expect(result.current[0].state).toBe('off') // still held

      // at the window's end (t = 1500) the confirming re-read lands 'on' —
      // the external change is adopted right after the hold
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })
      expect(stateGets).toBe(3)
      expect(result.current[0].state).toBe('on')

      unmount()
      vi.useRealTimers()
    })

    // bug57 v3: a value equal to the flipped target is a confirmation — it
    // lands immediately AND cancels the pending confirming re-read (no
    // redundant fetch at the window's end)
    it('a confirming read before the hold ends cancels the pending re-read (bug57 v3)', async () => {
      seedSelection([SWITCH])
      vi.useFakeTimers()
      let stateGets = 0
      let releaseToggle: () => void = () => {}
      const togglePending = new Promise<void>((resolve) => {
        releaseToggle = resolve
      })
      server.use(
        http.get('*/ha-api/states/switch.wasserpumpe', () => {
          stateGets += 1
          // GET#1 (mount): 'off'. GET#2 (the visibility read at ~800 ms):
          // the transition finished early — the flipped state is confirmed
          return HttpResponse.json({ entity_id: SWITCH, state: stateGets === 1 ? 'off' : 'on' })
        }),
        http.post('*/ha-api/services/switch/toggle', async () => {
          await togglePending
          // mid-fade: still the pre-flip state
          return HttpResponse.json([{ entity_id: SWITCH, state: 'off' }])
        }),
      )

      const { result, rerender, unmount } = renderHook(
        ({ visible }) => useHomeSelectedEntities(visible),
        { initialProps: { visible: false } },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('off')

      // flip off → on
      act(() => {
        result.current[0].actuate()
      })
      expect(result.current[0].state).toBe('on') // optimistic flip

      // the service answer arrives ~500 ms in — mid-fade ('off'): held back,
      // a confirming re-read is scheduled for t = 1500
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      act(() => {
        releaseToggle()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current[0].state).toBe('on') // held back, no flicker

      // ~800 ms in: the visibility read confirms 'on' — it lands AND cancels
      // the pending re-read
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300) // → t = 800
      })
      rerender({ visible: true })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(stateGets).toBe(2)
      expect(result.current[0].state).toBe('on')

      // past the window's end (and well before the next 3 s poll tick at
      // ~3800): no further fetch happens — the re-read was cancelled
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700) // → t = 2500
      })
      expect(stateGets).toBe(2)
      expect(result.current[0].state).toBe('on')

      unmount()
      vi.useRealTimers()
    })

    it('exposes store stats', async () => {
      const { result } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      const stats = __homeEntityStoreStats()
      expect(stats.selected).toBe(HOME_LIGHTS.length)
      expect(stats.catalogEntries).toBe(0)
      expect(stats.stateStores).toBe(HOME_LIGHTS.length)
    })
  })
})
