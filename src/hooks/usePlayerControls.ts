import { useCallback, useEffect, useRef, useState } from 'react'
import type { ObserverStatusActive } from '@/api/types'
import type { RepeatMode } from '@/components/Menu'

const PREV_DOUBLE_TAP_MS = 1500
const TRANSITION_TIMEOUT_MS = 1200
const OPTIMISTIC_SAFETY_TIMEOUT_MS = 3000

interface OptimisticValue<T> {
  value: T
  at: number
}

export interface UsePlayerControlsParams {
  status: ObserverStatusActive | null
  togglePlayPause: () => Promise<void> | void
  next: () => Promise<void> | void
  prev: () => Promise<void> | void
  seek: (positionMs: number) => Promise<void> | void
  setShuffle: (on: boolean) => Promise<void> | void
  setRepeat: (mode: RepeatMode) => Promise<void> | void
}

export interface UsePlayerControlsResult {
  isPaused: boolean
  shuffle: boolean
  repeat: RepeatMode
  transitioning: boolean
  onPlayPause: () => void
  onPrev: () => void
  onNext: () => void
  onToggleShuffle: () => void
  onCycleRepeat: () => void
}

export function usePlayerControls(params: UsePlayerControlsParams): UsePlayerControlsResult {
  const { status, togglePlayPause, next, prev, seek, setShuffle, setRepeat } = params

  const [optimisticPause, setOptimisticPause] = useState<OptimisticValue<boolean> | null>(null)
  const [optimisticShuffle, setOptimisticShuffle] = useState<OptimisticValue<boolean> | null>(null)
  const [optimisticRepeat, setOptimisticRepeat] = useState<OptimisticValue<RepeatMode> | null>(null)
  const [trackTransitionAt, setTrackTransitionAt] = useState<number>(0)

  const lastPrevAtRef = useRef(0)

  useEffect(() => {
    if (!optimisticPause) return
    const t = window.setTimeout(() => setOptimisticPause(null), OPTIMISTIC_SAFETY_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [optimisticPause])

  useEffect(() => {
    if (!optimisticShuffle) return
    const t = window.setTimeout(() => setOptimisticShuffle(null), OPTIMISTIC_SAFETY_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [optimisticShuffle])

  useEffect(() => {
    if (!optimisticRepeat) return
    const t = window.setTimeout(() => setOptimisticRepeat(null), OPTIMISTIC_SAFETY_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [optimisticRepeat])

  useEffect(() => {
    if (trackTransitionAt === 0) return
    const t = window.setTimeout(() => setTrackTransitionAt(0), TRANSITION_TIMEOUT_MS + 50)
    return () => window.clearTimeout(t)
  }, [trackTransitionAt])

  const receivedAt = status?.received_at ?? 0

  const optimisticPauseActive = optimisticPause != null && receivedAt <= optimisticPause.at
  const isPaused =
    optimisticPauseActive && optimisticPause ? optimisticPause.value : (status?.is_paused ?? false)

  const optimisticShuffleActive = optimisticShuffle != null && receivedAt <= optimisticShuffle.at
  const shuffle =
    optimisticShuffleActive && optimisticShuffle
      ? optimisticShuffle.value
      : (status?.shuffle ?? false)

  const repeatFromStatus: RepeatMode = status?.repeat_track
    ? 'track'
    : status?.repeat_context
      ? 'context'
      : 'off'
  const optimisticRepeatActive = optimisticRepeat != null && receivedAt <= optimisticRepeat.at
  const repeat =
    optimisticRepeatActive && optimisticRepeat ? optimisticRepeat.value : repeatFromStatus

  const transitioning = trackTransitionAt > 0 && receivedAt <= trackTransitionAt

  const onPlayPause = useCallback(() => {
    setOptimisticPause({ value: !isPaused, at: Date.now() })
    void togglePlayPause()
  }, [isPaused, togglePlayPause])

  const onPrev = useCallback(() => {
    const now = Date.now()
    const recent = now - lastPrevAtRef.current < PREV_DOUBLE_TAP_MS
    lastPrevAtRef.current = now
    if (recent) {
      // second press within window > actual prev
      setTrackTransitionAt(now)
      void prev()
    } else {
      // first press > rewind to start of current track
      void seek(0)
    }
  }, [prev, seek])

  const onNext = useCallback(() => {
    setTrackTransitionAt(Date.now())
    void next()
  }, [next])

  const onToggleShuffle = useCallback(() => {
    const nextShuffle = !shuffle
    setOptimisticShuffle({ value: nextShuffle, at: Date.now() })
    void setShuffle(nextShuffle)
  }, [shuffle, setShuffle])

  const onCycleRepeat = useCallback(() => {
    const nextMode: RepeatMode =
      repeat === 'off' ? 'context' : repeat === 'context' ? 'track' : 'off'
    setOptimisticRepeat({ value: nextMode, at: Date.now() })
    void setRepeat(nextMode)
  }, [repeat, setRepeat])

  return {
    isPaused,
    shuffle,
    repeat,
    transitioning,
    onPlayPause,
    onPrev,
    onNext,
    onToggleShuffle,
    onCycleRepeat,
  }
}
