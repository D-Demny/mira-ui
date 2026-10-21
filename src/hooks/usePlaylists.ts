import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMaPlaylists, fetchUserPlaylists } from '@/api/client'
import type { SpotifyPlaylist } from '@/api/types'
import { useSettings } from '@/settings'

const CACHE_TTL_MS = 5 * 60 * 1000
// issue #138: delay before re-asking the daemon after a failed MA content
// fetch (the daemon 503s until the player session is up, which can take
// minutes right after boot/flash) - same rationale as useMaDevices
const MA_CONTENT_RETRY_MS = 15_000
interface CacheEntry {
  items: SpotifyPlaylist[]
  total: number
  fetchedAt: number
}

// module-level cache (session-scoped)
const cache = new Map<string, CacheEntry>()

export function clearCache() {
  cache.clear()
}

// approximate in-memory weight of one playlist item (audit §2.1) — feeds the
// debug size estimate only
const APPROX_PLAYLIST_BYTES = 350

// test/debug introspection (bug45 option C: cache stats readout)
export function __playlistsCacheStats() {
  const items = cache.get('playlists')?.items.length ?? 0
  return { entries: cache.size, items, approxBytes: items * APPROX_PLAYLIST_BYTES }
}

export function usePlaylists() {
  // issue #138: with playbackSource 'ma' the pane shows MA's flattened library
  // playlists instead of the Spotify user playlists - namespaced cache keys
  // let both sources coexist, and a source switch re-fetches without serving
  // the other list.
  const settings = useSettings()
  const isMa = settings.playbackSource === 'ma'
  const cacheKey = isMa ? 'playlists:ma' : 'playlists'

  const [items, setItems] = useState<SpotifyPlaylist[]>(() => cache.get(cacheKey)?.items ?? [])
  const [loading, setLoading] = useState(() => !cache.has(cacheKey))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // issue #138: pending MA error retry (fixed delay until the daemon answers)
  const retryTimerRef = useRef<number | undefined>(undefined)
  // stable handle for the scheduled retry - a self-reference inside the
  // useCallback body is a temporal-dead-zone hazard the linter rejects
  const fetchRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const fetchPlaylists = useCallback(async () => {
    // cancel in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const cached = cache.get(cacheKey)
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setItems(cached.items)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      // issue #138: MA serves the full flattened list in one call (no paging),
      // Spotify keeps its offset page
      const result = isMa
        ? await fetchMaPlaylists(controller.signal)
        : await fetchUserPlaylists(0, 50, controller.signal)
      if (!controller.signal.aborted) {
        cache.set(cacheKey, { items: result.items, total: result.total, fetchedAt: now })
        setItems(result.items)
        setLoading(false)
        // a fresh answer voids any pending MA error retry
        window.clearTimeout(retryTimerRef.current)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Failed to load playlists'
        console.warn('usePlaylists error:', message)
        setError(message)
        setLoading(false)
        // issue #138: 503 while the MA player session is still coming up -
        // retry on a fixed delay until the daemon answers (a one-shot fetch
        // would otherwise leave the pane blank for the whole app session)
        if (isMa) {
          window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = window.setTimeout(() => {
            void fetchRef.current()
          }, MA_CONTENT_RETRY_MS)
        }
      }
    }
  }, [cacheKey, isMa])

  // keep a stable handle for the scheduled MA error retry (ref writes during
  // render are rejected by react-hooks lint; effects run before any timer
  // could fire)
  useEffect(() => {
    fetchRef.current = fetchPlaylists
  }, [fetchPlaylists])

  useEffect(() => {
    // issue #138: a source switch must not render the other source's list
    // while the fetch is in flight - clear it when the new key has no entry
    if (!cache.has(cacheKey)) setItems([])
    void fetchPlaylists()
    return () => {
      abortRef.current?.abort()
      window.clearTimeout(retryTimerRef.current)
    }
  }, [fetchPlaylists, cacheKey])

  const refetch = useCallback(() => {
    cache.delete(cacheKey)
    void fetchPlaylists()
  }, [fetchPlaylists, cacheKey])

  return { items, loading, error, refetch }
}
