import { useEffect, useRef } from 'react'

// Bug58 T5 (DEBUG ONLY — this branch is deleted after the S905D2 measurement,
// never merged into main): temporary rAF FPS overlay for measuring the per-card
// blur cost while dial-scrolling under the menu.
//
// The loop counts requestAnimationFrame frames and writes the rate of the last
// ~1000 ms window to a single ref'd <span> via textContent: no React state is
// touched per frame, so there is exactly one DOM write per second, no re-renders
// and no layout reads. CR69 (Chromium 69) compatible: position:fixed + inline
// styles only, no modern CSS.
const WINDOW_MS = 1000

export function FpsOverlay() {
  const valueRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let frames = 0
    let windowStart = performance.now()
    let rafId = 0

    const tick = () => {
      frames += 1
      const now = performance.now()
      if (now - windowStart >= WINDOW_MS) {
        // elapsed-time based so a drifted window on weak hardware still reports
        // the true rate instead of the raw frame count
        const fps = Math.round((frames * 1000) / (now - windowStart))
        if (valueRef.current != null) valueRef.current.textContent = String(fps)
        frames = 0
        windowStart = now
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [])

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 10000,
        padding: '2px 6px',
        margin: 0,
        fontSize: 12,
        lineHeight: '14px',
        fontFamily: 'monospace',
        color: '#fff',
        background: 'rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
      }}
    >
      FPS <span ref={valueRef}>0</span>
    </div>
  )
}

export default FpsOverlay
