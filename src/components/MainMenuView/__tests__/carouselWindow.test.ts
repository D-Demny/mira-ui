import { describe, expect, it } from 'vitest'
import {
  CARD_GAP,
  CARD_WIDTH,
  NO_WINDOW_THRESHOLD,
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

  it('keeps still-visible cards mounted when the scroll lags behind the focus', () => {
    // focus is at 30 but the physical scroll is still near the start of the
    // list: the look-behind must not unmount the cards that are still on screen
    const range = windowRange(50, 30, { scrollLeft: 0, width: 800 })
    expect(range.start).toBe(0) // pulled back to the visible left edge
    expect(range.end).toBe(47) // index look-ahead unchanged
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
