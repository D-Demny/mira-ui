import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  getPiTetheringStatus,
  startPiTethering,
  TETHERING_TIMEOUT_MS,
} from '../piTethering'

// ticket10-6A: the daemon's USB-tethering endpoints (exact contract in the
// Update-Eintrag 10-6A of aktueller-stand.md) — the client the onboarding
// wizard and the chooser consume
describe('pi tethering api (ticket10-6A contract)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('startPiTethering (POST /api/pi/tethering)', () => {
    it('sends the explicit profile_id and resolves on the 202', async () => {
      let body: unknown = null
      server.use(
        http.post('*/api/pi/tethering', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ job_id: 'job-1' }, { status: 202 })
        }),
      )
      await startPiTethering('pi-2')
      expect(body).toEqual({ profile_id: 'pi-2' })
    })

    it('omits the profile_id when none is given (daemon uses the active profile)', async () => {
      let body: unknown = null
      server.use(
        http.post('*/api/pi/tethering', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({ job_id: 'job-1' }, { status: 202 })
        }),
      )
      await startPiTethering()
      expect(body).toEqual({})
    })

    it('throws the daemon error message on 400 (unknown / unsafe / credential-less profile)', async () => {
      server.use(
        http.post('*/api/pi/tethering', () =>
          HttpResponse.json({ error: 'unknown profile: pi-9' }, { status: 400 }),
        ),
      )
      await expect(startPiTethering('pi-9')).rejects.toThrow(/unknown profile/)
    })

    it('throws the daemon error message on 409 (no device key → provisioning wizard hint)', async () => {
      server.use(
        http.post('*/api/pi/tethering', () =>
          HttpResponse.json(
            { error: 'no device key for pi-1 — run the provisioning wizard first' },
            { status: 409 },
          ),
        ),
      )
      await expect(startPiTethering('pi-1')).rejects.toThrow(/provisioning wizard/)
    })

    it('throws the daemon error message on 500 (script not packaged)', async () => {
      server.use(
        http.post('*/api/pi/tethering', () =>
          HttpResponse.json({ error: 'tethering script missing' }, { status: 500 }),
        ),
      )
      await expect(startPiTethering('pi-1')).rejects.toThrow(/tethering script missing/)
    })

    it('throws on the 503 of an old daemon (handler not wired)', async () => {
      // the default handler answers the 503 without a body
      await expect(startPiTethering('pi-1')).rejects.toThrow(/503/)
    })

    it('times out after 10 seconds', async () => {
      vi.useFakeTimers()
      server.use(
        http.post('*/api/pi/tethering', () => new Promise<HttpResponse<undefined>>(() => {})),
      )
      const pending = startPiTethering('pi-1').catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(TETHERING_TIMEOUT_MS)
      const err = await pending
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe('pi tethering timeout')
    })
  })

  describe('getPiTetheringStatus (GET /api/pi/tethering/status)', () => {
    it('maps the full shape of a running job', async () => {
      server.use(
        http.get('*/api/pi/tethering/status', () =>
          HttpResponse.json({
            state: 'running',
            job_id: 'job-7',
            profile_id: 'pi-1',
            started_at: '2026-09-03T07:40:00Z',
            uplink: 'eth',
            tethering_ok: false,
            internet_ok: false,
            log_tail: ['detect uplink', 'eth0 up'],
          }),
        ),
      )
      const s = await getPiTetheringStatus()
      expect(s).toEqual({
        state: 'running',
        jobId: 'job-7',
        profileId: 'pi-1',
        startedAt: '2026-09-03T07:40:00Z',
        finishedAt: undefined,
        uplink: 'eth',
        tetheringOk: false,
        internetOk: false,
        error: undefined,
        logTail: ['detect uplink', 'eth0 up'],
      })
    })

    it('maps a finished success with both ok-flags and the uplink', async () => {
      server.use(
        http.get('*/api/pi/tethering/status', () =>
          HttpResponse.json({
            state: 'success',
            job_id: 'job-7',
            profile_id: 'pi-1',
            started_at: '2026-09-03T07:40:00Z',
            finished_at: '2026-09-03T07:41:12Z',
            uplink: 'wlan',
            tethering_ok: true,
            internet_ok: true,
          }),
        ),
      )
      const s = await getPiTetheringStatus()
      expect(s.state).toBe('success')
      expect(s.tetheringOk).toBe(true)
      expect(s.internetOk).toBe(true)
      expect(s.uplink).toBe('wlan')
      expect(s.finishedAt).toBe('2026-09-03T07:41:12Z')
      expect(s.error).toBeUndefined()
    })

    it('maps a failed state with the error message (uplink none)', async () => {
      server.use(
        http.get('*/api/pi/tethering/status', () =>
          HttpResponse.json({
            state: 'failed',
            profile_id: 'pi-1',
            uplink: 'none',
            tethering_ok: false,
            internet_ok: false,
            error: 'exit status 1',
          }),
        ),
      )
      const s = await getPiTetheringStatus()
      expect(s.state).toBe('failed')
      expect(s.uplink).toBe('none')
      expect(s.tetheringOk).toBe(false)
      expect(s.internetOk).toBe(false)
      expect(s.error).toBe('exit status 1')
    })

    it('degrades missing/empty optional fields (idle default handler shape)', async () => {
      // the default MSW handler answers exactly this shape (fresh job)
      const s = await getPiTetheringStatus()
      expect(s).toEqual({
        state: 'idle',
        tetheringOk: false,
        internetOk: false,
        logTail: [],
      })
      expect(s.jobId).toBeUndefined()
      expect(s.profileId).toBeUndefined()
      expect(s.startedAt).toBeUndefined()
      expect(s.finishedAt).toBeUndefined()
      expect(s.uplink).toBeUndefined()
      expect(s.error).toBeUndefined()
    })

    it('downgrades unknown state/uplink values and non-string log lines (strict)', async () => {
      server.use(
        http.get('*/api/pi/tethering/status', () =>
          HttpResponse.json({
            state: 'whatever',
            uplink: 'usb',
            tethering_ok: 'yes',
            internet_ok: 1,
            log_tail: ['ok', 42, null],
          }),
        ),
      )
      const s = await getPiTetheringStatus()
      expect(s.state).toBe('idle')
      expect(s.uplink).toBeUndefined()
      expect(s.tetheringOk).toBe(false)
      expect(s.internetOk).toBe(false)
      expect(s.logTail).toEqual(['ok'])
    })

    it('throws on the 503 of an old daemon (handler not wired)', async () => {
      server.use(
        http.get('*/api/pi/tethering/status', () => new HttpResponse(null, { status: 503 })),
      )
      await expect(getPiTetheringStatus()).rejects.toThrow(/503/)
    })

    it('times out after 10 seconds', async () => {
      vi.useFakeTimers()
      server.use(
        http.get('*/api/pi/tethering/status', () =>
          new Promise<HttpResponse<undefined>>(() => {}),
        ),
      )
      const pending = getPiTetheringStatus().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(TETHERING_TIMEOUT_MS)
      const err = await pending
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe('pi tethering timeout')
    })
  })
})
