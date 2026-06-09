import { useEffect, useRef, useState } from 'react'

export type RGB = [number, number, number]

// gray fallback for missing art or a bad image
const DEFAULT: RGB = [70, 75, 95]
const SAMPLE = 20
const HUE_BINS = 18
const MIN_CHROMA = 22
const MIN_VALUE = 0.1 // skip near-black pixels
const MIN_DOMINANT = 1

const cache = new Map<string, RGB>()

let sharedCanvas: HTMLCanvasElement | null = null
let sharedCtx: CanvasRenderingContext2D | null = null

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (sharedCtx) return sharedCtx
  sharedCanvas = document.createElement('canvas')
  sharedCanvas.width = SAMPLE
  sharedCanvas.height = SAMPLE
  sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true })
  return sharedCtx
}

function extract(img: HTMLImageElement): RGB | null {
  const ctx = ensureCanvas()
  if (!ctx) return null
  try {
    ctx.clearRect(0, 0, SAMPLE, SAMPLE)
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

    const binW = new Float64Array(HUE_BINS)
    const binR = new Float64Array(HUE_BINS)
    const binG = new Float64Array(HUE_BINS)
    const binB = new Float64Array(HUE_BINS)

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const chroma = max - min
      if (chroma < MIN_CHROMA) continue // near-gray no usable hue
      const value = max / 255
      if (value < MIN_VALUE) continue // too dark to read as colour

      let h: number
      if (max === r) h = (g - b) / chroma + (g < b ? 6 : 0)
      else if (max === g) h = (b - r) / chroma + 2
      else h = (r - g) / chroma + 4
      h /= 6 // 0..1

      const chromaNorm = chroma / 255
      const w = chromaNorm * chromaNorm * value // colourful AND bright wins

      let bin = (h * HUE_BINS) | 0
      if (bin >= HUE_BINS) bin = HUE_BINS - 1
      binW[bin] += w
      binR[bin] += r * w
      binG[bin] += g * w
      binB[bin] += b * w
    }

    let best = -1
    let bestW = 0
    for (let i = 0; i < HUE_BINS; i++) {
      if (binW[i] > bestW) {
        bestW = binW[i]
        best = i
      }
    }
    if (best < 0 || bestW < MIN_DOMINANT) return null
    return [
      Math.round(binR[best] / bestW),
      Math.round(binG[best] / bestW),
      Math.round(binB[best] / bestW),
    ]
  } catch {
    return null
  }
}

export function useColorExtract(url: string | undefined): RGB {
  const [color, setColor] = useState<RGB>(() => (url ? (cache.get(url) ?? DEFAULT) : DEFAULT))
  const lastUrlRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!url) {
      setColor(DEFAULT)
      lastUrlRef.current = undefined
      return
    }
    if (lastUrlRef.current === url) return
    lastUrlRef.current = url

    const cached = cache.get(url)
    if (cached) {
      setColor(cached)
      return
    }

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'

    const apply = (rgb: RGB) =>
      setColor((prev) =>
        prev[0] === rgb[0] && prev[1] === rgb[1] && prev[2] === rgb[2] ? prev : rgb,
      )

    img.onload = () => {
      if (cancelled) return
      const rgb = extract(img) ?? DEFAULT
      cache.set(url, rgb)
      apply(rgb)
    }
    img.onerror = () => {
      if (cancelled) return
      apply(DEFAULT)
    }
    img.src = url

    return () => {
      cancelled = true
      img.onload = null
      img.onerror = null
      img.src = ''
    }
  }, [url])

  return color
}

export function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

const DARK_L = 0.16
const DARK_S_CAP = 0.62

// saturated darkmode backdrop from the album accent colour
export function darkBg(rgb: RGB): string {
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2])
  const [r, g, b] = hslToRgb(h, Math.min(s, DARK_S_CAP), DARK_L)
  return `rgb(${r}, ${g}, ${b})`
}
