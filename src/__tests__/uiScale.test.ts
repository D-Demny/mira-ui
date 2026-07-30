import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUiScale,
  artSizeFor,
  getUiScale,
  heroArtSizeFor,
  logicalSize,
  startUiScaleSync,
} from '../uiScale'
import { __resetSettings, updateSettings } from '../settings'

let root: HTMLDivElement | null = null

function mountRoot(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  root = el
  return el
}

beforeEach(() => {
  applyUiScale(100)
})

afterEach(() => {
  root?.remove()
  root = null
})

describe('logicalSize', () => {
  it('is the native panel at 100%', () => {
    expect(logicalSize(100)).toEqual({ w: 800, h: 480 })
  })

  it('shrinks the logical viewport as the ui gets bigger', () => {
    expect(logicalSize(115)).toEqual({ w: 696, h: 417 })
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
    expect(artSizeFor(110)).toBe(173)
    expect(artSizeFor(115)).toBe(154)
  })

  // pinned against the real scss rather than re-deriving from the same constant, which
  // would tautologically pass whatever the reserved height was set to
  it('pins the shrink curve across the range', () => {
    expect([85, 90, 95, 100, 105, 110, 115].map(artSizeFor)).toEqual([
      200, 200, 200, 200, 194, 173, 154,
    ])
  })
})

describe('heroArtSizeFor', () => {
  it('leaves the no-lyrics art untouched at the default scale', () => {
    expect(heroArtSizeFor(100)).toBe(220)
  })

  it('keeps the 130% glow inside the stage row at every notch', () => {
    for (const pct of [85, 90, 95, 100, 105, 110, 115]) {
      const stage = logicalSize(pct).h - 188
      expect(heroArtSizeFor(pct) * 1.3).toBeLessThanOrEqual(stage)
    }
  })

  it('shrinks once the stage row can no longer hold the glow', () => {
    expect(heroArtSizeFor(115)).toBe(176)
  })
})

describe('applyUiScale', () => {
  it('counter-sizes #root and scales it back onto the panel', () => {
    const el = mountRoot()
    applyUiScale(115)
    expect(el.style.width).toBe('696px')
    expect(el.style.height).toBe('417px')
    expect(el.style.transform).toMatch(/^scale\(/)
    expect(el.style.transformOrigin).toBe('top left')
  })

  it('lands the painted result on exactly 800x480', () => {
    const el = mountRoot()
    for (const pct of [85, 90, 95, 105, 110, 115]) {
      applyUiScale(pct)
      const [sx, sy] = /scale\(([\d.]+), ([\d.]+)\)/.exec(el.style.transform)!.slice(1).map(Number)
      expect(parseFloat(el.style.width) * sx).toBeCloseTo(800, 6)
      expect(parseFloat(el.style.height) * sy).toBeCloseTo(480, 6)
    }
  })

  it('clears a previous transform when returning to 100%', () => {
    const el = mountRoot()
    applyUiScale(115)
    expect(el.style.transform).not.toBe('')
    // skipping the assignment here would strand scale(1.15) on an 800px-wide root
    applyUiScale(100)
    expect(el.style.transform).toBe('')
    expect(el.style.transformOrigin).toBe('')
    expect(el.style.width).toBe('800px')
    expect(el.style.height).toBe('480px')
  })

  it('no-ops when #root is absent', () => {
    expect(document.getElementById('root')).toBeNull()
    expect(() => applyUiScale(110)).not.toThrow()
  })

  // updateSettings is a raw spread, so coerce() is not on this path — a NaN reaching the
  // dom writes "NaNpx" and would otherwise strand getUiScale at NaN forever
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -50, 100000])(
    'falls back to a usable scale for %p',
    (bad) => {
      const el = mountRoot()
      applyUiScale(bad)
      expect(el.style.width).toMatch(/^\d+px$/)
      expect(Number.isFinite(getUiScale())).toBe(true)
      expect(getUiScale()).toBeGreaterThan(0)
    },
  )

  it('reports the achieved scale, not the requested ratio', () => {
    mountRoot()
    applyUiScale(100)
    expect(getUiScale()).toBe(1)
    applyUiScale(115)
    // 800/696, not 1.15 — the logical width was rounded
    expect(getUiScale()).toBeCloseTo(800 / 696, 10)
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

  it('applies the stored scale immediately', () => {
    updateSettings({ uiScalePct: 110 })
    const el = mountRoot()
    stop = startUiScaleSync()
    expect(el.style.width).toBe(`${logicalSize(110).w}px`)
  })

  it('reapplies when the scale changes', () => {
    const el = mountRoot()
    stop = startUiScaleSync()
    expect(el.style.width).toBe('800px')
    updateSettings({ uiScalePct: 85 })
    expect(el.style.width).toBe(`${logicalSize(85).w}px`)
  })

  it('leaves the dom alone when an unrelated setting changes', () => {
    const el = mountRoot()
    stop = startUiScaleSync()
    // a sentinel the sync would overwrite if it ran
    el.style.width = '123px'
    updateSettings({ brightness: 9 })
    updateSettings({ lyricOffsetMs: 250 })
    updateSettings({ karaokeLyrics: false })
    expect(el.style.width).toBe('123px')
  })
})
