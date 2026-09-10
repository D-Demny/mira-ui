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
// bug54: the main-menu sidebar width in px (SCSS source of truth:
// $sidebar-width in styles/_variables.scss). In underflow mode (the 'blur'
// menu background, Bug58 T2 — see slidesUnderSidebar in MainMenuView.tsx)
// the carousel viewport extends underneath the sidebar by exactly this
// width — keep in sync with the SCSS variable.
export const SIDEBAR_WIDTH = 250
// bug59: how long (ms) after the LAST scroll write a still-settling smooth
// animation is considered "in flight" by the live-blur rAF loop in
// ContentCarousel.tsx. Chromium's native scroll-behavior interpolation for a
// ~1–3 card step on the S905D2 finishes well inside this window; beyond it,
// if the physical offset is within 1px of the target, the animation is done
// and ownership of the .blurred classes hands back to React (an invisible
// handoff — see sidebarOverlapAt, whose set equals sidebarOverlap's at the
// settled position). Lives HERE instead of in the component on purpose: this
// module is plain math (react-refresh, unit-testable), and the loop's test
// harness needs the constant from the same source as the production code —
// a react-based module must not export non-components.
export const ANIM_SETTLE_MS = 350

// bug54: the geometry of the viewport the centering math is written for.
// Omitted (the default) means today's solid layout: the viewport starts at
// the sidebar's right edge, the first card's rest position is the edge
// padding, and the centering target is the viewport's middle. The explicit
// geometry below is the "underflow" layout — the viewport spans the FULL
// screen (the content pane slides under the sidebar): the first card's rest
// position is the sidebar width + edge padding, the FOCUSED card's left
// edge may never cross the sidebar's right edge (minVisibleX — the Bug50
// boundary: the focused card is always fully visible, all other cards may
// slide under the glass), and the centering target is the middle of the
// VISIBLE zone right of the sidebar (the card is centered where it can
// actually be seen).
// bug54 (08.09.2026 user change) / bug58 T2: only the 'blur' menu background
// enables the underflow layout — 'solid', 'translucent' and 'clear' use the
// solid geometry (cards are clipped at the menu edge, never visible under
// it). The 'blur' mode needs the cards to pass under the menu to be blurred
// there.
export interface CarouselGeometry {
  // rest position of the first card (scroll coordinates); default 16
  leftInset: number
  // the focused card's left edge (screen x) may never be left of this;
  // default 16 (the carousel's left edge padding)
  minVisibleX: number
  // the scroll coordinate the focused card's center should land on;
  // default viewportW / 2
  centerTarget: number
}

// bug47 R2 (F2): the scrollLeft that centers card `focusedIndex` in a
// `viewportW`-wide carousel, computed from constants alone — no layout read,
// so the dial tick path stays read-free. Mirrors
// scrollIntoView({ inline: 'center' }): the card's center in scroll
// coordinates (leftInset + i * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2)
// minus the centering target, clamped to [0, maxScroll] and to the left
// boundary exactly like the native call. The spacers keep the windowed
// scroll width identical to the full list's, so the clamp uses the
// unwindowed total width.
// bug50: on the target device the card pitch is margin-based (flex-gap-x,
// Chromium 69 ignores flex `gap`), so this with-gap arithmetic matches the
// rendered geometry — before that fix the measured card positions sat 400+ px
// left of the values above and the focused card ended up under the sidebar.
// bug54: with an explicit CarouselGeometry the same formula serves the
// translucent underflow (full-screen viewport, center in the visible zone).
// Without one, every value falls back to the solid layout — bit-exact
// identical to the pre-bug54 formula.
export function dialScrollLeft(
  count: number,
  focusedIndex: number,
  viewportW: number,
  geo?: CarouselGeometry,
): number {
  const pitch = CARD_WIDTH + CARD_GAP
  const leftInset = geo?.leftInset ?? CAROUSEL_EDGE_PADDING
  const minVisibleX = geo?.minVisibleX ?? CAROUSEL_EDGE_PADDING
  const centerTarget = geo?.centerTarget ?? viewportW / 2
  const center = leftInset + focusedIndex * pitch + CARD_WIDTH / 2
  const contentWidth = count > 0 ? count * CARD_WIDTH + (count - 1) * CARD_GAP : 0
  // the right edge padding stays CAROUSEL_EDGE_PADDING in both geometries
  const maxScroll = Math.max(0, contentWidth + leftInset + CAROUSEL_EDGE_PADDING - viewportW)
  // bug50/bug54: hard left boundary — the focused card's left edge must
  // never be scrolled left of `minVisibleX` (default: the card's rest
  // position; translucent: the sidebar's right edge, i.e. the focused card
  // is ALWAYS fully visible while the other cards slide under the glass).
  // Pure centering already satisfies the bound; the clamp makes the
  // guarantee explicit (it is the formula's contract, not a property of the
  // centering target alone).
  const leftBoundary = focusedIndex * pitch + (leftInset - minVisibleX)
  return Math.max(0, Math.min(center - centerTarget, maxScroll, leftBoundary))
}

// bug59: the small candidate window [lo, hi] of card indices that can ever
// sit under the glass at a given scroll offset. Shared by sidebarOverlap()
// (dial-target offset) and sidebarOverlapAt() (physical offset) so both use
// EXACTLY the same window arithmetic — their sets are identical whenever the
// two offsets coincide (the settle handoff is invisible because of it).
function overlapCandidateRange(
  scrollLeftPx: number,
  leftInset: number,
  underflowPx: number,
): { lo: number; hi: number } {
  const pitch = CARD_WIDTH + CARD_GAP
  return {
    // card i's screen x is leftInset + i * pitch - scrollLeft; it can be more
    // than half under the edge only within this range (T4 center rule — the
    // [lo, hi] window was derived for the any-pixel rule (x < underflowPx)
    // and still encloses the stricter T4 set: a card whose center crossed the
    // edge has x < underflowPx too)
    lo: Math.floor((scrollLeftPx - leftInset - CARD_WIDTH) / pitch),
    hi: Math.ceil((scrollLeftPx - leftInset + underflowPx) / pitch),
  }
}

// bug58 T3: the card indices that overlap the sidebar area in underflow mode
// (the 'blur' menu background). ContentCarousel blurs exactly these cards
// (.blurred, `filter: blur`) while they sit under the translucent glass and
// REMOVES the filter as soon as they leave — a `filter` creates a compositing
// layer per affected element, which is expensive on the weak S905D2, so
// permanently blurred cards are not acceptable (Bug58 Technical Base Finding).
// Pure arithmetic from the SAME constants as dialScrollLeft() — the card's
// screen x is leftInset + i * pitch - scrollLeft, and the scroll offset is
// the DIAL TARGET for the current focus (not a measured value) — so deriving
// the set in the render phase stays read-free (bug47/bug48: per-frame layout
// reads/DOM writes are a no-go). Only a few cards can overlap at all (the
// covered area is underflowPx + CARD_WIDTH wide ≈ 3 card pitches), and the
// focused card never does (minVisibleX keeps it fully right of the edge).
// bug58 T4 (device report Build #110/#111): "under the glass" means the
// card's CENTER has crossed the sidebar's right edge — a card is blurred only
// once MORE THAN HALF of it sits under the sidebar (x + CARD_WIDTH/2 <
// underflowPx, strict). The T3 any-pixel rule (x < underflowPx) fully blurred
// a card whose leftmost ~4 px were under the edge while ~98 % was still
// visible — the visible false positive on device. The stricter set also caps
// the concurrently blurred compositing layers at 2 instead of 3 (an FPS
// bonus on the weak S905D2).
export function sidebarOverlap(
  count: number,
  focusedIndex: number,
  viewportW: number,
  underflowPx: number,
): Set<number> {
  // solid layout (underflowPx 0): the "sidebar area" has zero width, so no
  // card can overlap it — never derive a set from the geometry in that case
  if (underflowPx <= 0) return new Set<number>()
  const leftInset = CAROUSEL_EDGE_PADDING + underflowPx
  const scrollLeft = dialScrollLeft(count, focusedIndex, viewportW, {
    leftInset,
    minVisibleX: underflowPx,
    centerTarget: underflowPx + (viewportW - underflowPx) / 2,
  })
  // card i is under the glass iff its center lies left of the edge
  // (x + CARD_WIDTH/2 < underflowPx, T4) and any part is still on screen
  // (x + CARD_WIDTH > 0 — a fully-left card is off-screen). Solve the two
  // inequalities for the small candidate range instead of scanning the whole
  // list.
  const pitch = CARD_WIDTH + CARD_GAP
  const { lo, hi } = overlapCandidateRange(scrollLeft, leftInset, underflowPx)
  const out = new Set<number>()
  for (let i = Math.max(0, lo); i <= Math.min(count - 1, hi); i++) {
    const x = leftInset + i * pitch - scrollLeft
    if (x + CARD_WIDTH / 2 < underflowPx && x + CARD_WIDTH > 0) out.add(i)
  }
  return out
}

// bug59: the blur set for an ARBITRARY physical scroll offset — the live rAF
// loop in ContentCarousel.tsx calls this on every frame while a smooth
// animation is in flight, following the PHYSICAL scrollLeft instead of the
// dial target (the target-index set desyncs from the lagging animation by up
// to ~200 ms — exactly the viewport-blur leak of Bug59). Same constants, same
// candidate window, same T4 center rule as sidebarOverlap(): at a settled
// offset (physical == target) both sets are identical, which is what makes
// the handoff back to React's render-derived set invisible.
export function sidebarOverlapAt(scrollLeftPx: number, count: number, underflowPx: number): Set<number> {
  if (underflowPx <= 0) return new Set<number>()
  const pitch = CARD_WIDTH + CARD_GAP
  const leftInset = CAROUSEL_EDGE_PADDING + underflowPx
  const { lo, hi } = overlapCandidateRange(scrollLeftPx, leftInset, underflowPx)
  const out = new Set<number>()
  for (let i = Math.max(0, lo); i <= Math.min(count - 1, hi); i++) {
    const x = leftInset + i * pitch - scrollLeftPx
    if (x + CARD_WIDTH / 2 < underflowPx && x + CARD_WIDTH > 0) out.add(i)
  }
  return out
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
// (the carousel is a flex row with a CARD_GAP margin on every child after the
// first — flex-gap-x, bug50: margins because the target Chromium 69 ignores
// flex `gap`)
export function leadingSpacerWidth(start: number): number {
  return start > 0 ? start * (CARD_WIDTH + CARD_GAP) - CARD_GAP : 0
}

export function trailingSpacerWidth(missing: number): number {
  return missing > 0 ? missing * CARD_WIDTH + (missing - 1) * CARD_GAP : 0
}
