// pure classifier for touch swipe gestures on the player view
//   one finger swipe across - next/prev track
//   two-finger up/down swipe   - toggle lyrics/album view

// 1 finger horizontal distance to commit a track skip
export const SWIPE_MIN_PX = 50
// 2 finger accumulated vertical distance to commit a view toggle
export const TWO_FINGER_MIN_PX = 24
// horizontal travel must beat vertical by this factor to count as a swipe
export const AXIS_RATIO = 1.5
// once 1 finger movement passes this we decide axis
export const AXIS_DECIDE_PX = 12

export type SwipeAction = 'next' | 'prev' | 'toggleView'

export type SwipeState =
  | { kind: 'idle' }
  | {
      kind: 'tracking'
      startX: number
      startY: number
      maxTouches: number
      mode: 'undecided' | 'vscroll' | 'committed'
      // two finger vertical accumulator
      lastCount: number
      lastY: number
      accumY: number
    }

export type SwipeEvent =
  | { type: 'start'; x: number; y: number; touches: number }
  | { type: 'move'; x: number; y: number; touches: number }
  | { type: 'end'; touches: number }

export interface SwipeResult {
  next: SwipeState
  action?: SwipeAction
}

export const INITIAL_SWIPE_STATE: SwipeState = { kind: 'idle' }

// start and move are both just position samples
function sample(state: SwipeState, x: number, y: number, touches: number): SwipeResult {
  if (state.kind !== 'tracking') {
    return {
      next: {
        kind: 'tracking',
        startX: x,
        startY: y,
        maxTouches: touches,
        mode: 'undecided',
        lastCount: touches,
        lastY: y,
        accumY: 0,
      },
    }
  }

  const maxTouches = Math.max(state.maxTouches, touches)
  const countChanged = touches !== state.lastCount
  const reachedTwoFirst = state.maxTouches < 2 && touches >= 2

  let accumY = state.accumY
  if (countChanged) {
    // reset the accumulator the first time two fingers appear
    if (reachedTwoFirst) accumY = 0
  } else {
    accumY += y - state.lastY
  }

  const base: SwipeState = { ...state, maxTouches, lastCount: touches, lastY: y, accumY }

  // two fingers only the vertical view toggle path is live
  if (maxTouches >= 2) {
    if (base.mode === 'committed') return { next: base }
    // commit only while two fingers are genuinely down
    if (touches >= 2 && Math.abs(accumY) > TWO_FINGER_MIN_PX) {
      return { next: { ...base, mode: 'committed' }, action: 'toggleView' }
    }
    return { next: base }
  }

  // single finger horizontal track skip
  if (base.mode !== 'undecided') return { next: base }
  const dx = x - state.startX
  const dy = y - state.startY
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)

  // a clear vertical lead means a scroll
  if (ady > AXIS_DECIDE_PX && ady > adx) {
    return { next: { ...base, mode: 'vscroll' } }
  }
  // committed horizontal swipe
  if (adx >= SWIPE_MIN_PX && adx > AXIS_RATIO * ady) {
    return { next: { ...base, mode: 'committed' }, action: dx < 0 ? 'next' : 'prev' }
  }
  return { next: base }
}

export function classify(state: SwipeState, event: SwipeEvent): SwipeResult {
  switch (event.type) {
    case 'start':
    case 'move':
      return sample(state, event.x, event.y, event.touches)
    case 'end':
      // wait until every finger is up before resetting
      if (event.touches > 0) return { next: state }
      return { next: INITIAL_SWIPE_STATE }
  }
}
