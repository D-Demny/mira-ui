import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { fetchPiStatus, PI_STATUS_TIMEOUT_MS } from '../piStatus'

describe('pi status api (ticket10-4)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps the full status shape', async () => {
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({
          conn: 'connected',
          last_attempt_at: '2026-09-02T14:07:00Z',
          model: 'Raspberry Pi 4 Model B',
          tier: 'compute',
        }),
      ),
    )
    const s = await fetchPiStatus()
    expect(s).toEqual({
      conn: 'connected',
      lastAttemptAt: '2026-09-02T14:07:00Z',
      model: 'Raspberry Pi 4 Model B',
      tier: 'compute',
    })
  })

  it('degrades missing and empty optional fields to undefined', async () => {
    server.use(
      http.get('*/api/pi/status', () =>
        HttpResponse.json({
          conn: 'disconnected',
          last_attempt_at: '',
          model: '',
          tier: '',
        }),
      ),
    )
    const s = await fetchPiStatus()
    expect(s).toEqual({ conn: 'disconnected' })
    expect(s.lastAttemptAt).toBeUndefined()
    expect(s.model).toBeUndefined()
    expect(s.tier).toBeUndefined()
  })

  it('degrades an unknown conn value to disconnected (safe state)', async () => {
    server.use(http.get('*/api/pi/status', () => HttpResponse.json({ conn: 'whatever' })))
    expect((await fetchPiStatus()).conn).toBe('disconnected')
  })

  it('throws on the 503 of an old daemon (handler not wired)', async () => {
    server.use(http.get('*/api/pi/status', () => new HttpResponse(null, { status: 503 })))
    await expect(fetchPiStatus()).rejects.toThrow(/503/)
  })

  it('times out after 10 seconds', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('*/api/pi/status', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = fetchPiStatus().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(PI_STATUS_TIMEOUT_MS)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('pi status timeout')
  })
})
