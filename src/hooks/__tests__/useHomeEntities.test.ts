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

    it('polls while mounted and stops polling after unmount', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      const { result, unmount } = renderHook(() => useHomeSelectedEntities())
      await waitFor(() => expect(result.current.every((v) => !v.loading)).toBe(true))
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
      unmount()
      expect(clearIntervalSpy).toHaveBeenCalled()
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
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
