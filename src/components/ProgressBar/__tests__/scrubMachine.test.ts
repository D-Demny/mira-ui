import { describe, expect, it } from 'vitest'
import {
  INITIAL_SCRUB_STATE,
  MOVE_DETECT_RATIO,
  NO_SEEK_THRESHOLD_MS,
  type ScrubState,
  transition,
} from '../scrubMachine'

const DUR = 60_000

function gesture(startRatio: number, lastRatio: number, moved: boolean): ScrubState {
  return { kind: 'gesture', startRatio, lastRatio, moved }
}

function pending(ratio: number, at: number, fromMs: number): ScrubState {
  return { kind: 'pending', ratio, at, fromMs }
}

describe('scrubMachine gesture lifecycle', () => {
  it('treats a tap (pointerdown + immediate pointerup) as a seek to the tap location', () => {
    // taps always seek, moved=false skips the jitter threshold
    const down = transition(INITIAL_SCRUB_STATE, { type: 'pointerdown', ratio: 0.5 })
    expect(down.next).toEqual(gesture(0.5, 0.5, false))
    expect(down.effect).toBeUndefined()

    const up = transition(down.next, {
      type: 'pointerup',
      now: 100,
      duration: DUR,
      positionAtClick: 20_000,
    })
    expect(up.next).toEqual(pending(0.5, 100, 20_000))
    expect(up.effect).toEqual({ kind: 'seek', positionMs: 30_000 })
  })

  it('updates lastRatio on a small move without flipping the moved flag', () => {
    const next = transition(gesture(0.5, 0.5, false), {
      type: 'pointermove',
      ratio: 0.5 + MOVE_DETECT_RATIO / 2,
    }).next

    expect(next.kind).toBe('gesture')
    if (next.kind === 'gesture') {
      expect(next.startRatio).toBe(0.5)
      expect(next.lastRatio).toBeCloseTo(0.5 + MOVE_DETECT_RATIO / 2)
      expect(next.moved).toBe(false)
    }
  })

  it('flips moved past MOVE_DETECT_RATIO and keeps it sticky on small subsequent moves', () => {
    // sticky moved prevents drag/tap flip-flop mid-gesture
    const afterBig = transition(gesture(0.5, 0.5, false), {
      type: 'pointermove',
      ratio: 0.6,
    }).next
    expect(afterBig).toEqual(gesture(0.5, 0.6, true))

    const afterBack = transition(afterBig, { type: 'pointermove', ratio: 0.51 }).next
    expect(afterBack).toEqual(gesture(0.5, 0.51, true))
  })

  it('cancels a drag whose audio-distance is below the jitter threshold', () => {
    // 0.001 * 60s = 60ms moved, well under 1500ms threshold
    const result = transition(gesture(0.5, 0.501, true), {
      type: 'pointerup',
      now: 100,
      duration: DUR,
      positionAtClick: 30_000,
    })

    expect(result.next).toEqual({ kind: 'idle' })
    expect(result.effect).toBeUndefined()
  })

  it('commits a drag whose audio-distance exceeds the threshold', () => {
    const result = transition(gesture(0.5, 0.7, true), {
      type: 'pointerup',
      now: 100,
      duration: DUR,
      positionAtClick: 30_000,
    })

    expect(result.next).toEqual(pending(0.7, 100, 30_000))
    expect(result.effect).toEqual({ kind: 'seek', positionMs: 42_000 })
  })

  it('drops the gesture on pointercancel without emitting a seek', () => {
    // regression for the "drag goes to position 0" bug
    const result = transition(gesture(0.5, 0.7, true), { type: 'pointercancel' })

    expect(result.next).toEqual({ kind: 'idle' })
    expect(result.effect).toBeUndefined()
  })
})

describe('scrubMachine pending confirmation', () => {
  it('confirms a large seek when the observer position lands near the seek target', () => {
    const result = transition(pending(0.7, 100, 30_000), {
      type: 'status_update',
      position: 42_500,
      duration: DUR,
      receivedAt: 200,
    })

    expect(result.next).toEqual({ kind: 'idle' })
  })

  it('keeps pending state when a pre-confirmation event still reports the old position (small seek)', () => {
    // small seeks need the fromMs tiebreaker, raw distance alone can't tell
    const result = transition(pending(0.5005, 100, 30_000), {
      type: 'status_update',
      position: 30_000,
      duration: DUR,
      receivedAt: 200,
    })

    expect(result.next).toEqual(pending(0.5005, 100, 30_000))
  })

  it('confirms the same small seek once the observer position moves toward the target', () => {
    const result = transition(pending(0.5005, 100, 30_000), {
      type: 'status_update',
      position: 30_030,
      duration: DUR,
      receivedAt: 200,
    })

    expect(result.next).toEqual({ kind: 'idle' })
  })

  it('requires strict receivedAt > at to evaluate confirmation', () => {
    // stale in-flight events must not confirm even when position looks right
    const equal = transition(pending(0.7, 100, 30_000), {
      type: 'status_update',
      position: 42_000,
      duration: DUR,
      receivedAt: 100,
    })
    expect(equal.next).toEqual(pending(0.7, 100, 30_000))

    const earlier = transition(pending(0.7, 100, 30_000), {
      type: 'status_update',
      position: 42_000,
      duration: DUR,
      receivedAt: 99,
    })
    expect(earlier.next).toEqual(pending(0.7, 100, 30_000))
  })

  it('drops pending state on the hard 3s timeout', () => {
    const result = transition(pending(0.7, 100, 30_000), { type: 'pending_timeout' })
    expect(result.next).toEqual({ kind: 'idle' })
  })

  it('replaces pending with a fresh gesture on pointerdown', () => {
    const result = transition(pending(0.7, 100, 30_000), {
      type: 'pointerdown',
      ratio: 0.3,
    })

    expect(result.next).toEqual(gesture(0.3, 0.3, false))
    expect(result.effect).toBeUndefined()
  })
})

describe('scrubMachine irrelevant events are no-ops', () => {
  it('ignores pointer events in idle other than pointerdown', () => {
    for (const evt of [
      { type: 'pointermove', ratio: 0.5 },
      {
        type: 'pointerup',
        now: 0,
        duration: DUR,
        positionAtClick: 0,
      },
      { type: 'pointercancel' },
    ] as const) {
      const result = transition({ kind: 'idle' }, evt)
      expect(result.next).toEqual({ kind: 'idle' })
      expect(result.effect).toBeUndefined()
    }
  })

  it('ignores status_update during a gesture (drag takes priority)', () => {
    const g = gesture(0.5, 0.6, true)
    const result = transition(g, {
      type: 'status_update',
      position: 45_000,
      duration: DUR,
      receivedAt: 999_999,
    })

    expect(result.next).toEqual(g)
    expect(result.effect).toBeUndefined()
  })

  it('ignores stray pointermove/pointerup/pointercancel during pending', () => {
    const p = pending(0.7, 100, 30_000)
    for (const evt of [
      { type: 'pointermove', ratio: 0.3 },
      {
        type: 'pointerup',
        now: 200,
        duration: DUR,
        positionAtClick: 0,
      },
      { type: 'pointercancel' },
    ] as const) {
      const result = transition(p, evt)
      expect(result.next).toEqual(p)
      expect(result.effect).toBeUndefined()
    }
  })
})

describe('scrubMachine constants', () => {
  it('exposes the documented thresholds', () => {
    expect(NO_SEEK_THRESHOLD_MS).toBe(1500)
    expect(MOVE_DETECT_RATIO).toBe(0.01)
  })
})
