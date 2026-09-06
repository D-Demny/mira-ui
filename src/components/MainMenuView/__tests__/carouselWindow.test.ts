import { describe, expect, it } from 'vitest'
import {
  CARD_GAP,
  CARD_WIDTH,
  CAROUSEL_EDGE_PADDING,
  NO_WINDOW_THRESHOLD,
  WINDOW_MAX_CARDS,
  dialScrollLeft,
  leadingSpacerWidth,
  trailingSpacerWidth,
  windowRange,
} from '../carouselWindow'

const STEP = CARD_WIDTH + CARD_GAP

describe('windowRange (bug18)', () => {
  it('renders short lists (< threshold) in full', () => {
    expect(windowRange(NO_WINDOW_THRESHOLD - 1, 5, null)).toEqual({
      start: 0,
      end: NO_WINDOW_THRESHOLD - 1,
    })
  })

  it('mounts a symmetrical 16/16 buffer around the focus for long lists', () => {
    expect(windowRange(50, 25, null)).toEqual({ start: 9, end: 42 })
  })

  it('clips at the start of the list', () => {
    expect(windowRange(50, 0, null)).toEqual({ start: 0, end: 17 })
  })

  it('clips at the end of the list', () => {
    expect(windowRange(50, 49, null)).toEqual({ start: 33, end: 50 })
  })

  it('treats a missing focus as index 0', () => {
    expect(windowRange(50, undefined, null)).toEqual({ start: 0, end: 17 })
  })

  it('disables the viewport guard when the carousel measures 0 wide (jsdom)', () => {
    expect(windowRange(50, 25, { scrollLeft: 0, width: 0 })).toEqual({ start: 9, end: 42 })
  })

  it('keeps still-visible cards mounted when the scroll lags behind the focus (capped, bug48)', () => {
    // focus is at 30 but the physical scroll is still near the start of the
    // list: the look-behind must not unmount the cards that are still on
    // screen — bug48 bounds the widening at WINDOW_MAX_CARDS, so the window
    // no longer stretches over the whole list (452 of 501 cards observed on
    // device before the cap)
    const range = windowRange(50, 30, { scrollLeft: 0, width: 800 })
    expect(range.end).toBe(47) // focus side (look-ahead) kept
    expect(range.start).toBe(7) // capped: end - WINDOW_MAX_CARDS
    expect(range.end - range.start).toBeLessThanOrEqual(WINDOW_MAX_CARDS)
  })

  it('does not shrink the index window once the scroll has caught up', () => {
    const scrollLeft = 30 * STEP
    expect(windowRange(50, 30, { scrollLeft, width: 800 })).toEqual({ start: 14, end: 47 })
  })

  it('widens the window to cover cards visible ahead of a lagging focus', () => {
    // focus is at 5 but the viewport already shows cards around index 30:
    // those must stay mounted even though they are far from the focus
    const scrollLeft = 30 * STEP
    const range = windowRange(50, 5, { scrollLeft, width: 800 })
    expect(range.start).toBe(0)
    expect(range.end).toBeGreaterThanOrEqual(35)
  })
})

describe('bug39: guard vs. foreign (stale) scroll offsets', () => {
  it('a stale offset from the previous category cannot push the window start right of index 0', () => {
    // fresh category entry: focus 0, but the measured offset still describes
    // the old category's deep scroll position
    const range = windowRange(50, 0, { scrollLeft: 30 * STEP, width: 550 })
    expect(range.start).toBe(0) // index 0 stays the leftmost rendered card
    expect(leadingSpacerWidth(range.start)).toBe(0) // no offset padding at the left edge
  })

  it('an offset beyond the end of the new list is clamped, capped (bug48), and never inverts the window', () => {
    // the guard would widen to the whole list; the bug48 cap keeps 40 cards
    // (the focus side — index 0 — is kept)
    const range = windowRange(50, 0, { scrollLeft: 60 * STEP, width: 550 })
    expect(range).toEqual({ start: 0, end: WINDOW_MAX_CARDS })
  })

  it('a freshly purged category (null metrics) renders the pure index-0 window', () => {
    expect(windowRange(50, 0, null)).toEqual({ start: 0, end: 17 })
    expect(windowRange(45, undefined, null)).toEqual({ start: 0, end: 17 })
  })

  it('within one category the guard only widens the window, never shrinks it', () => {
    const base = windowRange(50, 25, null)
    const widened = windowRange(50, 25, { scrollLeft: 40 * STEP, width: 550 })
    expect(widened.start).toBeLessThanOrEqual(base.start)
    expect(widened.end).toBeGreaterThanOrEqual(base.end)
    expect(widened.end).toBeGreaterThan(base.end)
  })
})

describe('bug48: window hard cap (WINDOW_MAX_CARDS)', () => {
  it('bounds the window at WINDOW_MAX_CARDS even for an extreme scroll lag', () => {
    // focus deep in the list, viewport still at the very start (the worst
    // case of a lagging smooth scroll): the unbounded guard would have
    // mounted nearly the whole list (452 of 501 cards on device)
    const range = windowRange(501, 400, { scrollLeft: 0, width: 550 })
    expect(range.end - range.start).toBe(WINDOW_MAX_CARDS)
    // the focus stays mounted
    expect(range.start).toBeLessThanOrEqual(400)
    expect(range.end).toBeGreaterThan(400)
  })

  it('keeps the focus side when cutting: lag behind the focus (dial right)', () => {
    const range = windowRange(501, 400, { scrollLeft: 0, width: 550 })
    // the lag is to the LEFT of the focus — the right (focus) edge is kept:
    // base look-ahead 400 + 1 + 16 = 417
    expect(range.end).toBe(417)
    expect(range.start).toBe(417 - WINDOW_MAX_CARDS)
  })

  it('keeps the focus side when cutting: lag ahead of the focus (dial left)', () => {
    const range = windowRange(501, 100, { scrollLeft: 400 * STEP, width: 550 })
    // the lag is to the RIGHT of the focus — the left (focus) edge is kept:
    // base look-behind 100 - 16 = 84
    expect(range.start).toBe(84)
    expect(range.end).toBe(84 + WINDOW_MAX_CARDS)
    expect(range.start).toBeLessThanOrEqual(100)
    expect(range.end).toBeGreaterThan(100)
  })

  it('the cap only engages beyond the base window size (33 cards)', () => {
    // no scroll: the pure base window is untouched
    expect(windowRange(50, 25, null)).toEqual({ start: 9, end: 42 })
    // guard widening that stays within the cap is untouched
    expect(windowRange(50, 25, { scrollLeft: 40 * STEP, width: 550 })).toEqual({
      start: 9,
      end: 45,
    })
  })

  it('the guard still only widens the window within the cap (never shrinks vs. base)', () => {
    const base = windowRange(50, 25, null)
    const widened = windowRange(50, 25, { scrollLeft: 40 * STEP, width: 550 })
    expect(widened.start).toBeLessThanOrEqual(base.start)
    expect(widened.end).toBeGreaterThanOrEqual(base.end)
    expect(widened.end - widened.start).toBeLessThanOrEqual(WINDOW_MAX_CARDS)
  })

  it('short lists (< threshold) stay fully mounted regardless of the cap', () => {
    expect(windowRange(39, 10, { scrollLeft: 0, width: 550 })).toEqual({ start: 0, end: 39 })
  })
})

describe('spacer widths', () => {
  it('leading spacer matches the space of the missing cards', () => {
    expect(leadingSpacerWidth(0)).toBe(0)
    expect(leadingSpacerWidth(9)).toBe(9 * STEP - CARD_GAP)
  })

  it('trailing spacer matches the space of the missing cards', () => {
    expect(trailingSpacerWidth(0)).toBe(0)
    expect(trailingSpacerWidth(8)).toBe(8 * CARD_WIDTH + 7 * CARD_GAP)
  })
})

// bug50: the target Chromium 69 ignores flex `gap` (Chrome 84+), so the
// carousel's spacing is margin-based (flex-gap-x on `.carousel`). These tests
// pin the geometry the dial math depends on: the windowed spacer layout must
// reproduce the with-gap scroll width (97202 px in the device's 501-track
// case — the value the dial clamp is derived from), and the centering must
// keep the focused card fully inside the visible content area, i.e. never to
// the left of the carousel's edge padding. The carousel viewport starts
// exactly at the fixed 250px sidebar's right edge (MainMenuView.module.scss),
// so "card left ≥ edge padding" is the Bug50 exit criterion: the focused card
// always stays fully to the right of the sidebar, at any depth of the list.
describe('bug50: margin-based geometry invariants', () => {
  // the windowed content width under the flex-gap-x layout (a CARD_GAP margin
  // on every child after the first): [leading spacer + margin] + cards +
  // inter-card margins + [margin + trailing spacer]
  const windowedContentWidth = (count: number, start: number, end: number): number => {
    const missing = count - end
    let width = (end - start) * CARD_WIDTH + Math.max(0, end - start - 1) * CARD_GAP
    if (start > 0) width += leadingSpacerWidth(start) + CARD_GAP
    if (missing > 0) width += CARD_GAP + trailingSpacerWidth(missing)
    return width
  }
  const fullContentWidth = (count: number) => count * CARD_WIDTH + (count - 1) * CARD_GAP

  it('keeps the with-gap card pitch (STEP) for every mounted card, in every window position', () => {
    // card f's left edge in scroll coordinates must be edge padding + f * STEP
    // regardless of where the window sits — with the old flex-gap CSS the
    // on-device pitch collapsed to CARD_WIDTH while the spacers kept the STEP
    // arithmetic, which is exactly the Bug50 drift
    for (const [start, end] of [
      [0, 17],
      [443, 476],
      [472, 501],
    ] as const) {
      const offset = start > 0 ? leadingSpacerWidth(start) + CARD_GAP : 0
      for (const index of [start, Math.floor((start + end) / 2), end - 1]) {
        const cardLeft =
          CAROUSEL_EDGE_PADDING + offset + (index - start) * (CARD_WIDTH + CARD_GAP)
        expect(cardLeft, `card ${index} in window [${start}, ${end})`).toBe(
          CAROUSEL_EDGE_PADDING + index * STEP,
        )
      }
    }
  })

  it('reproduces the full list scroll width in every spacer configuration', () => {
    const cases: [number, number, number][] = [
      [501, 443, 476], // the device's 501-track list, mid window (both spacers)
      [501, 0, 17], // list start (trailing spacer only)
      [501, 472, 501], // list end (leading spacer only)
      [501, 443, 501], // deep window reaching the end
      [50, 9, 42], // 16/16 mid window
      [50, 0, 50], // short list, no spacers
      [2, 0, 2],
    ]
    for (const [count, start, end] of cases) {
      expect(windowedContentWidth(count, start, end), `[${start}, ${end}) of ${count}`).toBe(
        fullContentWidth(count),
      )
    }
  })

  it('matches the device-measured 501-track scroll width (97202 px)', () => {
    // the W2b-v3 measurement: the with-gap geometry must yield scrollWidth
    // 97202 (97170 content + 32 edge padding) — the pre-fix CR69 layout
    // measured 96386 because the card gaps were never rendered
    const { start, end } = windowRange(501, 459, null)
    const scrollWidth = windowedContentWidth(501, start, end) + CAROUSEL_EDGE_PADDING * 2
    expect(scrollWidth).toBe(97202)
  })

  it('keeps the focused card fully inside the content area for every index (right of the sidebar)', () => {
    // deep indices included — the Bug50 symptom was the focused card drifting
    // under the 250px sidebar the further right the user scrolled; the left
    // edge must never cross the carousel's edge padding (screen x ≥ 250 + 16)
    // and the right edge must never cross the opposite edge padding, at any
    // index and including both end clamps
    const count = 501
    const viewportW = 550 // the device's content-pane carousel width
    for (let index = 0; index < count; index++) {
      const scrollLeft = dialScrollLeft(count, index, viewportW)
      const cardLeft = CAROUSEL_EDGE_PADDING + index * STEP - scrollLeft
      const cardRight = cardLeft + CARD_WIDTH
      expect(cardLeft, `index ${index}`).toBeGreaterThanOrEqual(CAROUSEL_EDGE_PADDING)
      expect(cardRight, `index ${index}`).toBeLessThanOrEqual(viewportW - CAROUSEL_EDGE_PADDING)
    }
  })

  it('keeps the last card fully visible at the end clamp (deep index, no clamp drift)', () => {
    // the end clamp must not push the focused card left of the content area
    // (the pre-fix end state had the focused card under the sidebar while the
    // viewport showed cards to the RIGHT of the focus)
    const viewportW = 550
    const scrollLeft = dialScrollLeft(501, 500, viewportW)
    expect(scrollLeft).toBe(
      Math.max(0, fullContentWidth(501) + CAROUSEL_EDGE_PADDING * 2 - viewportW),
    )
    const cardLeft = CAROUSEL_EDGE_PADDING + 500 * STEP - scrollLeft
    expect(cardLeft).toBeGreaterThanOrEqual(CAROUSEL_EDGE_PADDING)
    expect(cardLeft + CARD_WIDTH).toBeLessThanOrEqual(viewportW - CAROUSEL_EDGE_PADDING)
  })

  it('centers the focused card on the viewport middle for interior indices', () => {
    // with the margin-based pitch the centering target lands on the viewport
    // center — in screen coordinates 250 (sidebar) + 275 (half of 550) = 525,
    // the content pane's middle, never under the sidebar
    const viewportW = 550
    for (const index of [17, 100, 346, 459, 475]) {
      const scrollLeft = dialScrollLeft(501, index, viewportW)
      const cardCenterScreen = 250 + CAROUSEL_EDGE_PADDING + index * STEP + CARD_WIDTH / 2 - scrollLeft
      expect(cardCenterScreen, `index ${index}`).toBe(250 + viewportW / 2)
    }
  })
})

describe('dialScrollLeft (bug47 R2, F2)', () => {
  // the carousel is a flex row (a CARD_GAP margin on every child after the
  // first, bug50) with CAROUSEL_EDGE_PADDING on both ends; the spacers keep
  // the windowed scroll width identical to the full list's, so the clamp uses
  // the unwindowed total
  const maxScroll = (count: number, viewportW: number) =>
    Math.max(0, count * CARD_WIDTH + (count - 1) * CARD_GAP + CAROUSEL_EDGE_PADDING * 2 - viewportW)
  const cardCenter = (index: number) =>
    CAROUSEL_EDGE_PADDING + index * STEP + CARD_WIDTH / 2

  it('centers an interior card exactly like scrollIntoView(inline: center)', () => {
    // the focused card's center lands on the viewport's center
    const viewportW = 550
    for (const index of [5, 25, 45]) {
      const scrollLeft = dialScrollLeft(50, index, viewportW)
      expect(scrollLeft + viewportW / 2).toBe(cardCenter(index))
    }
  })

  it('clamps to 0 at the start of the list (card 0 cannot be centered)', () => {
    // card 0's center (101 px) is left of the viewport center (275 px) — the
    // native call would stop at the start of the list
    expect(dialScrollLeft(50, 0, 550)).toBe(0)
    expect(dialScrollLeft(1001, 0, 550)).toBe(0)
  })

  it('clamps to the maximum scroll offset at the end of the list', () => {
    const viewportW = 550
    // the last card's center lies beyond the end of the scroll range — the
    // native call would stop at scrollWidth - clientWidth
    expect(dialScrollLeft(50, 49, viewportW)).toBe(maxScroll(50, viewportW))
    expect(dialScrollLeft(1001, 1000, viewportW)).toBe(maxScroll(1001, viewportW))
    // and the clamp is real (the unclamped target would overshoot)
    expect(cardCenter(49) - viewportW / 2).toBeGreaterThan(maxScroll(50, viewportW))
  })

  it('stays at 0 when the viewport is wider than the whole list', () => {
    // 2 cards = 364 px content + 32 px padding = 396 px < 1000 px viewport
    expect(dialScrollLeft(2, 0, 1000)).toBe(0)
    expect(dialScrollLeft(2, 1, 1000)).toBe(0)
  })

  it('matches the windowed spacer width (the clamp is independent of windowing)', () => {
    // a windowed list has the same total scroll width as the full list, so
    // the clamp target is the same: windowing must not shift the centering
    const viewportW = 550
    const full = dialScrollLeft(50, 49, viewportW)
    // trailing spacer for the 8 missing cards after a [0,42) window:
    // 8*CARD_WIDTH + 7*CARD_GAP — the scroll width is unchanged
    expect(trailingSpacerWidth(8)).toBe(8 * CARD_WIDTH + 7 * CARD_GAP)
    expect(dialScrollLeft(50, 25, viewportW) + viewportW / 2).toBe(cardCenter(25))
    expect(full).toBe(maxScroll(50, viewportW))
  })
})
