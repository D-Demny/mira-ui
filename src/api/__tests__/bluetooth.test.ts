import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import * as bt from '../bluetooth'
import { server } from '../../__tests__/msw-server'

describe('api/bluetooth request shaping', () => {
  it('percent-encodes the MAC colons in the URL path', async () => {
    const seenPaths: string[] = []
    server.use(
      http.post('*/bluetooth/connect/*', ({ request }) => {
        seenPaths.push(new URL(request.url).pathname)
        return HttpResponse.json({})
      }),
    )

    await bt.connectDevice('AA:BB:CC:DD:EE:FF')

    expect(seenPaths).toEqual(['/bluetooth/connect/AA%3ABB%3ACC%3ADD%3AEE%3AFF'])
  })

  it('formats thrown errors so the 503-retry regex matches', async () => {
    // useBluetooth's retry does ` 503\b`.test(err.message), keep the space
    server.use(http.post('*/bluetooth/network/*', () => new HttpResponse(null, { status: 503 })))
    await expect(bt.connectNetwork('AA:BB:CC:DD:EE:FF')).rejects.toThrow(/ 503\b/)
  })

  it('appends a parsed JSON `error` detail to the thrown message', async () => {
    server.use(
      http.post('*/bluetooth/network/*', () =>
        HttpResponse.json({ error: 'no NAP role on device' }, { status: 404 }),
      ),
    )

    await expect(bt.connectNetwork('AA:BB:CC:DD:EE:FF')).rejects.toThrow(
      /404 \(no NAP role on device\)/,
    )
  })

  it('tolerates a non-JSON error body without crashing the throw', async () => {
    server.use(
      http.post(
        '*/bluetooth/network/*',
        () => new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    )

    await expect(bt.connectNetwork('AA:BB:CC:DD:EE:FF')).rejects.toThrow(/500$/)
  })
})
