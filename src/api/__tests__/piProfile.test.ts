import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { deletePiProfile, PI_PROFILE_TIMEOUT_MS } from '../piProfile'

// ticket10-5C: the profile deletion client (DELETE /api/pi/profile?id=)
describe('pi profile api (ticket10-5)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the id as query param and the credentials in the body, maps the result', async () => {
    let query: string | null = null
    let body: unknown = null
    server.use(
      http.delete('*/api/pi/profile', async ({ request }) => {
        query = new URL(request.url).searchParams.get('id')
        body = await request.json()
        return HttpResponse.json({
          key_removed: true,
          authorized_keys_removed: true,
        })
      }),
    )
    const result = await deletePiProfile('pi-2', {
      ip: '10.0.0.9',
      user: 'dietpi',
      password: 'hunter2',
    })
    expect(query).toBe('pi-2')
    expect(body).toEqual({ ip: '10.0.0.9', user: 'dietpi', password: 'hunter2' })
    expect(result).toEqual({ keyRemoved: true, authorizedKeysRemoved: true })
    expect(result.error).toBeUndefined()
  })

  it('degrades missing optional fields (false flags, no error)', async () => {
    server.use(
      http.delete('*/api/pi/profile', () => HttpResponse.json({})),
    )
    const result = await deletePiProfile('pi-1', {})
    expect(result).toEqual({ keyRemoved: false, authorizedKeysRemoved: false })
    expect(result.error).toBeUndefined()
  })

  it('surfaces the daemon cleanup error on a 200 response', async () => {
    server.use(
      http.delete('*/api/pi/profile', () =>
        HttpResponse.json({
          key_removed: true,
          authorized_keys_removed: false,
          error: 'ssh: timed out',
        }),
      ),
    )
    const result = await deletePiProfile('pi-1', { ip: '10.0.0.9', user: 'root' })
    expect(result.keyRemoved).toBe(true)
    expect(result.authorizedKeysRemoved).toBe(false)
    expect(result.error).toBe('ssh: timed out')
  })

  it('throws the daemon error message on 400 (unsafe / missing id)', async () => {
    server.use(
      http.delete('*/api/pi/profile', () =>
        HttpResponse.json({ error: "unsafe profile id: \"../../x\"" }, { status: 400 }),
      ),
    )
    await expect(deletePiProfile('../../x', {})).rejects.toThrow(/unsafe profile id/)
  })

  it('throws on the 503 of an old daemon (handler not wired)', async () => {
    server.use(
      http.delete('*/api/pi/profile', () => new HttpResponse(null, { status: 503 })),
    )
    await expect(deletePiProfile('pi-1', {})).rejects.toThrow(/503/)
  })

  it('times out after 10 seconds', async () => {
    vi.useFakeTimers()
    server.use(
      http.delete('*/api/pi/profile', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = deletePiProfile('pi-1', {}).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(PI_PROFILE_TIMEOUT_MS)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('pi profile timeout')
  })
})
