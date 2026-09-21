import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useSavedTrack } from '../useSavedTrack'
import {
  LIKED_SONGS_ID,
  __playlistTracksCacheStats,
  clearTracksCache,
  usePlaylistTracks,
} from '../usePlaylistTracks'
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

  it('issue #15: a successful save toggle clears the track cache, so the next liked-list open refetches', async () => {
    clearTracksCache()
    let savedRequests = 0
    const posts: Array<{ uri: string; saved: boolean }> = []
    server.use(
      http.get('*/web-api/me/tracks', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        savedRequests++
        return HttpResponse.json({
          items: [
            {
              is_local: false,
              track: {
                id: 'liked-0',
                name: 'T0',
                uri: 'spotify:track:liked-0',
                artists: [{ name: 'Someone' }],
              },
            },
            {
              is_local: false,
              track: {
                id: 'liked-1',
                name: 'T1',
                uri: 'spotify:track:liked-1',
                artists: [{ name: 'Someone' }],
              },
            },
          ],
          total: 2,
          limit: 50,
          offset,
          next: null,
        })
      }),
      http.get('*/player/saved', () => HttpResponse.json({ saved: true })),
      http.post('*/player/saved', async ({ request }) => {
        posts.push((await request.json()) as { uri: string; saved: boolean })
        return HttpResponse.json({ saved: false })
      }),
    )

    // seed the liked list cache (2 < 50 → complete list, no lazy tail)
    const { result: likedResult, unmount: likedUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    await waitFor(() => expect(likedResult.current.loading).toBe(false))
    expect(savedRequests).toBe(1)
    expect(__playlistTracksCacheStats().entries).toBe(1)
    likedUnmount()

    // unlike the currently playing track from the player controls
    const { result: saved, unmount: savedUnmount } = renderHook(() =>
      useSavedTrack('spotify:track:t1'),
    )
    await waitFor(() => expect(saved.current.ready).toBe(true))
    act(() => saved.current.toggle())
    await waitFor(() => expect(posts).toEqual([{ uri: 'spotify:track:t1', saved: false }]))
    savedUnmount()

    // the successful toggle invalidated the cached liked list...
    await waitFor(() => expect(__playlistTracksCacheStats().entries).toBe(0))

    // ...so the next open is a cold fetch again (proves invalidation even
    // though the issue #15 bypass would also refetch a warm entry)
    const { result: again, unmount: againUnmount } = renderHook(() =>
      usePlaylistTracks(LIKED_SONGS_ID),
    )
    await waitFor(() => expect(again.current.loading).toBe(false))
    expect(savedRequests).toBe(2)
    againUnmount()
  })
})
