import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  DEFAULT_COLOR,
  clearColorCache,
  darkBg,
  rgba,
  useColorExtract,
} from '../useColorExtract'

// jsdom has no canvas 2D backend: stub the context with a deterministic pixel source
const SAMPLE = 32
function makeData(r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SAMPLE * SAMPLE * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return data
}

let currentData = makeData(230, 60, 30)
let taintCanvas = false
const fakeCtx = {
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => {
    if (taintCanvas) throw new Error('tainted canvas')
    return { data: currentData }
  }),
}

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  crossOrigin = ''
  decoding = ''
  referrerPolicy = ''
  private _src = ''
  set src(v: string) {
    this._src = v
    if (!v) return
    queueMicrotask(() => (v.includes('fail') ? this.onerror?.() : this.onload?.()))
  }
  get src() {
    return this._src
  }
}

beforeAll(() => {
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeCtx as unknown as CanvasRenderingContext2D,
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

beforeEach(() => {
  clearColorCache()
  fakeCtx.getImageData.mockClear()
  currentData = makeData(230, 60, 30)
  taintCanvas = false
})

describe('useColorExtract', () => {
  it('returns the default color without a url', () => {
    const { result } = renderHook(() => useColorExtract(undefined))
    expect(result.current).toEqual(DEFAULT_COLOR)
  })

  it('extracts the dominant vibrant color from the artwork', async () => {
    const { result } = renderHook(() => useColorExtract('http://img/a.jpg'))
    await waitFor(() => expect(result.current).toEqual([230, 60, 30]))
  })

  it('falls back to the most populated bucket for desaturated art', async () => {
    currentData = makeData(128, 128, 128)
    const { result } = renderHook(() => useColorExtract('http://img/grey.jpg'))
    await waitFor(() => expect(result.current).toEqual([128, 128, 128]))
  })

  it('keeps the default color when the image fails to load', async () => {
    const { result } = renderHook(() => useColorExtract('http://img/fail.jpg'))
    await waitFor(() => expect(result.current).toEqual(DEFAULT_COLOR))
  })

  it('keeps the default color when the canvas is tainted', async () => {
    taintCanvas = true
    const { result } = renderHook(() => useColorExtract('http://img/t.jpg'))
    await waitFor(() => expect(result.current).toEqual(DEFAULT_COLOR))
  })

  it('caches the extracted color per url', async () => {
    const first = renderHook(() => useColorExtract('http://img/c.jpg'))
    await waitFor(() => expect(first.result.current).toEqual([230, 60, 30]))
    expect(fakeCtx.getImageData).toHaveBeenCalledTimes(1)

    const second = renderHook(() => useColorExtract('http://img/c.jpg'))
    expect(second.result.current).toEqual([230, 60, 30])
    expect(fakeCtx.getImageData).toHaveBeenCalledTimes(1)
  })
})

describe('color helpers', () => {
  it('formats rgba strings', () => {
    expect(rgba([255, 128, 64], 0.5)).toBe('rgba(255, 128, 64, 0.5)')
  })

  it('derives a dark backdrop that keeps the hue', () => {
    const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(darkBg([220, 40, 40]))
    expect(match).not.toBeNull()
    if (!match) return
    const r = Number(match[1])
    const g = Number(match[2])
    const b = Number(match[3])
    expect(r).toBeGreaterThan(g)
    expect(Math.max(r, g, b)).toBeLessThan(80)
  })
})
