import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { getActiveLyricIndex, useLyricStarts } from '../useLyrics'
import type { LyricsResult } from '../../api/types'

describe('getActiveLyricIndex', () => {
  it('returns -1 for an empty starts array', () => {
    expect(getActiveLyricIndex([], 1_000, 0)).toBe(-1)
  })

  it('returns -1 when position is before the first line', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 500, 0)).toBe(-1)
  })

  it('returns the index of a line whose start equals position', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 2_000, 0)).toBe(1)
  })

  it('returns the previous line index when position is between two starts', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 2_500, 0)).toBe(1)
  })

  it('returns the last index when position is past the last line', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 999_999, 0)).toBe(2)
  })

  it('applies a positive offset (lyrics ahead of audio) before searching', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 400, 600)).toBe(0)
  })

  it('applies a negative offset (lyrics lag audio) before searching', () => {
    expect(getActiveLyricIndex([1_000, 2_000, 3_000], 1_200, -500)).toBe(-1)
  })

  it('returns the largest matching index when starts contain duplicates', () => {
    expect(getActiveLyricIndex([1_000, 1_000, 1_000, 2_000], 1_000, 0)).toBe(2)
  })

  it('handles a single-element starts array on both sides of the boundary', () => {
    expect(getActiveLyricIndex([1_000], 500, 0)).toBe(-1)
    expect(getActiveLyricIndex([1_000], 1_000, 0)).toBe(0)
    expect(getActiveLyricIndex([1_000], 5_000, 0)).toBe(0)
  })
})

describe('useLyricStarts', () => {
  function makeLyrics(starts: string[]): LyricsResult {
    return {
      syncType: 'LINE_SYNCED',
      lines: starts.map((s) => ({ startTimeMs: s, words: '' })),
    }
  }

  it('returns an empty array when lyrics is null', () => {
    const { result } = renderHook(() => useLyricStarts(null))
    expect(result.current).toEqual([])
  })

  it('parses startTimeMs strings to numbers', () => {
    const { result } = renderHook(() => useLyricStarts(makeLyrics(['0', '1500', '3000'])))
    expect(result.current).toEqual([0, 1500, 3000])
  })

  it('coerces unparseable startTimeMs to 0', () => {
    const { result } = renderHook(() => useLyricStarts(makeLyrics(['1000', 'garbage', '3000'])))
    expect(result.current).toEqual([1000, 0, 3000])
  })

  it('returns a stable reference across re-renders with the same lyrics object', () => {
    const lyrics = makeLyrics(['0', '1000', '2000'])
    const { result, rerender } = renderHook(({ l }) => useLyricStarts(l), {
      initialProps: { l: lyrics },
    })
    const first = result.current
    rerender({ l: lyrics })
    expect(result.current).toBe(first)
  })

  it('returns a fresh reference when the lyrics object changes', () => {
    const a = makeLyrics(['0', '1000'])
    const b = makeLyrics(['0', '1000'])
    const { result, rerender } = renderHook(({ l }) => useLyricStarts(l), {
      initialProps: { l: a },
    })
    const first = result.current
    rerender({ l: b })
    expect(result.current).not.toBe(first)
    expect(result.current).toEqual(first)
  })
})
