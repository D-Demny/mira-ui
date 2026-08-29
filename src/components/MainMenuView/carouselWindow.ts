// bug5/bug6/bug18: pure windowing math for the content carousel. Kept in a
// plain (non-component) module so ContentCarousel.tsx keeps exporting only
// components (react-refresh) and the math is directly unit-testable.

// large symmetrical buffers so a lagging smooth scroll (fast dial) never
// exposes an unmounted (blank) area on either side (bug18)
export const WINDOW_BEFORE = 16
export const WINDOW_AFTER = 16
// lists shorter than this render in full — windowing only pays off for long
// lists and adds unmount churn for short ones (bug18)
export const NO_WINDOW_THRESHOLD = 40
// keep this many extra cards mounted beyond the physical scroll viewport while
// a scroll transition is in flight (bug18 viewport safety guard)
export const SCROLL_SAFE_MARGIN = 2
// bug48: hard cap on how many cards the viewport safety guard may mount.
// Without the cap, a scroll position far behind the focus (fast dialing with
// a lagging smooth scroll) widens the window over nearly the ENTIRE list
// (observed on device: 452 of 501 cards mounted). Mounted cards hold their
// decoded covers non-evictable in Chromium's image cache — together with the
// pre-decode cache that pushed the renderer into the OOM crash after ~13 h
// dwell. The cap must still cover the base window (16 + 1 + 16 = 33 cards)
// plus the worst-case physical view beyond it: the ~550px viewport holds ~3
// cards and the guard adds SCROLL_SAFE_MARGIN on each side — 40 keeps ≥7
// cards of slack on one side. When the cap cuts, the side AWAY from the
// focus is cut (the lag is on that side; bug47's instant dial scroll removes
// the lag in the first place).
export const WINDOW_MAX_CARDS = 40
// keep in sync with $card-art-size / $s-6 in ContentCarousel.module.scss
export const CARD_WIDTH = 170
export const CARD_GAP = 24
// keep in sync with $s-4 (the carousel's horizontal edge padding) in
// ContentCarousel.module.scss
export const CAROUSEL_EDGE_PADDING = 16

// bug47 R2 (F2): the scrollLeft that centers card `focusedIndex` in a
// `viewportW`-wide carousel, computed from constants alone — no layout read,
// so the dial tick path stays read-free. Mirrors
// scrollIntoView({ inline: 'center' }): the card's center in scroll
// coordinates (edge padding + i * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2)
// minus half the viewport, clamped to [0, maxScroll] exactly like the native
// call. The spacers keep the windowed scroll width identical to the full
// list's, so the clamp uses the unwindowed total width.
export function dialScrollLeft(count: number, focusedIndex: number, viewportW: number): number {
  const center = CAROUSEL_EDGE_PADDING + focusedIndex * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2
  const contentWidth = count > 0 ? count * CARD_WIDTH + (count - 1) * CARD_GAP : 0
  const maxScroll = Math.max(0, contentWidth + CAROUSEL_EDGE_PADDING * 2 - viewportW)
  return Math.max(0, Math.min(center - viewportW / 2, maxScroll))
}

// the physical scroll position of the carousel (measured after render); used
// by the viewport safety guard (bug18). width === 0 (e.g. in jsdom) disables
// the guard so the pure index window applies.
export interface ScrollMetrics {
  scrollLeft: number
  width: number
}

// which slice of the card list is mounted. Short lists (< NO_WINDOW_THRESHOLD)
// render in full. Longer lists mount a symmetrical WINDOW_BEFORE/WINDOW_AFTER
// buffer around the focus, widened so the currently visible cards are never
// unmounted mid-scroll (bug18) — but never beyond WINDOW_MAX_CARDS (bug48).
export function windowRange(
  count: number,
  focusedIndex: number | undefined,
  scroll: ScrollMetrics | null,
): { start: number; end: number } {
  if (count < NO_WINDOW_THRESHOLD) return { start: 0, end: count }
  const center = focusedIndex ?? 0
  let start = Math.max(0, center - WINDOW_BEFORE)
  let end = Math.min(count, center + 1 + WINDOW_AFTER)
  if (scroll && scroll.width > 0) {
    const step = CARD_WIDTH + CARD_GAP
    const visibleLeft = Math.max(0, Math.floor((scroll.scrollLeft + CARD_GAP) / step))
    const visibleRight = Math.min(count, Math.ceil((scroll.scrollLeft + scroll.width) / step))
    // only ever widens the window (keeps visible/near cards mounted)
    start = Math.min(start, Math.max(0, visibleLeft - SCROLL_SAFE_MARGIN))
    end = Math.max(end, Math.min(count, visibleRight + SCROLL_SAFE_MARGIN))
  }
  // bug48: bound the guard's widening. The lag (and thus the widening) is on
  // the side away from the focus — cut that side, keep the focus and its
  // buffer mounted. The cap only triggers beyond the 33-card base window, so
  // the cut never inverts the window (end - start > WINDOW_MAX_CARDS with
  // start ≥ 0 implies end > WINDOW_MAX_CARDS).
  if (end - start > WINDOW_MAX_CARDS) {
    if (center - start <= end - 1 - center) {
      end = start + WINDOW_MAX_CARDS
    } else {
      start = end - WINDOW_MAX_CARDS
    }
    // degenerate guard (a measured viewport wider than ~40 cards cannot
    // happen on the device): the focus must stay inside the window
    if (center < start || center >= end) {
      start = Math.max(0, center - WINDOW_BEFORE)
      end = Math.min(count, start + WINDOW_MAX_CARDS)
    }
  }
  return { start, end }
}

// spacer widths that exactly match the space the missing cards would occupy
// (the carousel is a flex row with a CARD_GAP gap between every child)
export function leadingSpacerWidth(start: number): number {
  return start > 0 ? start * (CARD_WIDTH + CARD_GAP) - CARD_GAP : 0
}

export function trailingSpacerWidth(missing: number): number {
  return missing > 0 ? missing * CARD_WIDTH + (missing - 1) * CARD_GAP : 0
}
