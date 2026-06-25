import { useEffect, useRef, useState } from 'react'

export type RGB = [number, number, number]

// gray fallback for missing art or a bad image
const DEFAULT: RGB = [70, 75, 95]
const SAMPLE = 32

const TARGET_S = 1
const TARGET_L = 0.5
const MIN_S = 0.35 
const MIN_L = 0.3
const MAX_L = 0.7
const W_S = 3 
const W_L = 1
const W_POP = 1

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

interface Bucket {
  n: number
  r: number
  g: number
  b: number
}

function extract(img: HTMLImageElement): RGB | null {
  const ctx = ensureCanvas()
  if (!ctx) return null
  try {
    ctx.clearRect(0, 0, SAMPLE, SAMPLE)
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

    const buckets = new Map<number, Bucket>()
    let maxPop = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      let bkt = buckets.get(key)
      if (!bkt) {
        bkt = { n: 0, r: 0, g: 0, b: 0 }
        buckets.set(key, bkt)
      }
      bkt.n++
      bkt.r += r
      bkt.g += g
      bkt.b += b
      if (bkt.n > maxPop) maxPop = bkt.n
    }
    if (maxPop === 0) return null

    // try to get the most vibrant color from art
    let bestScore = -1
    let best: RGB | null = null
    let fbScore = -1
    let fallback: RGB | null = null
    const norm = W_S + W_L + W_POP
    for (const bkt of buckets.values()) {
      const r = bkt.r / bkt.n
      const g = bkt.g / bkt.n
      const b = bkt.b / bkt.n
      const [, s, l] = rgbToHsl(r, g, b)
      const pop = bkt.n / maxPop
      const swatch: RGB = [Math.round(r), Math.round(g), Math.round(b)]

      if (s >= MIN_S && l >= MIN_L && l <= MAX_L) {
        const score =
          ((1 - Math.abs(s - TARGET_S)) * W_S + (1 - Math.abs(l - TARGET_L)) * W_L + pop * W_POP) /
          norm
        if (score > bestScore) {
          bestScore = score
          best = swatch
        }
      }

      const fb = s * 0.7 + pop * 0.3
      if (fb > fbScore) {
        fbScore = fb
        fallback = swatch
      }
    }

    return best ?? fallback
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
