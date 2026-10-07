import { describe, expect, it } from 'vitest'
import {
  ART_LOAD_MAX_MS,
  ART_LOAD_STEP_MS,
  ART_LOAD_VISIBLE_FREE,
  artLoadDelayMs,
} from '../artLoadDelay'

describe('artLoadDelayMs (#90 entry-burst stagger)', () => {
  it('is 0 within the visible band (first paint stays instant)', () => {
    for (let d = 0; d <= ART_LOAD_VISIBLE_FREE; d++) {
      expect(artLoadDelayMs(d)).toBe(0)
    }
  })

  it('grows linearly, one step per card of distance beyond the band', () => {
    expect(artLoadDelayMs(ART_LOAD_VISIBLE_FREE + 1)).toBe(ART_LOAD_STEP_MS)
    expect(artLoadDelayMs(ART_LOAD_VISIBLE_FREE + 5)).toBe(5 * ART_LOAD_STEP_MS)
  })

  it('caps at ART_LOAD_MAX_MS no matter how far (the whole window fills in bounded time)', () => {
    const wayOverCap = ART_LOAD_VISIBLE_FREE + Math.ceil(ART_LOAD_MAX_MS / ART_LOAD_STEP_MS) + 50
    expect(artLoadDelayMs(wayOverCap)).toBe(ART_LOAD_MAX_MS)
  })
})
