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
// keep in sync with $card-art-size / $s-6 in ContentCarousel.module.scss
export const CARD_WIDTH = 170
export const CARD_GAP = 24

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
// unmounted mid-scroll (bug18).
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
