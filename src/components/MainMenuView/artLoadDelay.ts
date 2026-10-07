// #90: the entry burst — entering a section mounts the whole carousel window
// (≤40 cards) at once and every card's <img> fires simultaneously. On the
// S905D2 that is ~17 simultaneous i.scdn.co round-trips plus one decode
// burst, visible as staggered "half-image" flashes and an entry lag
// (diagnosed on-device 2026-10-07: the browser cache itself is healthy —
// already-seen covers reload in 7–16 ms — so the fix is ORDER, not caching).
// The covers are spread out instead: cards at/within ART_LOAD_VISIBLE_FREE
// of the focus start immediately (first paint stays instant), every further
// card starts ART_LOAD_STEP_MS later per card of distance, capped so the
// whole window is queued within ART_LOAD_MAX_MS of entry. The distance is
// measured against the focus AT MOUNT only — a mounted card keeps its delay
// for life (the timers are short-lived; see ContentCarousel's mount ref).
export const ART_LOAD_VISIBLE_FREE = 5
export const ART_LOAD_STEP_MS = 80
export const ART_LOAD_MAX_MS = 800

/**
 * Cover-load delay for a card `distanceFromFocus` dial-steps away from the
 * focus. 0 while within the visible band, linear beyond it, hard-capped.
 */
export function artLoadDelayMs(distanceFromFocus: number): number {
  if (distanceFromFocus <= ART_LOAD_VISIBLE_FREE) return 0
  return Math.min(ART_LOAD_MAX_MS, (distanceFromFocus - ART_LOAD_VISIBLE_FREE) * ART_LOAD_STEP_MS)
}
