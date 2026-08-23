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

  it('polls the state while mounted and stops polling after unmount', async () => {
    server.use(
      http.get('*/ha-api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' }),
      ),
    )
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result, unmount } = renderHook(() => useHomeLight())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})
