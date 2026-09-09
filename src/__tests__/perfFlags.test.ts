// PERF-A/B (temp) — unit tests for the Bug58 dial-scroll experiment flags
// (debug/fps-bug58 only): URL seeding, localStorage persistence, and the
// useSyncExternalStore getSnapshot contract. Strip together with the other
// PERF-A/B markers when the branch is deleted.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LS_KEY = 'mira.perf.debug'

// The module seeds its state ONCE at import time (same shape as settings.ts),
// so a fresh store for a given URL is loaded via resetModules + dynamic import.
async function loadStore(search: string) {
  vi.resetModules()
  history.replaceState(null, '', search)
  return import('../perfFlags')
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
})

describe('URL seeding (?perf=...)', () => {
  it('turns on every listed flag and leaves the rest off', async () => {
    const store = await loadStore('/?perf=lowres-art,static-bg,comp-scroll,anim-carousel')
    expect(store.getPerfFlags()).toEqual({
      lowresArt: true,
      staticBg: true,
      compScroll: true,
      animCarousel: true,
    })
  })

  it('starts all off without a ?perf param', async () => {
    const store = await loadStore('/')
    expect(store.getPerfFlags()).toEqual({
      lowresArt: false,
      staticBg: false,
      compScroll: false,
      animCarousel: false,
    })
  })

  it('ignores unknown wire names and tolerates whitespace', async () => {
    const store = await loadStore('/?perf=bogus-flag, lowres-art ,anim-carousel')
    expect(store.getPerfFlags().lowresArt).toBe(true)
    expect(store.getPerfFlags().animCarousel).toBe(true)
    expect(store.getPerfFlags().staticBg).toBe(false)
    expect(store.getPerfFlags().compScroll).toBe(false)
  })

  it('lets URL flags win, keeping unlisted flags at their stored value', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ lowresArt: true, compScroll: true }))
    const store = await loadStore('/?perf=static-bg')
    expect(store.getPerfFlags()).toEqual({
      lowresArt: true, // from localStorage
      staticBg: true, // from the URL
      compScroll: true, // from localStorage
      animCarousel: false, // neither source lists it
    })
  })
})

describe('localStorage persistence (mira.perf.debug)', () => {
  it('roundtrips a toggle through the store key', async () => {
    const store = await loadStore('/')
    act(() => store.togglePerfFlag('lowresArt'))
    expect(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')).toEqual({
      lowresArt: true,
      staticBg: false,
      compScroll: false,
      animCarousel: false,
    })
    // a fresh store instance (simulated page reload) reads the state back
    const reloaded = await loadStore('/')
    expect(reloaded.getPerfFlags().lowresArt).toBe(true)
  })

  it('togglePerfFlag flips each flag both ways', async () => {
    const store = await loadStore('/?perf=anim-carousel')
    expect(store.getPerfFlags().animCarousel).toBe(true)
    act(() => store.togglePerfFlag('animCarousel'))
    expect(store.getPerfFlags().animCarousel).toBe(false)
    act(() => store.togglePerfFlag('animCarousel'))
    expect(store.getPerfFlags().animCarousel).toBe(true)
  })

  it('setPerfFlag with an unchanged value is a no-op (no new snapshot)', async () => {
    const store = await loadStore('/')
    const before = store.getPerfFlags()
    act(() => store.setPerfFlag('staticBg', false))
    expect(store.getPerfFlags()).toBe(before)
  })
})

describe('usePerfFlags (useSyncExternalStore getSnapshot contract)', () => {
  it('keeps the snapshot referentially stable while unchanged', async () => {
    const store = await loadStore('/')
    expect(store.getPerfFlags()).toBe(store.getPerfFlags())
  })

  it('re-renders exactly once per flip and never loops on no-op sets', async () => {
    const store = await loadStore('/')
    const initial = store.getPerfFlags()
    let renders = 0
    const { result, unmount } = renderHook(() => {
      renders += 1
      return store.usePerfFlags()
    })
    expect(renders).toBe(1)
    expect(result.current).toBe(initial)

    act(() => store.togglePerfFlag('compScroll'))
    expect(result.current.compScroll).toBe(true)
    expect(result.current).not.toBe(initial)
    expect(renders).toBe(2)

    // a no-op set must not grow the render count: getSnapshot keeps returning
    // the SAME reference, so useSyncExternalStore never schedules another
    // render (an unstable snapshot here would loop forever)
    act(() => store.setPerfFlag('compScroll', true))
    expect(renders).toBe(2)

    unmount()
  })
})
