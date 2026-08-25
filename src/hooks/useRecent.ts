import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRecentlyPlayed } from '@/api/client'
import type { SpotifyRecentlyPlayedItem } from '@/api/types'

const CACHE_TTL_MS = 5 * 60 * 1000
const RECENT_LIMIT = 20

interface CacheEntry {
  items: SpotifyRecentlyPlayedItem[]
  fetchedAt: number
}

// module-level cache (session-scoped)
const cache = new Map<string, CacheEntry>()

export function clearRecentCache() {
  cache.clear()
}

// approximate in-memory weight of one recently-played item (audit §2.1) —
// feeds the debug size estimate only
const APPROX_RECENT_BYTES = 550

// test/debug introspection (bug45 option C: cache stats readout)
export function __recentCacheStats() {
  const items = cache.get('recent')?.items.length ?? 0
  return { entries: cache.size, items, approxBytes: items * APPROX_RECENT_BYTES }
}

export function useRecent() {
  const [items, setItems] = useState<SpotifyRecentlyPlayedItem[]>(
    () => cache.get('recent')?.items ?? [],
  )
  const [loading, setLoading] = useState(() => !cache.has('recent'))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // bug37: render-time mirror of `items` so the silent-refresh decision below
  // never reads a stale closure value
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const fetchRecent = useCallback(async () => {
    // cancel in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const cached = cache.get('recent')
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setItems(cached.items)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetchRecentlyPlayed(RECENT_LIMIT, controller.signal)
      if (!controller.signal.aborted) {
        cache.set('recent', { items: result, fetchedAt: now })
        setItems(result)
        setLoading(false)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Failed to load recently played'
        console.warn('useRecent error:', message)
        setError(message)
        setLoading(false)
      }
    }
  }, [])

  // bug37: silent background revalidation (cache-first). The currently
  // rendered items stay on screen — no loading-state flip, no 'Lade…' flash,
  // no cache invalidation — while the fresh page is fetched in the background;
  // it replaces them on arrival. With nothing rendered (empty or failed
  // initial load) it degrades to the regular loading fetch so the
  // 'Lade…' → error card flow of the first load / error retry is preserved.
  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const hasItems =
      (cache.get('recent')?.items.length ?? 0) > 0 || itemsRef.current.length > 0
    if (!hasItems) {
      setLoading(true)
      setError(null)
    }
    try {
      const result = await fetchRecentlyPlayed(RECENT_LIMIT, controller.signal)
      if (!controller.signal.aborted) {
        cache.set('recent', { items: result, fetchedAt: Date.now() })
        setItems(result)
        setError(null)
        setLoading(false)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Failed to load recently played'
        console.warn('useRecent error:', message)
        if (!hasItems) {
          setError(message)
          setLoading(false)
        }
        // stale items on screen: keep them, the pane stays usable
      }
    }
  }, [])

  useEffect(() => {
    void fetchRecent()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchRecent])

  const refetch = useCallback(() => {
    cache.delete('recent')
    void fetchRecent()
  }, [fetchRecent])

  return { items, loading, error, refetch, refresh }
}
