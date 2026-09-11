import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  HA_SETTINGS_TIMEOUT_MS,
  HaSettingsApiError,
  haLogin,
  haTest,
} from '../haSettings'

// ticket 9.4: the daemon's HA login + test endpoint clients.
//
// HARD constraint (ticket 9.4): the credentials (username / password /
// token) ride in the request bodies and in the login response. They must
// NEVER leak into an error message or a log line. Several tests below
// assert the negative: the surfaced error text carries the error class +
// status, and nothing of the credential values.

const CREDS = {
  url: 'http://10.10.1.104:8123',
  username: 'mira_user',
  password: 'hunter2-secret',
}

function asApiError(err: unknown): HaSettingsApiError {
  expect(err).toBeInstanceOf(HaSettingsApiError)
  return err as HaSettingsApiError
}

describe('haLogin (POST /api/ha/login)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the credentials in the body and extracts the token on 200', async () => {
    let body: unknown = null
    server.use(
      http.post('*/api/ha/login', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true, token: 'eyJ.fresh.10y-token' })
      }),
    )
    const { token } = await haLogin(CREDS)
    expect(body).toEqual(CREDS)
    expect(token).toBe('eyJ.fresh.10y-token')
  })

  it.each([
    ['bad_request', 400],
    ['invalid_credentials', 401],
    ['mfa', 401],
    ['unreachable', 502],
  ] as const)('maps the daemon error class %s (%s)', async (code, status) => {
    server.use(
      http.post('*/api/ha/login', () =>
        HttpResponse.json({ ok: false, error: code }, { status }),
      ),
    )
    const err = asApiError(await haLogin(CREDS).catch((e: unknown) => e))
    expect(err.code).toBe(code)
    expect(err.status).toBe(status)
    // no credential value may leak into the surfaced error text
    expect(err.message).not.toContain(CREDS.password)
    expect(err.message).not.toContain(CREDS.username)
    expect(err.message).not.toContain(CREDS.url)
  })

  it('maps a non-JSON body (old daemon, plain-text 404) to not_available', async () => {
    server.use(
      http.post('*/api/ha/login', () =>
        new HttpResponse('404 page not found', { status: 404 }),
      ),
    )
    const err = asApiError(await haLogin(CREDS).catch((e: unknown) => e))
    expect(err.code).toBe('not_available')
    expect(err.status).toBe(404)
    expect(err.message).toMatch(/not available \(daemon outdated\?\)/)
  })

  it('degrades to not_available on the MSW default (no opt-in = old daemon)', async () => {
    // no server.use — the msw-server default mirrors the old daemon
    const err = asApiError(await haLogin(CREDS).catch((e: unknown) => e))
    expect(err.code).toBe('not_available')
    expect(err.status).toBe(404)
  })

  it('rejects a 200 without a usable token (daemon contract violation)', async () => {
    server.use(
      http.post('*/api/ha/login', () => HttpResponse.json({ ok: true })),
    )
    const err = asApiError(await haLogin(CREDS).catch((e: unknown) => e))
    expect(err.code).toBe('bad_request')
    expect(err.message).toMatch(/without token/)
    expect(err.message).not.toContain(CREDS.password)
  })

  it('times out after 10 seconds (code timeout, no status)', async () => {
    vi.useFakeTimers()
    server.use(
      http.post('*/api/ha/login', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = haLogin(CREDS).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(HA_SETTINGS_TIMEOUT_MS)
    const err = asApiError(await pending)
    expect(err.code).toBe('timeout')
    expect(err.status).toBeNull()
  })
})

describe('haTest (POST /api/ha/test)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps reachable + authenticated and the daemon default url', async () => {
    let body: unknown = null
    server.use(
      http.post('*/api/ha/test', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          reachable: true,
          authenticated: true,
          defaults: { url: 'http://10.10.1.104:8123' },
        })
      }),
    )
    const result = await haTest({ url: CREDS.url, token: 'tok-abc' })
    expect(body).toEqual({ url: CREDS.url, token: 'tok-abc' })
    expect(result).toEqual({
      reachable: true,
      authenticated: true,
      defaultUrl: 'http://10.10.1.104:8123',
    })
  })

  it('maps reachable + unauthenticated (the HA server answered 401)', async () => {
    server.use(
      http.post('*/api/ha/test', () =>
        HttpResponse.json({ reachable: true, authenticated: false, defaults: { url: '' } }),
      ),
    )
    const result = await haTest({ url: CREDS.url })
    expect(result).toEqual({ reachable: true, authenticated: false, defaultUrl: '' })
  })

  it('maps unreachable (HA server down) as a RESULT, not an error', async () => {
    server.use(
      http.post('*/api/ha/test', () =>
        HttpResponse.json({
          reachable: false,
          authenticated: false,
          defaults: { url: 'http://10.10.1.104:8123' },
        }),
      ),
    )
    const result = await haTest({ url: CREDS.url })
    expect(result.reachable).toBe(false)
    expect(result.authenticated).toBe(false)
    expect(result.defaultUrl).toBe('http://10.10.1.104:8123')
  })

  it('omits the token from the body when it is not passed', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/ha/test', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ reachable: true, authenticated: false, defaults: { url: '' } })
      }),
    )
    await haTest({ url: CREDS.url })
    expect(body).toEqual({ url: CREDS.url })
    expect(body).not.toHaveProperty('token')
  })

  it('throws bad_request on the 400 (missing/invalid url)', async () => {
    server.use(
      http.post('*/api/ha/test', () =>
        HttpResponse.json({ ok: false, error: 'bad_request' }, { status: 400 }),
      ),
    )
    const err = asApiError(await haTest({ url: '' }).catch((e: unknown) => e))
    expect(err.code).toBe('bad_request')
    expect(err.status).toBe(400)
  })

  it('maps a non-JSON body (old daemon) to not_available', async () => {
    // the MSW default already mirrors the old daemon (plain-text 404)
    const err = asApiError(
      await haTest({ url: CREDS.url, token: 'tok-secret-value' }).catch((e: unknown) => e),
    )
    expect(err.code).toBe('not_available')
    expect(err.status).toBe(404)
    expect(err.message).toMatch(/not available \(daemon outdated\?\)/)
    // the token rode in the request body — it must not leak into the error
    expect(err.message).not.toContain('tok-secret-value')
  })

  it('times out after 10 seconds (code timeout)', async () => {
    vi.useFakeTimers()
    server.use(
      http.post('*/api/ha/test', () => new Promise<HttpResponse<undefined>>(() => {})),
    )
    const pending = haTest({ url: CREDS.url }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(HA_SETTINGS_TIMEOUT_MS)
    const err = asApiError(await pending)
    expect(err.code).toBe('timeout')
  })
})
