import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { fetchHaEntityState, toggleHaEntity } from '../homeassistant'

describe('homeassistant api', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches an entity state via the daemon /ha-api/ proxy', async () => {
    // the token is injected by the daemon proxy, the UI sends no Authorization
    let auth: string | null = 'sentinel'
    server.use(
      http.get('*/ha-api/states/light.livingroom', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({
          entity_id: 'light.livingroom',
          state: 'on',
          attributes: { friendly_name: 'Livingroom' },
        })
      }),
    )
    const entity = await fetchHaEntityState('light.livingroom')
    expect(entity.state).toBe('on')
    expect(auth).toBeNull()
  })

  it('throws on a non-ok response', async () => {
    server.use(
      http.get(
        '*/ha-api/states/light.missing',
        () => HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    )
    await expect(fetchHaEntityState('light.missing')).rejects.toThrow(/404/)
  })

  it('times out after 5 seconds', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('*/ha-api/states/light.slow', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = fetchHaEntityState('light.slow').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5000)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('home assistant timeout')
  })

  it('toggles the light and returns the updated state', async () => {
    let payload: unknown = null
    server.use(
      http.post('*/ha-api/services/light/toggle', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json([
          { entity_id: 'light.other', state: 'on' },
          { entity_id: 'light.3er_stehlampe_gold_esszimmer', state: 'off' },
        ])
      }),
    )
    const entity = await toggleHaEntity('light.3er_stehlampe_gold_esszimmer')
    expect(payload).toEqual({ entity_id: 'light.3er_stehlampe_gold_esszimmer' })
    expect(entity?.state).toBe('off')
  })

  it('throws when the toggle service fails', async () => {
    server.use(
      http.post(
        '*/ha-api/services/light/toggle',
        () => HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
    )
    await expect(toggleHaEntity('light.3er_stehlampe_gold_esszimmer')).rejects.toThrow(/401/)
  })
})
