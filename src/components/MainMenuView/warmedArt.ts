// bug8.2: the menu pre-decodes every cover once so a sidebar preview swap
// (full carousel remount) only pays layout/paint of already decoded bitmaps
// instead of fetch+decode per tick.
// bug45 option C: the set of warmed urls is FIFO-bounded (the last strictly
// unbounded structure in the menu) — evicted urls simply get re-pre-decoded
// on the next focus. It lives in a plain (non-component) module so
// MainMenuView.tsx keeps exporting components only (react-refresh) and the
// Debug screen can report its occupancy.
export const WARMED_ART_MAX = 1000

// insertion order = warm order (Set iterates in insertion order); the oldest
// warmed url is the first key — same FIFO pattern as usePrefetch's seenUris
const warmed = new Set<string>()

// returns true when the url was newly warmed (callers start the Image fetch)
export function warmArt(url: string): boolean {
  if (warmed.has(url)) return false
  if (warmed.size >= WARMED_ART_MAX) {
    const oldest = warmed.keys().next().value
    if (oldest !== undefined) warmed.delete(oldest)
  }
  warmed.add(url)
  return true
}

export function hasWarmedArt(url: string): boolean {
  return warmed.has(url)
}

// debug readout (bug45): count + approximate size (url strings only, the
// decoded bitmaps live in Chromium's own image cache, not the JS heap)
export function warmedArtStats(): { entries: number; approxBytes: number } {
  let bytes = 0
  for (const url of warmed) bytes += url.length
  return { entries: warmed.size, approxBytes: bytes }
}

// test isolation helper
export function __resetWarmedArt(): void {
  warmed.clear()
}
