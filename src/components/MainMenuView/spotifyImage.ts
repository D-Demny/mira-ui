// PERF-A/B (temp) — Bug58 lowres-art experiment (debug/fps-bug58 only, never
// merged into main): rewrite Spotify CDN 640px image urls to the 300px variant
// so the menu decodes smaller bitmaps. Temporary — strip together with the
// other PERF-A/B markers when the branch is deleted.

// i.scdn.co album art: https://i.scdn.co/image/<16-hex size prefix><8-hex image hash>
const SCDN_640_PREFIX = 'ab67616d00001e02'
const SCDN_300_PREFIX = 'ab67616d00003358'
const SCDN_640_RE = /^(https?:\/\/i\.scdn\.co\/image\/)ab67616d00001e02[0-9a-f]{8}/i

/**
 * Maps a 640px i.scdn.co artwork url to its 300px twin (same 8-char image
 * hash, swapped size prefix). Every other url — already-300/64 urls, other
 * prefixes, non-Spotify urls, Pi pre-processed routes — is returned unchanged.
 * Pure: no I/O, safe to call in a memo.
 */
export function downsizeSpotifyUrl(url: string): string {
  if (!SCDN_640_RE.test(url)) return url
  // anchored match guarantees the prefix sits right after i.scdn.co/image/
  const at = url.indexOf(SCDN_640_PREFIX)
  return url.slice(0, at) + SCDN_300_PREFIX + url.slice(at + SCDN_640_PREFIX.length)
}
