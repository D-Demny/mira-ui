import type { ObserverStatus } from '@/api/types'

/**
 * Merge an incoming observer status snapshot over the previously displayed one.
 *
 * Daemon WS `observer_track_changed` events often carry the new track_uri while
 * TrackName/TrackArtist/TrackImageUrl are still empty (metadata lags the switch),
 * which would render "Unknown track" + placeholder art until the next full poll.
 * This merge backfills display fields from the previous status' `next_tracks`
 * queue — which already contains the incoming track — or, when there is no match,
 * keeps the old display values so they linger gracefully instead of flashing a
 * placeholder (issue #36).
 *
 * Pure function, exported for unit testing without React.
 */
export function mergeObserverStatus(
  prev: ObserverStatus | null,
  incoming: ObserverStatus,
): ObserverStatus {
  if (prev === null || prev.active !== true || incoming.active !== true) return incoming

  // Backfill only applies when the track actually switched AND the previous queue
  // already listed the incoming track.
  const queued =
    incoming.track_uri !== prev.track_uri
      ? (prev.next_tracks?.find((t) => t.uri === incoming.track_uri) ?? null)
      : null

  const pick = (value: string, fromQueue: string | undefined, previous: string): string =>
    value.trim() !== ''
      ? value
      : queued && fromQueue !== undefined && fromQueue.trim() !== ''
        ? fromQueue
        : previous

  return {
    ...incoming,
    track_name: pick(incoming.track_name, queued?.name, prev.track_name),
    track_artist: pick(incoming.track_artist, queued?.artist, prev.track_artist),
    track_album: pick(incoming.track_album, queued?.album, prev.track_album),
    track_image: pick(incoming.track_image, queued?.image_url, prev.track_image),
    // Use incoming queues when non-empty; otherwise keep the previously displayed ones.
    prev_tracks:
      incoming.prev_tracks && incoming.prev_tracks.length > 0
        ? incoming.prev_tracks
        : prev.prev_tracks,
    next_tracks:
      incoming.next_tracks && incoming.next_tracks.length > 0
        ? incoming.next_tracks
        : prev.next_tracks,
  }
}
