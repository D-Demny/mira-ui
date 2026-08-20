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

export function useRecent() {
  const [items, setItems] = useState<SpotifyRecentlyPlayedItem[]>(
    () => cache.get('recent')?.items ?? [],
  )
  const [loading, setLoading] = useState(() => !cache.has('recent'))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  return { items, loading, error, refetch }
}
