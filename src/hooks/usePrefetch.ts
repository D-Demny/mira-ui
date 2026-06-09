import { useEffect, useRef } from 'react'
import { API_BASE } from '@/config'
import type { ObserverStatus, QueueTrack } from '@/api/types'

const PREFETCH_NEXT = 5
const PREFETCH_PREV = 2

// 5s delay so rapid skipping doesnt fire prefetches for tracks we are likely to skip past
const PREFETCH_DELAY_MS = 5000

const seenUris = new Set<string>()
const SEEN_CEILING = 2000

function markSeen(uri: string) {
  if (seenUris.size >= SEEN_CEILING) {
    // drop oldest
    const oldest = seenUris.keys().next().value
    if (oldest !== undefined) seenUris.delete(oldest)
  }
  seenUris.add(uri)
}

function prefetchImage(url: string) {
  const img = new window.Image()
  img.src = url
}

function prefetchLyrics(t: QueueTrack) {
  // queue entries can ship with artist empty
  if (!t.track_id || !t.name || !t.artist) return
  // skip podcast episodes
  if (t.uri?.startsWith('spotify:episode:')) return
  const params = new URLSearchParams({
    track: t.name,
    artist: t.artist,
  })
  if (t.album) params.set('album', t.album)
  void fetch(`${API_BASE}/lyrics/${encodeURIComponent(t.track_id)}?${params.toString()}`).catch(
    () => {},
  )
}

function runPrefetch(status: ObserverStatus) {
  if (!status.active) return
  const next = (status.next_tracks ?? []).slice(0, PREFETCH_NEXT)
  const prev = (status.prev_tracks ?? []).slice(0, PREFETCH_PREV)
  for (const t of [...next, ...prev]) {
    if (!t.uri || seenUris.has(t.uri)) continue
    markSeen(t.uri)
    if (t.image_url) prefetchImage(t.image_url)
    prefetchLyrics(t)
  }
}

export function usePrefetch(status: ObserverStatus | null) {
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  })

  const lastFiredUriRef = useRef<string | null>(null)
  const currentUri = status?.active ? status.track_uri : null

  useEffect(() => {
    if (!currentUri) return
    if (currentUri === lastFiredUriRef.current) return

    const timer = window.setTimeout(() => {
      const s = statusRef.current
      if (!s?.active || s.track_uri !== currentUri) return
      lastFiredUriRef.current = currentUri
      runPrefetch(s)
    }, PREFETCH_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [currentUri])
}
