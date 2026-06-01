import { useEffect, useState } from 'react'
import { getActiveLyricIndex } from './useLyrics'
import type { ObserverStatusActive } from '@/api/types'

// active lyric index, refreshing only on line crossings
export function useActiveLine(status: ObserverStatusActive, starts: number[]): number {
  const [idx, setIdx] = useState(-1)

  useEffect(() => {
    if (starts.length === 0) {
      setIdx(-1)
      return
    }

    let timer = 0
    const playing = status.is_playing && !status.is_paused

    const compute = () => {
      const elapsed = playing ? Math.max(0, Date.now() - status.received_at) : 0
      const pos = Math.min(status.duration, status.position + elapsed)
      const next = getActiveLyricIndex(starts, pos, 0)
      setIdx((prev) => (prev === next ? prev : next))

      if (!playing) return

      // floor 50ms guards against malformed timestamps
      const upcoming = next + 1
      if (upcoming >= starts.length) return
      const delay = starts[upcoming] - pos
      timer = window.setTimeout(compute, Math.min(60_000, Math.max(50, delay)))
    }

    compute()
    return () => window.clearTimeout(timer)
  }, [
    status.received_at,
    status.position,
    status.duration,
    status.is_playing,
    status.is_paused,
    starts,
  ])

  return idx
}
