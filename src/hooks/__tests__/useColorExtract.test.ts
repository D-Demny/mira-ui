import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import {
  __resetMiraServerState,
  checkMiraServer,
} from '@/hooks/useMiraServer'
import { type MiraServerCapabilities } from '@/api/miraServer'
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
    __resetMiraServerState()
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

describe('epic10 task 2: remoteColors adapter', () => {
  const CDN = 'http://i.scdn.co/image/ab67616d0000remote'

  const COMPUTE: MiraServerCapabilities = {
    tier: 'compute',
    disk_cache: true,
    remote_colors: true,
    remote_blur: true,
  }

  // pre-seed the shared store (without a subscriber) so the first render
  // already sees remoteColors — the check completes before anything renders
  async function enableRemoteColors() {
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    await act(async () => {
      await checkMiraServer()
    })
  }

  it('uses the Pi-extracted color instead of the local canvas extraction', async () => {
    await enableRemoteColors()
    server.use(http.get('*/img/*/colors', () => HttpResponse.json({ dominant: [10, 20, 30] })))
    const { result } = renderHook(() => useColorExtract(CDN))
    await waitFor(() => expect(result.current).toEqual([10, 20, 30]))
    expect(fakeCtx.getImageData).not.toHaveBeenCalled()
  })

  it('falls back to the local extraction when the Pi colors endpoint fails', async () => {
    await enableRemoteColors()
    server.use(http.get('*/img/*/colors', () => HttpResponse.error()))
    const { result } = renderHook(() => useColorExtract(CDN))
    await waitFor(() => expect(result.current).toEqual([230, 60, 30]))
    expect(fakeCtx.getImageData).toHaveBeenCalledTimes(1)
  })

  it('re-extracts when the feature flips on for an already-mounted url', async () => {
    // standalone first: the image fails to load → default color, nothing
    // cached (so the cached-color shortcut cannot mask the flip)
    const { result } = renderHook(() => useColorExtract('http://i.scdn.co/image/fail'))
    await waitFor(() => expect(result.current).toEqual(DEFAULT_COLOR))
    // let the mount-time check settle first (standalone via the default
    // handler), so the re-check below is a fresh request, not a join of the
    // in-flight one
    await act(async () => {
      await checkMiraServer()
    })
    // the Pi shows up while the card is still focused
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    server.use(http.get('*/img/*/colors', () => HttpResponse.json({ dominant: [10, 20, 30] })))
    await act(async () => {
      await checkMiraServer()
    })
    await waitFor(() => expect(result.current).toEqual([10, 20, 30]))
  })

  it('keeps the standalone behavior (local extraction) by default', async () => {
    // the default MSW capabilities handler answers an error → standalone
    const { result } = renderHook(() => useColorExtract('http://img/standalone.jpg'))
    await waitFor(() => expect(result.current).toEqual([230, 60, 30]))
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
