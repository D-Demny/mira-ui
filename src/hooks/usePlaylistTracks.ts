import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPlaylistTracks, fetchSavedTracks } from '@/api/client'
import type { SpotifyPlaylistTrack } from '@/api/types'

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 50

// the Liked Songs pseudo-playlist (bug22): it has no playlist id, its pages
// come from Web API me/tracks instead of playlists/<id>/tracks
export const LIKED_SONGS_ID = 'spotify:collection:tracks'

interface CacheEntry {
  tracks: SpotifyPlaylistTrack[]
  total: number
  fetchedAt: number
}

// module-level cache keyed by playlist id (bug7: same pattern as usePlaylists)
const cache = new Map<string, CacheEntry>()

export function clearTracksCache() {
  cache.clear()
}

export interface UsePlaylistTracksResult {
  tracks: SpotifyPlaylistTrack[]
  total: number
  // true while the first page is being fetched
  loading: boolean
  // true while a follow-up page is being appended (bug5: lazy windowed loading)
  loadingMore: boolean
  error: string | null
  // fetch the next page when the dial focus approaches the end of what is loaded
  loadMore: () => void
  // drop the cache entry and reload from the first page
  refetch: () => void
}

// Loads one playlist's track list in pages of PAGE_SIZE. The first page is
// fetched eagerly; further pages are appended on demand via loadMore() so a
// 500-track playlist never blocks the menu (bug5). Results are cached for
// CACHE_TTL_MS per playlist id (bug7).
export function usePlaylistTracks(playlistId: string | null): UsePlaylistTracksResult {
  const cached = playlistId ? cache.get(playlistId) : undefined
  const [tracks, setTracks] = useState<SpotifyPlaylistTrack[]>(() => cached?.tracks ?? [])
  const [total, setTotal] = useState(() => cached?.total ?? 0)
  const [loading, setLoading] = useState(() => (playlistId ? !cached : false))
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // source of truth for what is loaded right now (survives rapid playlistId swaps)
  const listRef = useRef<SpotifyPlaylistTrack[]>(cached?.tracks ?? [])
  const totalRef = useRef(cached?.total ?? 0)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const appendPage = useCallback(
    async (id: string, offset: number, isInitial: boolean) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      if (isInitial) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }
      try {
        // bug22: Liked Songs pages from me/tracks, everything else from playlists/<id>/tracks
        const page =
          id === LIKED_SONGS_ID
            ? await fetchSavedTracks(offset, PAGE_SIZE, controller.signal)
            : await fetchPlaylistTracks(id, offset, PAGE_SIZE, controller.signal)
        if (controller.signal.aborted) return
        const seen = new Set(listRef.current.map((track) => track.id))
        const next = [...listRef.current]
        for (const item of page.items) {
          const track = item.track
          if (!track || seen.has(track.id)) continue
          seen.add(track.id)
          next.push(track)
        }
        listRef.current = next
        totalRef.current = Math.max(page.total, next.length)
        cache.set(id, { tracks: next, total: totalRef.current, fetchedAt: Date.now() })
        setTracks(next)
        setTotal(totalRef.current)
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : 'Failed to load playlist tracks'
          console.warn('usePlaylistTracks error:', message)
          setError(message)
        }
      } finally {
        inFlightRef.current = false
        if (!controller.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [],
  )

  // bug37: silent revalidation of a STALE cached list — fetches page 0 in the
  // background WITHOUT touching the loading flags (the stale list stays
  // rendered, no 'Lade…' flash on sub-menu entry) and merges the fresh head
  // back on arrival, keeping the already-loaded tail tracks that the fresh
  // page does not cover. A failure keeps the stale list on screen.
  const refreshFirstPage = useCallback(
    async (id: string) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      let resumeTail = false
      try {
        const page =
          id === LIKED_SONGS_ID
            ? await fetchSavedTracks(0, PAGE_SIZE, controller.signal)
            : await fetchPlaylistTracks(id, 0, PAGE_SIZE, controller.signal)
        if (controller.signal.aborted) return
        const freshTracks: SpotifyPlaylistTrack[] = []
        const seen = new Set<string>()
        for (const item of page.items) {
          const track = item.track
          if (!track || seen.has(track.id)) continue
          seen.add(track.id)
          freshTracks.push(track)
        }
        const tail = listRef.current.filter((track) => !seen.has(track.id))
        const next = [...freshTracks, ...tail]
        listRef.current = next
        totalRef.current = Math.max(page.total, next.length)
        cache.set(id, { tracks: next, total: totalRef.current, fetchedAt: Date.now() })
        setTracks(next)
        setTotal(totalRef.current)
        setError(null)
        resumeTail = totalRef.current > 0 && next.length < totalRef.current
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : 'Failed to load playlist tracks'
          console.warn('usePlaylistTracks error:', message)
          // the stale list stays rendered — only surface the error when empty
          if (listRef.current.length === 0) setError(message)
        }
      } finally {
        inFlightRef.current = false
      }
      // resume lazy loading if the merged list is still incomplete (the
      // in-flight guard is free again by now)
      if (!controller.signal.aborted && resumeTail) {
        void appendPage(id, listRef.current.length, false)
      }
    },
    [appendPage],
  )

  // (re)load when the requested playlist changes
  useEffect(() => {
    abortRef.current?.abort()
    inFlightRef.current = false
    if (!playlistId) {
      listRef.current = []
      totalRef.current = 0
      setTracks([])
      setTotal(0)
      setLoading(false)
      setLoadingMore(false)
      setError(null)
      return
    }
    const entry = cache.get(playlistId)
    const fresh = entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS
    if (fresh) {
      listRef.current = entry.tracks
      totalRef.current = entry.total
      setTracks(entry.tracks)
      setTotal(entry.total)
      setError(null)
      // resume lazy loading if the cached list is incomplete
      if (entry.total > 0 && entry.tracks.length < entry.total) {
        void appendPage(playlistId, entry.tracks.length, false)
      }
      return
    }
    // bug37: cache-first on a STALE entry — the cached list renders instantly
    // and page 0 is revalidated silently in the background
    if (entry && entry.tracks.length > 0) {
      listRef.current = entry.tracks
      totalRef.current = entry.total
      setTracks(entry.tracks)
      setTotal(entry.total)
      setError(null)
      void refreshFirstPage(playlistId)
      return
    }
    cache.delete(playlistId)
    listRef.current = []
    totalRef.current = 0
    setTracks([])
    setTotal(0)
    void appendPage(playlistId, 0, true)
  }, [playlistId, appendPage, refreshFirstPage])

  const loadMore = useCallback(() => {
    if (!playlistId || inFlightRef.current) return
    if (listRef.current.length >= totalRef.current) return
    void appendPage(playlistId, listRef.current.length, false)
  }, [playlistId, appendPage])

  const refetch = useCallback(() => {
    if (!playlistId) return
    cache.delete(playlistId)
    listRef.current = []
    totalRef.current = 0
    setTracks([])
    setTotal(0)
    void appendPage(playlistId, 0, true)
  }, [playlistId, appendPage])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { tracks, total, loading, loadingMore, error, loadMore, refetch }
}
