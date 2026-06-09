import { describe, expect, it } from 'vitest'
import { formatTime } from '../time'

describe('formatTime', () => {
  it('formats sub-hour durations as M:SS', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9_000)).toBe('0:09')
    expect(formatTime(125_000)).toBe('2:05')
  })

  it('formats hour-plus durations (podcasts) as H:MM:SS', () => {
    expect(formatTime(3_600_000)).toBe('1:00:00')
    expect(formatTime(4_679_000)).toBe('1:17:59')
    expect(formatTime(7_525_000)).toBe('2:05:25')
  })

  it('clamps invalid input to zero', () => {
    expect(formatTime(-1)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})
