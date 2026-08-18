import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { useHomeLight } from '../useHomeLight'

describe('useHomeLight', () => {
  it('loads the light state on mount', async () => {
    server.use(
      http.get('*/api/states/light.*', () =>
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
        '*/api/states/light.*',
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
      http.get('*/api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' }),
      ),
      http.post('*/api/services/light/toggle', () =>
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
      http.get('*/api/states/light.*', () =>
        HttpResponse.json({ entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'on' }),
      ),
      http.post(
        '*/api/services/light/toggle',
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
})
