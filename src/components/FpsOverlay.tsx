import { useEffect, useRef } from 'react'
// PERF-A/B (temp): dial-scroll experiment flags (Bug58) — S/C/A/N toggle chips
import { usePerfFlags, togglePerfFlag, type PerfFlagName } from '@/perfFlags'

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

// PERF-A/B (temp): the four experiment flags in display order. The chip text
// is the first letter; active flags render bright, inactive ones dimmed.
// PERF-A/B (temp)
const TOGGLES: { label: string; flag: PerfFlagName }[] = [
  { label: 'S', flag: 'staticBg' },
  { label: 'C', flag: 'compScroll' },
  { label: 'A', flag: 'lowresArt' },
  // N: anim-carousel (Navigation/Animation) — browser-side smooth dial scroll
  { label: 'N', flag: 'animCarousel' },
]

export function FpsOverlay() {
  const valueRef = useRef<HTMLSpanElement | null>(null)
  // PERF-A/B (temp): re-render only when a flag chip is clicked — the FPS
  // readout below stays a ref/textContent path and behaves exactly as before
  const perfFlags = usePerfFlags()

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
      {/* PERF-A/B (temp): runtime toggles for the four experiment flags —
          click to flip, persisted via localStorage (mira.perf.debug) */}
      <div style={{ marginTop: 2, whiteSpace: 'nowrap' }}>
        {TOGGLES.map(({ label, flag }) => (
          <span
            key={flag}
            role="button"
            aria-label={`toggle ${flag}`}
            onClick={() => togglePerfFlag(flag)}
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              display: 'inline-block',
              margin: '0 1px',
              padding: '0 3px',
              color: perfFlags[flag] ? '#fff' : 'rgba(255, 255, 255, 0.35)',
              borderBottom: perfFlags[flag] ? '1px solid #fff' : '1px solid transparent',
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default FpsOverlay
