import { useEffect, useState } from 'react'
import { getActiveLyricIndex } from './useLyrics'
import type { ObserverStatusActive } from '@/api/types'

// due to the new animation we run behind the lyric by a little
const LYRIC_LEAD_MS = 150

export function useActiveLine(
  status: ObserverStatusActive,
  starts: number[],
  enabled = true,
  offsetMs = 0,
): number {
  const [idx, setIdx] = useState(-1)

  useEffect(() => {
    if (starts.length === 0) {
      setIdx(-1)
      return
    }
    if (!enabled) return

    let timer = 0
    const playing = status.is_playing && !status.is_paused
    const effOffset = offsetMs + LYRIC_LEAD_MS

    const compute = () => {
      const elapsed = playing ? Math.max(0, Date.now() - status.received_at) : 0
      const pos = Math.min(status.duration, status.position + elapsed)
      const effPos = pos + effOffset
      const next = getActiveLyricIndex(starts, pos, effOffset)
      setIdx((prev) => (prev === next ? prev : next))

      if (!playing) return

      // floor 50ms guards against malformed timestamps
      const upcoming = next + 1
      if (upcoming >= starts.length) return
      const delay = starts[upcoming] - effPos
      timer = window.setTimeout(compute, Math.min(60_000, Math.max(50, delay)))
    }

    compute()
    return () => window.clearTimeout(timer)
  }, [
    enabled,
    offsetMs,
    status.received_at,
    status.position,
    status.duration,
    status.is_playing,
    status.is_paused,
    starts,
  ])

  return idx
}
