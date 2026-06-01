import { useEffect, useRef, useState } from 'react'

export type RGB = [number, number, number]

// TODO: make it a little more colorful

const DEFAULT: RGB = [70, 75, 95]
const CHANNEL_MAX = 180
const MIN_LUMA = 90
const SAMPLE = 8

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

function clampMax(n: number): number {
  if (n < 0) return 0
  if (n > CHANNEL_MAX) return CHANNEL_MAX
  return n
}

function liftLuminance(r: number, g: number, b: number): RGB {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  if (luma <= 0) return [MIN_LUMA, MIN_LUMA, MIN_LUMA]
  if (luma >= MIN_LUMA) return [r, g, b]
  const scale = MIN_LUMA / luma
  return [r * scale, g * scale, b * scale]
}

function extract(img: HTMLImageElement): RGB | null {
  const ctx = ensureCanvas()
  if (!ctx) return null
  try {
    ctx.clearRect(0, 0, SAMPLE, SAMPLE)
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count++
    }
    if (count === 0) return null
    const [lr, lg, lb] = liftLuminance(r / count, g / count, b / count)
    return [clampMax(Math.round(lr)), clampMax(Math.round(lg)), clampMax(Math.round(lb))]
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
