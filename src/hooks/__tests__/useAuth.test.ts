import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../__tests__/msw-server'
import { useAuth } from '../useAuth'

afterEach(() => {
  vi.useRealTimers()
})

describe('useAuth', () => {
  it('exposes the initial loading state synchronously', () => {
    // hang the poll so nothing lands before we assert
    server.use(http.get('*/auth/status', () => new Promise(() => undefined)))

    const { result } = renderHook(() => useAuth())

    expect(result.current).toEqual({
      required: false,
      url: null,
      loading: true,
    })
  })

  it('settles to ready when the daemon reports no auth needed', async () => {
    server.use(
      http.get('*/auth/status', () =>
        HttpResponse.json({ required: false, url: null, loading: false }),
      ),
    )

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toEqual({
      required: false,
      url: null,
      loading: false,
    })
  })

  it('exposes the device-auth URL when required', async () => {
    const url = 'https://accounts.spotify.com/?code=ABCD-EFGH'
    server.use(
      http.get('*/auth/status', () => HttpResponse.json({ required: true, url, loading: false })),
    )

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.required).toBe(true))
    expect(result.current.url).toBe(url)
    expect(result.current.loading).toBe(false)
  })

  it('keeps loading=true when the daemon reports loading=true', async () => {
    server.use(
      http.get('*/auth/status', () =>
        HttpResponse.json({ required: false, url: null, loading: true }),
      ),
    )

    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.required).toBe(false)
    expect(result.current.url).toBeNull()
  })

  it('treats a fetch throw (daemon unreachable) as still-loading', async () => {
    // prevents flashing the player view between daemon restarts
    server.use(http.get('*/auth/status', () => HttpResponse.error()))

    const { result } = renderHook(() => useAuth())

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.required).toBe(false)
  })

  it('treats a 503 (handler not registered yet) as still-loading', async () => {
    server.use(http.get('*/auth/status', () => new HttpResponse(null, { status: 503 })))

    const { result } = renderHook(() => useAuth())

    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.loading).toBe(true)
  })

  it('stops polling after unmount so no setState fires on a dead component', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })

    let polls = 0
    server.use(
      http.get('*/auth/status', () => {
        polls++
        return HttpResponse.json({ required: false, url: null, loading: false })
      }),
    )

    const { unmount } = renderHook(() => useAuth())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(polls).toBe(1)

    unmount()

    // if clearTimeout fails, polls would tick up here
    await vi.advanceTimersByTimeAsync(2_000)
    expect(polls).toBe(1)
  })
})
