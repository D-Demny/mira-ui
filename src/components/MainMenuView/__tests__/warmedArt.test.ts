import { beforeEach, describe, expect, it } from 'vitest'
import {
  WARMED_ART_MAX,
  __resetWarmedArt,
  hasWarmedArt,
  warmArt,
  warmedArtStats,
} from '../warmedArt'

describe('warmedArt (bug8.2 pre-decode set, bug45 option C FIFO cap)', () => {
  beforeEach(() => {
    __resetWarmedArt()
  })

  it('caps at WARMED_ART_MAX = 1000', () => {
    expect(WARMED_ART_MAX).toBe(1000)
  })

  it('marks urls as warmed exactly once (no re-warm for known urls)', () => {
    expect(warmArt('http://a/1.jpg')).toBe(true)
    expect(warmArt('http://a/1.jpg')).toBe(false)
    expect(hasWarmedArt('http://a/1.jpg')).toBe(true)
    expect(hasWarmedArt('http://a/2.jpg')).toBe(false)
  })

  it('evicts the oldest warmed url once the cap is exceeded (FIFO, insertion order)', () => {
    for (let i = 0; i < WARMED_ART_MAX; i++) {
      warmArt(`http://a/${i}.jpg`)
    }
    expect(warmedArtStats().entries).toBe(WARMED_ART_MAX)

    // the (max+1)th warm evicts the first warmed url and keeps the newest
    expect(warmArt('http://a/new.jpg')).toBe(true)
    expect(warmedArtStats().entries).toBe(WARMED_ART_MAX)
    expect(hasWarmedArt('http://a/0.jpg')).toBe(false)
    expect(hasWarmedArt(`http://a/${WARMED_ART_MAX - 1}.jpg`)).toBe(true)
    expect(hasWarmedArt('http://a/new.jpg')).toBe(true)

    // a re-warm of an evicted url evicts the next oldest (it is new again)
    expect(warmArt('http://a/0.jpg')).toBe(true)
    expect(hasWarmedArt('http://a/1.jpg')).toBe(false)
    expect(hasWarmedArt('http://a/0.jpg')).toBe(true)
  })

  it('re-warming an evicted url does not grow the set', () => {
    warmArt('http://a/1.jpg')
    warmArt('http://a/2.jpg')
    expect(warmedArtStats().entries).toBe(2)
    expect(warmArt('http://a/2.jpg')).toBe(false)
    expect(warmedArtStats().entries).toBe(2)
  })

  it('reports the count and approximate size (url strings only)', () => {
    const url1 = 'http://a/1.jpg'
    const url2 = 'http://a/22.jpg'
    warmArt(url1)
    warmArt(url2)
    const stats = warmedArtStats()
    expect(stats.entries).toBe(2)
    expect(stats.approxBytes).toBe(url1.length + url2.length)
  })
})
