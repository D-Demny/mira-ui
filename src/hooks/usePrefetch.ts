import { useEffect, useRef } from 'react'
import { fetchLyrics } from '@/api/client'
import { remoteArtUrl } from '@/api/miraImg'
import { primeLyricsCache } from '@/hooks/useLyrics'
import { useMiraServer } from '@/hooks/useMiraServer'
import type { LyricsResult, ObserverStatus, QueueTrack } from '@/api/types'

const PREFETCH_NEXT = 5
const PREFETCH_PREV = 2

// 5s delay so rapid skipping doesnt fire prefetches for tracks we are likely to skip past
const PREFETCH_DELAY_MS = 5000

// issue #36: next_tracks[0] is what a switch will most likely land on, so its
// lyrics outcome is prepared right after it appears (short debounce only) —
// the switch then always finds a primed cache entry and the layout never
// flips. The deep prefetch below keeps the 5s wait for the rest of the queue.
const UPCOMING_DEBOUNCE_MS = 250

// "no lyrics" in the exact shape useLyrics' cache-hit path consumes: an empty
// primed entry renders the stable NoLyricsView instantly instead of a flip
const EMPTY_LYRICS: LyricsResult = { syncType: 'UNSYNCED', lines: [] }

const seenUris = new Set<string>()
const SEEN_CEILING = 2000

// issue #36: track_ids whose lyrics outcome is in flight or already primed —
// bursty status updates (and the deep prefetch covering next_tracks[0]) must
// not fetch the same upcoming track twice
const upcomingHandled = new Set<string>()
const UPCOMING_CEILING = 4000

function markSeen(uri: string) {
  if (seenUris.size >= SEEN_CEILING) {
    // drop oldest
    const oldest = seenUris.keys().next().value
    if (oldest !== undefined) seenUris.delete(oldest)
  }
  seenUris.add(uri)
}

// test/debug introspection (bug45 option C: cache stats readout) — uri
// strings only, so the approximate size is the summed string length
export function __prefetchStats() {
  let approxBytes = 0
  for (const uri of seenUris) approxBytes += uri.length
  return { entries: seenUris.size, maxEntries: SEEN_CEILING, approxBytes }
}

// test isolation — mirrors __resetLyricsCache from useLyrics
export function __resetPrefetchState(): void {
  seenUris.clear()
  upcomingHandled.clear()
}

function prefetchImage(url: string) {
  const img = new window.Image()
  // match the card <img> cache-partition attrs (see MainMenuView pre-decode) so the warm hits their partition
  img.crossOrigin = 'anonymous'
  img.referrerPolicy = 'no-referrer'
  img.src = url
}

function prefetchLyrics(t: QueueTrack) {
  // queue entries can ship with artist empty
  if (!t.track_id || !t.name || !t.artist) return
  // skip podcast episodes
  if (t.uri?.startsWith('spotify:episode:')) return
  const id = t.track_id
  // the immediate path may already have primed (or be fetching) this track —
  // do not double-fetch
  if (upcomingHandled.has(id)) return
  void fetchLyrics(id, { track: t.name, artist: t.artist, album: t.album })
    .then((lyrics) => {
      // issue #36: prime the negative outcome too (404 / instrumental → null),
      // so switching into a lyric-less track is instant and stable as well
      primeLyricsCache(id, lyrics ?? EMPTY_LYRICS)
    })
    .catch(() => {})
}

// issue #36: immediate lyrics preparation for next_tracks[0] (see
// UPCOMING_DEBOUNCE_MS). Fetches the outcome once and primes the useLyrics LRU
// — positive AND negative — so a switch into the upcoming track never sees a
// loading flip in either direction (lyrics or NoLyricsView).
function primeUpcomingTrack(t: QueueTrack | undefined, remoteBlur: boolean) {
  if (!t || !t.track_id || !t.name || !t.artist) return
  // skip podcast episodes (useLyrics never caches them anyway)
  if (t.uri?.startsWith('spotify:episode:')) return
  const id = t.track_id
  if (upcomingHandled.has(id)) return
  if (upcomingHandled.size >= UPCOMING_CEILING) {
    // drop oldest, mirrors markSeen
    const oldest = upcomingHandled.keys().next().value
    if (oldest !== undefined) upcomingHandled.delete(oldest)
  }
  upcomingHandled.add(id)
  // mark the uri seen so the deep prefetch skips track[0] — lyrics primed
  // here, image fetched below; no double work on either side
  if (t.uri) markSeen(t.uri)
  if (t.image_url) prefetchImage(remoteBlur ? remoteArtUrl(t.image_url) : t.image_url)
  void fetchLyrics(id, { track: t.name, artist: t.artist, album: t.album })
    .then((lyrics) => primeLyricsCache(id, lyrics ?? EMPTY_LYRICS))
    .catch(() => {
      // network/5xx: allow a later status update to retry
      upcomingHandled.delete(id)
    })
}

function runPrefetch(status: ObserverStatus, remoteBlur: boolean) {
  if (!status.active) return
  const next = (status.next_tracks ?? []).slice(0, PREFETCH_NEXT)
  const prev = (status.prev_tracks ?? []).slice(0, PREFETCH_PREV)
  for (const t of [...next, ...prev]) {
    if (!t.uri || seenUris.has(t.uri)) continue
    markSeen(t.uri)
    if (t.image_url) prefetchImage(remoteBlur ? remoteArtUrl(t.image_url) : t.image_url)
    prefetchLyrics(t)
  }
}

export function usePrefetch(status: ObserverStatus | null) {
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  })
  // epic10 task 2: prefetch the url the menu cards actually load — the Pi's
  // pre-processed artwork when remoteBlur is on, the direct CDN url
  // otherwise (standalone, unchanged)
  const remoteBlur = useMiraServer().features.remoteBlur

  const lastFiredUriRef = useRef<string | null>(null)
  const currentUri = status?.active ? status.track_uri : null

  useEffect(() => {
    if (!currentUri) return
    if (currentUri === lastFiredUriRef.current) return

    const timer = window.setTimeout(() => {
      const s = statusRef.current
      if (!s?.active || s.track_uri !== currentUri) return
      lastFiredUriRef.current = currentUri
      runPrefetch(s, remoteBlur)
    }, PREFETCH_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [currentUri, remoteBlur])

  // issue #36: prepare next_tracks[0] the moment it appears — no 5s wait, so a
  // track switch always lands on a primed cache entry (lyrics OR explicit
  // "no lyrics") and the layout never flips for queued switches. The short
  // debounce coalesces bursty observer status updates; the name/artist/album
  // deps make it retry once sparse queue metadata fills in, while the
  // upcomingHandled set keeps every refire a no-op after the first fetch.
  const upcoming = status?.active ? (status.next_tracks ?? [])[0] : undefined
  useEffect(() => {
    if (!upcoming?.track_id || !upcoming.name || !upcoming.artist) return

    const timer = window.setTimeout(() => {
      // re-read the live status: this burst may have been superseded (skip,
      // queue change) while the debounce was pending
      const s = statusRef.current
      if (!s?.active || s.track_uri !== currentUri) return
      primeUpcomingTrack((s.next_tracks ?? [])[0], remoteBlur)
    }, UPCOMING_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [
    upcoming?.track_id,
    upcoming?.name,
    upcoming?.artist,
    upcoming?.album,
    currentUri,
    remoteBlur,
  ])
}
