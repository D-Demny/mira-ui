import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDevice } from '../system'
import { server } from '../../__tests__/msw-server'

describe('api/system.resetDevice', () => {
  it('POSTs to /system/reset', async () => {
    let method = ''
    let path = ''
    server.use(
      http.post('*/system/reset', ({ request }) => {
        method = request.method
        path = new URL(request.url).pathname
        return HttpResponse.json({})
      }),
    )

    await resetDevice()

    expect(method).toBe('POST')
    expect(path).toBe('/system/reset')
  })

  it('throws with the status code on a non-2xx response', async () => {
    server.use(http.post('*/system/reset', () => new HttpResponse(null, { status: 500 })))
    await expect(resetDevice()).rejects.toThrow(/500/)
  })

  it('resolves successfully on a 200 OK', async () => {
    server.use(http.post('*/system/reset', () => HttpResponse.json({ ok: true })))
    await expect(resetDevice()).resolves.toBeUndefined()
  })
})
