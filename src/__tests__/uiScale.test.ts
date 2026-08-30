import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  applyUiScale,
  artSizeFor,
  effectiveLyricsScale,
  getUiScale,
  getUiScaleFor,
  getUiScaleY,
  heroArtSizeFor,
  logicalSize,
  registerUiScaleTarget,
  startUiScaleSync,
  usePlayerViewport,
  useUiScale,
} from '../uiScale'
import { __resetSettings, updateSettings } from '../settings'

let targetEl: HTMLDivElement | null = null

function mountTarget(): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  registerUiScaleTarget(el)
  targetEl = el
  return el
}

beforeEach(() => {
  applyUiScale(100)
})

afterEach(() => {
  registerUiScaleTarget(null)
  targetEl?.remove()
  targetEl = null
})

describe('logicalSize', () => {
  it('is the native panel at 100%', () => {
    expect(logicalSize(100)).toEqual({ w: 800, h: 480 })
  })

  it('shrinks the logical viewport as the ui gets bigger', () => {
    expect(logicalSize(115)).toEqual({ w: 696, h: 418 })
  })

  it('grows the logical viewport as the ui gets smaller', () => {
    expect(logicalSize(85)).toEqual({ w: 941, h: 565 })
  })

  it('always rounds to whole pixels so layout boxes stay off subpixels', () => {
    for (const pct of [85, 90, 95, 100, 105, 110, 115]) {
      const { w, h } = logicalSize(pct)
      expect(Number.isInteger(w)).toBe(true)
      expect(Number.isInteger(h)).toBe(true)
    }
  })
})

describe('artSizeFor', () => {
  it('leaves the album art untouched at the default scale', () => {
    expect(artSizeFor(100)).toBe(200)
  })

  it('never grows the art when there is spare height', () => {
    expect(artSizeFor(85)).toBe(200)
  })

  it('shrinks the art so the left column still fits the stage row', () => {
    expect(artSizeFor(110)).toBe(166)
    expect(artSizeFor(115)).toBe(147)
  })

  // pinned against the real scss rather than re-deriving from the same constant, which
  // would tautologically pass whatever the reserved height was set to
  it('pins the shrink curve across the range', () => {
    expect([85, 90, 95, 100, 105, 110, 115].map(artSizeFor)).toEqual([
      200, 200, 200, 200, 187, 166, 147,
    ])
  })
})

describe('heroArtSizeFor', () => {
  it('gives up 2px at the default scale for the taller bar', () => {
    expect(heroArtSizeFor(100)).toBe(218)
  })

  it('keeps the 130% glow inside the stage row at every notch', () => {
    for (const pct of [85, 90, 95, 100, 105, 110, 115]) {
      const stage = logicalSize(pct).h - 196
      expect(heroArtSizeFor(pct) * 1.3).toBeLessThanOrEqual(stage)
    }
  })

  it('shrinks once the stage row can no longer hold the glow', () => {
    expect(heroArtSizeFor(115)).toBe(170)
  })
})

describe('effectiveLyricsScale', () => {
  // bug44_v2: lyrics text scales 1:1 with the display size up to 100%, then is hard-capped
  // at a factor of 1.0 (the display-size slider spans 85%-115%)
  it.each([
    [0.85, 0.85],
    [0.9, 0.9],
    [0.95, 0.95],
    [1.0, 1.0],
    [1.05, 1.0],
    [1.1, 1.0],
    [1.15, 1.0],
  ])('maps a %p display-size scale to the %p lyrics scale', (input, expected) => {
    expect(effectiveLyricsScale(input)).toBe(expected)
  })

  it('stays capped at 1.0 for scales far beyond the slider range', () => {
    expect(effectiveLyricsScale(1.3)).toBe(1.0)
    expect(effectiveLyricsScale(2)).toBe(1.0)
  })
})

describe('applyUiScale', () => {
  // bug38: the zoom moved off #root onto the player view wrapper — #root stays a
  // constant 800x480 no matter what display size is stored
  it('no longer counter-sizes or zooms #root', () => {
    const el = document.createElement('div')
    el.id = 'root'
    document.body.appendChild(el)
    try {
      applyUiScale(115)
      expect(el.style.width).toBe('')
      expect(el.style.height).toBe('')
      expect(el.style.getPropertyValue('zoom')).toBe('')
    } finally {
      el.remove()
    }
  })

  // updateSettings is a raw spread, so coerce() is not on this path; a NaN reaching the
  // store would otherwise strand getUiScale at NaN forever
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -50, 100000])(
    'falls back to a usable scale for %p',
    (bad) => {
      mountTarget()
      applyUiScale(bad)
      expect(Number.isFinite(getUiScale())).toBe(true)
      expect(getUiScale()).toBeGreaterThan(0)
    },
  )

  it('reports the achieved scale, not the requested ratio', () => {
    mountTarget()
    applyUiScale(100)
    expect(getUiScale()).toBe(1)
    applyUiScale(115)
    // 800/696, not 1.15: the logical width was rounded
    expect(getUiScale()).toBeCloseTo(800 / 696, 10)
  })
})

// bug38: the scale reads context-dependent — the achieved zoom while the player view
// is mounted, 1 while it is not (the fixed-100% menus)
describe('scale context (player visible vs menu visible)', () => {
  it('reports 1 while the player view is unmounted', () => {
    applyUiScale(115)
    expect(getUiScale()).toBe(1)
    expect(getUiScaleY()).toBe(1)
  })

  it('reports the achieved zoom while the player view is mounted', () => {
    applyUiScale(115)
    mountTarget()
    expect(getUiScale()).toBeCloseTo(800 / 696, 10)
    expect(getUiScaleY()).toBeCloseTo(800 / 696, 10)
  })

  it('drops back to 1 when the player view unmounts', () => {
    mountTarget()
    applyUiScale(115)
    expect(getUiScale()).toBeCloseTo(800 / 696, 10)
    registerUiScaleTarget(null)
    expect(getUiScale()).toBe(1)
  })

  it('re-registering the same element is a no-op', () => {
    const el = mountTarget()
    applyUiScale(110)
    expect(() => registerUiScaleTarget(el)).not.toThrow()
    expect(getUiScale()).toBeCloseTo(800 / logicalSize(110).w, 10)
  })

  it('getUiScaleFor resolves the zoom per element', () => {
    const el = mountTarget()
    applyUiScale(110)
    const inside = document.createElement('div')
    el.appendChild(inside)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    try {
      expect(getUiScaleFor(inside)).toBeCloseTo(800 / logicalSize(110).w, 10)
      // a sibling of the target (menu content, overlay sheets) never sees the zoom
      expect(getUiScaleFor(outside)).toBe(1)
      expect(getUiScaleFor(null)).toBe(1)
    } finally {
      outside.remove()
    }
  })

  it('getUiScaleFor reports 1 for every element while the player view is unmounted', () => {
    applyUiScale(115)
    const el = document.createElement('div')
    document.body.appendChild(el)
    try {
      expect(getUiScaleFor(el)).toBe(1)
    } finally {
      el.remove()
    }
  })
})

describe('useUiScale', () => {
  it('follows both the stored scale and the player mount state', () => {
    const { result, unmount } = renderHook(() => useUiScale())
    expect(result.current).toBe(1)
    act(() => applyUiScale(115))
    // stored, but the player view is not mounted: the menus read 1
    expect(result.current).toBe(1)
    act(() => registerUiScaleTarget(document.createElement('div')))
    expect(result.current).toBeCloseTo(800 / 696, 10)
    act(() => registerUiScaleTarget(null))
    expect(result.current).toBe(1)
    unmount()
  })
})

describe('usePlayerViewport', () => {
  it('is the logical viewport + zoom the player wrapper renders', () => {
    const { result } = renderHook(() => usePlayerViewport())
    expect(result.current).toEqual({ w: 800, h: 480, zoom: 1 })
    act(() => applyUiScale(115))
    expect(result.current).toEqual({ w: 696, h: 418, zoom: 800 / 696 })
    act(() => applyUiScale(85))
    expect(result.current).toEqual({ w: 941, h: 565, zoom: 800 / 941 })
  })

  it('is referentially stable while the value is unchanged (no re-render on target churn)', () => {
    const { result } = renderHook(() => usePlayerViewport())
    const first = result.current
    act(() => registerUiScaleTarget(document.createElement('div')))
    expect(result.current).toBe(first)
    act(() => registerUiScaleTarget(null))
    expect(result.current).toBe(first)
  })
})

describe('startUiScaleSync', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    __resetSettings()
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
  })

  it('seeds the scale from the stored setting without touching any element', () => {
    updateSettings({ uiScalePct: 110 })
    const el = document.createElement('div')
    el.id = 'root'
    document.body.appendChild(el)
    try {
      stop = startUiScaleSync()
      expect(el.style.width).toBe('')
      expect(el.style.getPropertyValue('zoom')).toBe('')
      // the player view will render it on mount
      expect(getUiScale()).toBe(1)
      mountTarget()
      expect(getUiScale()).toBeCloseTo(800 / logicalSize(110).w, 10)
    } finally {
      el.remove()
    }
  })

  it('reapplies when the scale changes', () => {
    stop = startUiScaleSync()
    mountTarget()
    updateSettings({ uiScalePct: 85 })
    expect(getUiScale()).toBeCloseTo(800 / logicalSize(85).w, 10)
  })

  it('leaves the viewport alone when an unrelated setting changes', () => {
    const { result } = renderHook(() => usePlayerViewport())
    stop = startUiScaleSync()
    const first = result.current
    updateSettings({ brightness: 9 })
    updateSettings({ lyricOffsetMs: 250 })
    updateSettings({ karaokeLyrics: false })
    expect(result.current).toBe(first)
  })
})
