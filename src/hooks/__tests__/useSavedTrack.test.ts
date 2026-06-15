import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useSavedTrack } from '../useSavedTrack'
import { server } from '../../__tests__/msw-server'

describe('useSavedTrack', () => {
  it('fetches and reflects the saved state for the current track', async () => {
    server.use(
      http.get('*/player/saved', ({ request }) => {
        const uri = new URL(request.url).searchParams.get('uri')
        return HttpResponse.json({ saved: uri === 'spotify:track:liked' })
      }),
    )

    const { result } = renderHook(() => useSavedTrack('spotify:track:liked'))
    expect(result.current.saved).toBe(false) // unknown until resolved
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.saved).toBe(true)
  })

  it('likes a local file by its full URI (no track id)', async () => {
    const localUri = 'spotify:local:Artist:Album:Title:213'
    const posts: Array<{ uri: string; saved: boolean }> = []
    server.use(
      http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
      http.post('*/player/saved', async ({ request }) => {
        posts.push((await request.json()) as { uri: string; saved: boolean })
        return HttpResponse.json({ saved: true })
      }),
    )

    const { result } = renderHook(() => useSavedTrack(localUri))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggle())
    expect(result.current.saved).toBe(true) // optimistic
    await waitFor(() => expect(posts).toEqual([{ uri: localUri, saved: true }]))
  })

  it('optimistically toggles and POSTs the new state', async () => {
    const posts: Array<{ uri: string; saved: boolean }> = []
    server.use(
      http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
      http.post('*/player/saved', async ({ request }) => {
        posts.push((await request.json()) as { uri: string; saved: boolean })
        return HttpResponse.json({ saved: true })
      }),
    )

    const { result } = renderHook(() => useSavedTrack('spotify:track:t1'))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.saved).toBe(false)

    act(() => result.current.toggle())
    expect(result.current.saved).toBe(true) // optimistic, no await needed

    await waitFor(() => expect(posts).toEqual([{ uri: 'spotify:track:t1', saved: true }]))
  })

  it('reverts and reports when the write fails', async () => {
    const onError = vi.fn()
    server.use(
      http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
      http.post('*/player/saved', () => new HttpResponse(null, { status: 500 })),
    )

    const { result } = renderHook(() => useSavedTrack('t1', onError))
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => result.current.toggle())
    expect(result.current.saved).toBe(true) // optimistic

    await waitFor(() => expect(result.current.saved).toBe(false)) // reverted
    expect(onError).toHaveBeenCalledWith("Couldn't add to Liked Songs")
  })

  it('does nothing when disabled (null track id)', async () => {
    let hits = 0
    server.use(
      http.get('*/player/saved', () => {
        hits++
        return HttpResponse.json({ saved: true })
      }),
    )

    const { result } = renderHook(() => useSavedTrack(null))
    act(() => result.current.toggle())
    expect(result.current.saved).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(hits).toBe(0)
  })
})
