import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMaRecentlyPlayed, fetchRecentlyPlayed } from '@/api/client'
import type { SpotifyRecentlyPlayedItem } from '@/api/types'
import { useSettings } from '@/settings'

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
  const settings = useSettings()
  // issue #138: with playbackSource 'ma' the pane shows MA's play log (title +
  // artwork only) - namespaced cache keys keep the two sources from clobbering
  // each other when the source switches at runtime.
  const isMa = settings.playbackSource === 'ma'
  const sourceKey = isMa ? 'recent:ma' : 'recent'

  const [items, setItems] = useState<SpotifyRecentlyPlayedItem[]>(
    () => cache.get(sourceKey)?.items ?? [],
  )
  const [loading, setLoading] = useState(() => !cache.has(sourceKey))
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

    const cached = cache.get(sourceKey)
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setItems(cached.items)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = isMa
        ? await fetchMaRecentlyPlayed(RECENT_LIMIT, controller.signal)
        : await fetchRecentlyPlayed(RECENT_LIMIT, controller.signal)
      if (!controller.signal.aborted) {
        cache.set(sourceKey, { items: result, fetchedAt: now })
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
  }, [sourceKey, isMa])

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

    const hasItems = (cache.get(sourceKey)?.items.length ?? 0) > 0 || itemsRef.current.length > 0
    if (!hasItems) {
      setLoading(true)
      setError(null)
    }
    try {
      const result = isMa
        ? await fetchMaRecentlyPlayed(RECENT_LIMIT, controller.signal)
        : await fetchRecentlyPlayed(RECENT_LIMIT, controller.signal)
      if (!controller.signal.aborted) {
        cache.set(sourceKey, { items: result, fetchedAt: Date.now() })
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
  }, [sourceKey, isMa])

  useEffect(() => {
    // issue #138: a source switch must not render the other source's history
    // while the fetch is in flight - clear it when the new key has no entry
    if (!cache.has(sourceKey)) setItems([])
    void fetchRecent()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchRecent, sourceKey])

  const refetch = useCallback(() => {
    cache.delete(sourceKey)
    void fetchRecent()
  }, [fetchRecent, sourceKey])

  return { items, loading, error, refetch, refresh }
}
