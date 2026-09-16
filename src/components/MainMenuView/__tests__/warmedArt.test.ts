import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_WARM_INFLIGHT,
  WARMED_ART_MAX,
  __resetWarmedArt,
  hasWarmedArt,
  warmArt,
  warmedArtStats,
} from '../warmedArt'

// issue50 F1: the state machine is completion-aware — a stubbed Image whose
// onload/onerror the tests fire manually (fake timers for the retry delay)
interface FakeImage {
  src: string
  crossOrigin: string | null
  referrerPolicy: string
  onload: (() => void) | null
  onerror: (() => void) | null
}

function stubImage() {
  const created: FakeImage[] = []
  vi.stubGlobal('Image', function () {
    const img: FakeImage = {
      src: '',
      crossOrigin: null,
      referrerPolicy: 'no-referrer',
      onload: null,
      onerror: null,
    }
    created.push(img)
    return img as unknown as HTMLImageElement
  })
  return {
    created,
    load: (index: number): void => {
      const handler = created[index].onload
      if (handler) handler()
    },
    fail: (index: number): void => {
      const handler = created[index].onerror
      if (handler) handler()
    },
    bySrc: (src: string): FakeImage[] => created.filter((img) => img.src === src),
  }
}

describe('warmedArt (bug8.2 pre-decode, bug45 C FIFO cap, issue50 F1 completion-aware)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetWarmedArt()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps WARMED_ART_MAX = 1000 and the new MAX_WARM_INFLIGHT cap = 3', () => {
    expect(WARMED_ART_MAX).toBe(1000)
    expect(MAX_WARM_INFLIGHT).toBe(3)
  })

  it('a successful fetch stays cached — settled on load, never re-fetched (case a)', () => {
    const image = stubImage()
    // pending does not count as warmed (completion-aware)
    expect(warmArt('http://a/1.jpg')).toBe(true)
    expect(hasWarmedArt('http://a/1.jpg')).toBe(false)
    image.load(0)
    expect(hasWarmedArt('http://a/1.jpg')).toBe(true)
    // success stays cached: no re-warm, no second Image
    expect(warmArt('http://a/1.jpg')).toBe(false)
    expect(image.created).toHaveLength(1)
  })

  it('the pre-decode Images match AlbumArt fetch attributes (same cache partition)', () => {
    const image = stubImage()
    warmArt('http://a/1.jpg')
    expect(image.created[0].crossOrigin).toBe('anonymous')
    expect(image.created[0].referrerPolicy).toBe('no-referrer')
  })

  it('retries a failed fetch once, settles failed — and the url is re-warmable (case a)', () => {
    const image = stubImage()
    warmArt('http://a/2.jpg')
    image.fail(0)
    // not warmed while pending/retrying/failed — the band diff may re-warm it
    expect(hasWarmedArt('http://a/2.jpg')).toBe(false)
    // one bounded retry after RETRY_DELAY_MS (1500) — nothing earlier
    vi.advanceTimersByTime(1499)
    expect(image.created).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(image.bySrc('http://a/2.jpg')).toHaveLength(2)
    // the retry fails too: settled failed, no further auto-retry
    image.fail(1)
    vi.advanceTimersByTime(10000)
    expect(image.created).toHaveLength(2)
    expect(hasWarmedArt('http://a/2.jpg')).toBe(false)
    // a failed url is re-warmable: a fresh request starts and can succeed
    expect(warmArt('http://a/2.jpg')).toBe(true)
    image.load(2)
    expect(hasWarmedArt('http://a/2.jpg')).toBe(true)
  })

  it('caps in-flight fetches at 3 and fires the FIFO queue as slots free (case b)', () => {
    const image = stubImage()
    for (let i = 0; i < 5; i++) expect(warmArt(`http://a/${i}.jpg`)).toBe(true)

    // only MAX_WARM_INFLIGHT in flight — the rest wait in the FIFO queue
    expect(image.created).toHaveLength(MAX_WARM_INFLIGHT)
    expect(image.created.map((img) => img.src)).toEqual([
      'http://a/0.jpg',
      'http://a/1.jpg',
      'http://a/2.jpg',
    ])

    // the cap holds while slots are busy: a 6th request is accepted but queued
    expect(warmArt('http://a/5.jpg')).toBe(true)
    expect(image.created).toHaveLength(MAX_WARM_INFLIGHT)

    // settling one slot fires the next queued url (FIFO order)
    image.load(0)
    expect(image.created[3].src).toBe('http://a/3.jpg')
    image.load(1)
    expect(image.created[4].src).toBe('http://a/4.jpg')
    image.load(2)
    expect(image.created[5].src).toBe('http://a/5.jpg')

    // settle the rest — everything ends up cached
    for (let i = 3; i < 6; i++) image.load(i)
    expect(warmedArtStats().entries).toBe(6)
  })

  it('a bounded retry re-enters at the FRONT of the FIFO queue and counts against the cap', () => {
    const image = stubImage()
    for (let i = 0; i < 5; i++) warmArt(`http://a/${i}.jpg`)
    // in flight: u0,u1,u2 — queue: u3,u4
    image.fail(0)
    // the freed slot goes to the plain queue immediately — the failed url
    // only re-arms after the retry delay
    expect(image.created[3].src).toBe('http://a/3.jpg')
    vi.advanceTimersByTime(1500)
    // no slot free yet: the retry is queued at the front, waiting
    expect(warmArt('http://a/6.jpg')).toBe(true)
    image.load(1) // frees a slot — the retry (front of queue) fires before u4
    expect(image.created[4].src).toBe('http://a/0.jpg')
  })

  it('de-dupes urls that are pending, retrying, or queued', () => {
    const image = stubImage()
    for (let i = 0; i < 5; i++) warmArt(`http://a/${i}.jpg`)
    expect(warmArt('http://a/2.jpg')).toBe(false) // in flight
    expect(warmArt('http://a/3.jpg')).toBe(false) // queued
    image.fail(0)
    expect(warmArt('http://a/0.jpg')).toBe(false) // retrying
  })

  it('evicts the oldest SETTLED url once WARMED_ART_MAX is exceeded (FIFO, bug45 C)', () => {
    const image = stubImage()
    for (let i = 0; i < WARMED_ART_MAX; i++) warmArt(`http://a/${i}.jpg`)
    // settle all: created[k] settles in creation order, freeing a slot each
    for (let k = 0; k < WARMED_ART_MAX; k++) image.load(k)
    expect(warmedArtStats().entries).toBe(WARMED_ART_MAX)

    // the (max+1)th settled url evicts the first settled one — it is new again
    warmArt('http://a/new.jpg')
    image.load(image.created.length - 1)
    expect(warmedArtStats().entries).toBe(WARMED_ART_MAX)
    expect(hasWarmedArt('http://a/0.jpg')).toBe(false)
    expect(hasWarmedArt(`http://a/${WARMED_ART_MAX - 1}.jpg`)).toBe(true)
    expect(hasWarmedArt('http://a/new.jpg')).toBe(true)

    // a re-warm of an evicted url evicts the next oldest (it is new again)
    warmArt('http://a/0.jpg')
    image.load(image.created.length - 1)
    expect(hasWarmedArt('http://a/1.jpg')).toBe(false)
    expect(hasWarmedArt('http://a/0.jpg')).toBe(true)
  })

  it('reports the settled (done) entries and approximate size only', () => {
    const url1 = 'http://a/1.jpg'
    const url2 = 'http://a/22.jpg'
    const image = stubImage()
    warmArt(url1)
    warmArt(url2)
    expect(warmedArtStats().entries).toBe(0) // pending does not count as warmed
    image.load(0)
    image.load(1)
    const stats = warmedArtStats()
    expect(stats.entries).toBe(2)
    expect(stats.approxBytes).toBe(url1.length + url2.length)
  })

  it('__resetWarmedArt drops in-flight listeners and queued urls (stale events no-op)', () => {
    const image = stubImage()
    for (let i = 0; i < 5; i++) warmArt(`http://a/${i}.jpg`)
    __resetWarmedArt()
    // a stale onload from the previous session must not move the fresh state
    image.load(0)
    expect(hasWarmedArt('http://a/0.jpg')).toBe(false)
    // everything is warmable again after a reset
    expect(warmArt('http://a/0.jpg')).toBe(true)
  })
})
