// pure state machine for the scrub gesture + optimistic position for progress

export const NO_SEEK_THRESHOLD_MS = 1500
export const MOVE_DETECT_RATIO = 0.01
export const PENDING_TIMEOUT_MS = 3000

export type ScrubState =
  | { kind: 'idle' }
  | { kind: 'gesture'; startRatio: number; lastRatio: number; moved: boolean }
  | { kind: 'pending'; ratio: number; at: number; fromMs: number }

export type ScrubEvent =
  | { type: 'pointerdown'; ratio: number }
  | { type: 'pointermove'; ratio: number }
  | { type: 'pointerup'; now: number; duration: number; positionAtClick: number }
  | { type: 'pointercancel' }
  | { type: 'status_update'; position: number; duration: number; receivedAt: number }
  | { type: 'pending_timeout' }

export interface SeekEffect {
  kind: 'seek'
  positionMs: number
}

export interface TransitionResult {
  next: ScrubState
  effect?: SeekEffect
}

export const INITIAL_SCRUB_STATE: ScrubState = { kind: 'idle' }

export function transition(state: ScrubState, event: ScrubEvent): TransitionResult {
  switch (state.kind) {
    case 'idle': {
      if (event.type === 'pointerdown') {
        return {
          next: {
            kind: 'gesture',
            startRatio: event.ratio,
            lastRatio: event.ratio,
            moved: false,
          },
        }
      }
      return { next: state }
    }

    case 'gesture': {
      if (event.type === 'pointermove') {
        const moved = state.moved || Math.abs(event.ratio - state.startRatio) > MOVE_DETECT_RATIO
        return {
          next: {
            kind: 'gesture',
            startRatio: state.startRatio,
            lastRatio: event.ratio,
            moved,
          },
        }
      }
      if (event.type === 'pointerup') {
        const endRatio = state.lastRatio
        const startRatio = state.startRatio

        if (state.moved) {
          const movedMs = Math.abs((endRatio - startRatio) * event.duration)
          if (movedMs < NO_SEEK_THRESHOLD_MS) {
            return { next: { kind: 'idle' } }
          }
        }

        return {
          next: {
            kind: 'pending',
            ratio: endRatio,
            at: event.now,
            fromMs: event.positionAtClick,
          },
          effect: {
            kind: 'seek',
            positionMs: Math.round(endRatio * event.duration),
          },
        }
      }
      if (event.type === 'pointercancel') {
        return { next: { kind: 'idle' } }
      }
      return { next: state }
    }

    case 'pending': {
      if (event.type === 'status_update') {
        if (event.receivedAt > state.at) {
          const distToPending = Math.abs(event.position - state.ratio * event.duration)
          const distToFrom = Math.abs(event.position - state.fromMs)
          if (distToPending < distToFrom) {
            return { next: { kind: 'idle' } }
          }
        }
        return { next: state }
      }
      if (event.type === 'pending_timeout') {
        return { next: { kind: 'idle' } }
      }
      if (event.type === 'pointerdown') {
        return {
          next: {
            kind: 'gesture',
            startRatio: event.ratio,
            lastRatio: event.ratio,
            moved: false,
          },
        }
      }
      return { next: state }
    }
  }
}
