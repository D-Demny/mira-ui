import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchLyrics } from '@/api/client'
import type { LyricsResult } from '@/api/types'

interface LyricsParams {
  trackId: string | null
  trackName: string
  artist: string
  album?: string
  durationMs?: number
  episode?: boolean
  enabled?: boolean
}

interface LyricsState {
  lyrics: LyricsResult | null
  loading: boolean
  error: string | null
}

const CACHE_LIMIT = 50

// LRU keyed by track id, map insertion order = recency, evict from the front
const cache = new Map<string, LyricsResult>()

// test-only escape hatch
export function __resetLyricsCache(): void {
  cache.clear()
}

function cacheGet(id: string): LyricsResult | undefined {
  const v = cache.get(id)
  if (v !== undefined) {
    cache.delete(id)
    cache.set(id, v) // bump recency
  }
  return v
}

function cacheSet(id: string, lyrics: LyricsResult): void {
  if (cache.has(id)) cache.delete(id)
  cache.set(id, lyrics)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const FETCH_DEBOUNCE_MS = 150

export function useLyrics(params: LyricsParams): LyricsState {
  const [state, setState] = useState<LyricsState>({
    lyrics: null,
    loading: false,
    error: null,
  })

  const { trackId, trackName, artist, album, durationMs, episode, enabled = true } = params
  const debounceRef = useRef(0)

  useEffect(() => {
    // lyric view hidden dont fetch
    if (!enabled) return

    // tracks need name + artist to look up and episodes are fetched by id alone
    if (!trackId || (!episode && (!trackName || !artist))) {
      setState({ lyrics: null, loading: false, error: null })
      return
    }

    // podcasts aren't cached
    if (!episode) {
      const cached = cacheGet(trackId)
      if (cached) {
        setState({ lyrics: cached, loading: false, error: null })
        return
      }
    }

    const ac = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      fetchLyrics(trackId, { track: trackName, artist, album, durationMs, episode }, ac.signal)
        .then((lyrics) => {
          if (lyrics && !episode) cacheSet(trackId, lyrics)
          setState({ lyrics, loading: false, error: null })
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setState({ lyrics: null, loading: false, error: (err as Error).message })
        })
    }, FETCH_DEBOUNCE_MS)

    return () => {
      ac.abort()
      window.clearTimeout(debounceRef.current)
    }
  }, [trackId, trackName, artist, album, durationMs, episode, enabled])

  return state
}

// offsetMs is the user-tunable lyric timing knob which is currently stripped
export function getActiveLyricIndex(
  starts: number[],
  positionMs: number,
  offsetMs: number,
): number {
  if (starts.length === 0) return -1
  const target = positionMs + offsetMs

  let lo = 0
  let hi = starts.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= target) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

export function useLyricStarts(lyrics: LyricsResult | null): number[] {
  return useMemo(() => {
    if (!lyrics) return []
    return lyrics.lines.map((l) => parseInt(l.startTimeMs, 10) || 0)
  }, [lyrics])
}
