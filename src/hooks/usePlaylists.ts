import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchUserPlaylists } from '@/api/client'
import type { SpotifyPlaylist } from '@/api/types'

const CACHE_TTL_MS = 5 * 60 * 1000

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

export function usePlaylists() {
  const [items, setItems] = useState<SpotifyPlaylist[]>(() => cache.get('playlists')?.items ?? [])
  const [loading, setLoading] = useState(() => !cache.has('playlists'))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchPlaylists = useCallback(async () => {
    // cancel in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const cached = cache.get('playlists')
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      setItems(cached.items)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { items, total } = await fetchUserPlaylists(0, 50, controller.signal)
      if (!controller.signal.aborted) {
        cache.set('playlists', { items, total, fetchedAt: now })
        setItems(items)
        setLoading(false)
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Failed to load playlists'
        setError(message)
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchPlaylists()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchPlaylists])

  const refetch = useCallback(() => {
    cache.delete('playlists')
    fetchPlaylists()
  }, [fetchPlaylists])

  return { items, loading, error, refetch }
}
