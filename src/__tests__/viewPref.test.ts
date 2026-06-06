import { beforeEach, describe, expect, it } from 'vitest'
import { loadShowLyrics, saveShowLyrics } from '../viewPref'

describe('viewPref persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to lyrics-on when nothing is stored', () => {
    expect(loadShowLyrics()).toBe(true)
  })

  it('round-trips a saved preference', () => {
    saveShowLyrics(false)
    expect(loadShowLyrics()).toBe(false)

    saveShowLyrics(true)
    expect(loadShowLyrics()).toBe(true)
  })

  it('persists under a stable key', () => {
    saveShowLyrics(false)
    expect(localStorage.getItem('thing.view.v1')).toBe('false')
  })

  it('treats any non-"true" stored value as false', () => {
    localStorage.setItem('thing.view.v1', 'garbage')
    expect(loadShowLyrics()).toBe(false)
  })
})
