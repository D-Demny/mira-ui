import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { MIRA_SERVER_TIMEOUT_MS, MIRA_SERVER_URL } from '../miraServer'
import {
  fetchRemoteColors,
  remoteArtUrl,
  remoteColorsUrl,
  resolveArtworkUrl,
  resolveColorsUrl,
} from '../miraImg'

const CDN = 'http://i.scdn.co/image/ab67616d0000b2fd1fcd45b0'

describe('epic10 task 2: route schema', () => {
  it('builds the 160x160 artwork route from the percent-encoded CDN url', () => {
    // the encoded url is the whole key: no raw '/' inside, so the route is
    // /img/<key>/160.jpg with exactly one path segment between /img/ and the
    // size suffix (the Pi service splits on '/')
    expect(remoteArtUrl(CDN)).toBe(`${MIRA_SERVER_URL}/img/${encodeURIComponent(CDN)}/160.jpg`)
    const key = remoteArtUrl(CDN).slice(`${MIRA_SERVER_URL}/img/`.length, -'/160.jpg'.length)
    expect(key).not.toContain('/')
    expect(decodeURIComponent(key)).toBe(CDN)
  })

  it('builds the colors route from the percent-encoded CDN url', () => {
    expect(remoteColorsUrl(CDN)).toBe(`${MIRA_SERVER_URL}/img/${encodeURIComponent(CDN)}/colors`)
  })

  it('keeps the direct CDN url when the features are off (standalone)', () => {
    expect(resolveArtworkUrl(CDN, false)).toBe(CDN)
    expect(resolveArtworkUrl(CDN, true)).toBe(remoteArtUrl(CDN))
    expect(resolveColorsUrl(CDN, false)).toBeUndefined()
    expect(resolveColorsUrl(CDN, true)).toBe(remoteColorsUrl(CDN))
  })
})

describe('fetchRemoteColors', () => {
  it('returns the Pi-extracted dominant color', async () => {
    server.use(http.get('*/img/*/colors', () => HttpResponse.json({ dominant: [1, 2, 3] })))
    await expect(fetchRemoteColors(CDN)).resolves.toEqual([1, 2, 3])
  })

  it('rejects on a non-OK status', async () => {
    server.use(
      http.get('*/img/*/colors', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    )
    await expect(fetchRemoteColors(CDN)).rejects.toThrow('mira server colors 500')
  })

  it('rejects on a non-JSON body', async () => {
    server.use(
      http.get(
        '*/img/*/colors',
        () =>
          new HttpResponse('<html>gateway error</html>', {
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    await expect(fetchRemoteColors(CDN)).rejects.toThrow()
  })

  it.each([
    ['null', null],
    ['a plain array', [1, 2, 3]],
    ['a missing dominant', {}],
    ['a non-array dominant', { dominant: '230, 60, 30' }],
    ['a short dominant', { dominant: [1, 2] }],
    ['a long dominant', { dominant: [1, 2, 3, 4] }],
    ['an out-of-range channel', { dominant: [256, 0, 0] }],
    ['a negative channel', { dominant: [0, -1, 0] }],
    ['a non-integer channel', { dominant: [1.5, 0, 0] }],
    ['a non-numeric channel', { dominant: [true, 0, 0] }],
  ])('rejects on a malformed payload: %s', async (_label, body) => {
    server.use(http.get('*/img/*/colors', () => HttpResponse.json(body)))
    await expect(fetchRemoteColors(CDN)).rejects.toThrow('invalid payload')
  })

  it('rejects when the request times out', async () => {
    // full fake timers (like the T1 capabilities timeout test): the handler
    // never answers, so only our 2.5s abort can end the request
    vi.useFakeTimers()
    server.use(http.get('*/img/*/colors', () => new Promise<Response>(() => {})))
    const pending = fetchRemoteColors(CDN)
    // attach the assertion BEFORE the timer fires: the rejection lands inside
    // advanceTimersByTimeAsync (abort → fetch rejects), so a late-attached
    // .rejects would surface as an unhandled rejection
    const assertion = expect(pending).rejects.toThrow('mira server colors timeout')
    await vi.advanceTimersByTimeAsync(MIRA_SERVER_TIMEOUT_MS)
    await assertion
    vi.useRealTimers()
  })
})
