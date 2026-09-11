import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { __resetSettings, updateSettings } from '@/settings'
import { __resetHomeEntityStores } from '@/hooks/useHomeEntities'
import { haBaseStatus, useHaStatus } from '../useHaStatus'

// ticket 9.4: the HA status hook (Row short status + Modal full status).
//
// Test isolation: the hook holds no module-level state — the shared stores
// are the settings store (__resetSettings) and the 60 s-TTL entity catalog
// (__resetHomeEntityStores), both reset in beforeEach. server.resetHandlers()
// runs automatically, so the msw-server defaults (old-daemon 404 for the ha
// endpoints) apply unless a test opts in.

// the default MSW catalog fixture carries 9 lights + 6 controllable
// non-lights (the sensor is filtered out)
const CATALOG_SIZE = 15

const FULL_HA = {
  url: 'http://10.10.1.104:8123',
  username: 'mira',
  password: 'pw-secret',
  token: 'tok-secret',
  tokenSource: 'login' as const,
}

describe('haBaseStatus (pure, no fetch)', () => {
  it('is default for the empty ha config', () => {
    expect(
      haBaseStatus({ url: '', username: '', password: '', token: '', tokenSource: 'default' }),
    ).toBe('default')
  })

  it('requires BOTH url and token to be configured', () => {
    const base = { url: 'http://x', username: '', password: '', token: '', tokenSource: 'default' as const }
    expect(haBaseStatus(base)).toBe('default') // url without token
    expect(haBaseStatus({ ...base, url: '', token: 't' })).toBe('default') // token without url
    expect(haBaseStatus({ ...base, token: 't' })).toBe('configured')
  })
})

describe('useHaStatus', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
    __resetHomeEntityStores()
  })

  it('derives the base status from the settings store without any probe', async () => {
    let probeCalls = 0
    server.use(
      http.post('*/api/ha/test', () => {
        probeCalls += 1
        return HttpResponse.json({ reachable: true, authenticated: true, defaults: { url: '' } })
      }),
    )
    const { result } = renderHook(() => useHaStatus())
    expect(result.current.base).toBe('default')
    expect(result.current.status).toBe('default')
    // nothing probes on mount (no ambient fetch for the status)
    await new Promise((r) => setTimeout(r, 50))
    expect(probeCalls).toBe(0)
    expect(result.current.connection).toBeNull()

    act(() => {
      updateSettings({ ha: FULL_HA })
    })
    expect(result.current.base).toBe('configured')
    expect(result.current.status).toBe('configured')
    expect(result.current.connection).toBeNull()
    expect(probeCalls).toBe(0)
  })

  it('probes on demand only and maps the connection result', async () => {
    let calls = 0
    let body: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/ha/test', async ({ request }) => {
        calls += 1
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          reachable: true,
          authenticated: false,
          defaults: { url: 'http://10.10.1.104:8123' },
        })
      }),
    )
    const { result } = renderHook(() => useHaStatus())
    await new Promise((r) => setTimeout(r, 50)) // any (buggy) ambient probe would fire here
    expect(calls).toBe(0)

    act(() => {
      result.current.probe('http://10.10.1.104:8123', 'tok-secret')
    })
    expect(result.current.probing).toBe(true)
    await waitFor(() => expect(result.current.probing).toBe(false))
    expect(calls).toBe(1)
    expect(body).toEqual({ url: 'http://10.10.1.104:8123', token: 'tok-secret' })
    expect(result.current.connection).toBe('reachable-unauth')
    // the probe result wins over the base status (modal: "Nicht authentifiziert (401)")
    expect(result.current.status).toBe('reachable-unauth')
    expect(result.current.defaultUrl).toBe('http://10.10.1.104:8123')
    expect(result.current.probeError).toBeNull()
    // the probed values are exposed so a consumer can detect staleness
    expect(result.current.probedUrl).toBe('http://10.10.1.104:8123')
    expect(result.current.probedToken).toBe('tok-secret')
  })

  it('maps an unreachable probe result (HA down) and a second probe re-probes', async () => {
    let reachable = false
    server.use(
      http.post('*/api/ha/test', () =>
        HttpResponse.json({
          reachable,
          authenticated: false,
          defaults: { url: 'http://10.10.1.104:8123' },
        }),
      ),
    )
    const { result } = renderHook(() => useHaStatus())
    act(() => {
      result.current.probe('http://10.10.1.104:8123')
    })
    await waitFor(() => expect(result.current.connection).toBe('unreachable'))
    expect(result.current.status).toBe('unreachable')

    reachable = true
    act(() => {
      result.current.probe('http://10.10.1.104:8123', 'tok-secret')
    })
    await waitFor(() => expect(result.current.connection).toBe('reachable-unauth'))
  })

  it('ignores empty urls and overlapping probe calls', async () => {
    let calls = 0
    server.use(
      http.post('*/api/ha/test', () => {
        calls += 1
        return HttpResponse.json({ reachable: true, authenticated: true, defaults: { url: '' } })
      }),
    )
    const { result } = renderHook(() => useHaStatus())
    act(() => {
      result.current.probe('   ')
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toBe(0) // empty url = no-op, no request

    act(() => {
      result.current.probe('http://a')
      result.current.probe('http://b') // in flight → dropped
    })
    await waitFor(() => expect(result.current.probing).toBe(false))
    expect(calls).toBe(1)
  })

  it('surfaces the probe error on an old daemon (MSW default) without leaking the token', async () => {
    // no server.use — the default mirrors the old daemon (plain-text 404)
    const { result } = renderHook(() => useHaStatus())
    act(() => {
      result.current.probe('http://10.10.1.104:8123', 'tok-secret')
    })
    await waitFor(() => expect(result.current.probeError).not.toBeNull())
    expect(result.current.probeError).toMatch(/not available \(daemon outdated\?\)/)
    expect(result.current.connection).toBeNull()
    expect(result.current.probing).toBe(false)
    expect(result.current.status).toBe('default')
    // the token rode in the request — it must not appear in the error text
    expect(result.current.probeError).not.toContain('tok-secret')
  })

  it('keeps the probe result across a save and exposes the probed values (staleness is the consumer to detect)', async () => {
    // the hook deliberately does NOT auto-invalidate: the modal re-probes
    // right after every action (ticket: "beim Modal-Open + nach Aktionen"),
    // and probedUrl/probedToken let it see that the result describes the
    // OLD values
    server.use(
      http.post('*/api/ha/test', () =>
        HttpResponse.json({
          reachable: true,
          authenticated: true,
          defaults: { url: 'http://10.10.1.104:8123' },
        }),
      ),
    )
    act(() => {
      updateSettings({ ha: { ...FULL_HA, url: 'http://a:8123', token: 'tok-1' } })
    })
    const { result } = renderHook(() => useHaStatus())
    act(() => {
      result.current.probe('http://a:8123', 'tok-1')
    })
    await waitFor(() => expect(result.current.connection).toBe('authenticated'))
    expect(result.current.defaultUrl).toBe('http://10.10.1.104:8123')
    expect(result.current.probedUrl).toBe('http://a:8123')
    expect(result.current.probedToken).toBe('tok-1')

    // a save with different url/token → the result still describes the
    // probed values (the mismatch is detectable)
    act(() => {
      updateSettings({ ha: { ...FULL_HA, url: 'http://b:8123', token: 'tok-2' } })
    })
    expect(result.current.connection).toBe('authenticated')
    expect(result.current.status).toBe('authenticated')
    expect(result.current.probedUrl).toBe('http://a:8123')
    expect(result.current.probedToken).toBe('tok-1')
  })

  it('clears the connection when a probe fails (the old result is void)', async () => {
    let failing = false
    server.use(
      http.post('*/api/ha/test', () => {
        if (failing) return new HttpResponse('404 page not found', { status: 404 })
        return HttpResponse.json({
          reachable: true,
          authenticated: true,
          defaults: { url: 'http://10.10.1.104:8123' },
        })
      }),
    )
    const { result } = renderHook(() => useHaStatus())
    act(() => {
      result.current.probe('http://a:8123', 'tok-1')
    })
    await waitFor(() => expect(result.current.connection).toBe('authenticated'))
    expect(result.current.defaultUrl).toBe('http://10.10.1.104:8123')

    failing = true
    act(() => {
      result.current.probe('http://a:8123', 'tok-1')
    })
    await waitFor(() => expect(result.current.probeError).not.toBeNull())
    expect(result.current.connection).toBeNull() // the failed probe voids it
    // the last known daemon default survives the failed probe
    expect(result.current.defaultUrl).toBe('http://10.10.1.104:8123')
    expect(result.current.status).toBe('default') // back to the base status
  })

  it('exposes the entity count from the existing 60s-TTL catalog', async () => {
    const { result } = renderHook(() => useHaStatus())
    expect(result.current.entityCount).toBe(0)
    await waitFor(() => expect(result.current.entityCount).toBe(CATALOG_SIZE))
    expect(result.current.entitiesLoading).toBe(false)
    expect(result.current.entitiesError).toBeNull()
  })
})
