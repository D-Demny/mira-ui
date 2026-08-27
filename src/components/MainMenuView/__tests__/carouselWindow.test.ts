import { describe, expect, it } from 'vitest'
import {
  CARD_GAP,
  CARD_WIDTH,
  NO_WINDOW_THRESHOLD,
  WINDOW_MAX_CARDS,
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
