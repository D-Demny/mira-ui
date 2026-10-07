import { useEffect } from 'react'

// issue #85: quiet time after playback stopped ("Nothing playing") before the UI
// switches to the Home Assistant view — the spec calls for a short ~3 s delay.
export const IDLE_HOME_STOPPED_MS = 3000
// grace period while a track is paused before the switch happens.
export const IDLE_HOME_PAUSED_MS = 30_000

// player phase as seen by the auto-home machine (issue #85)
export type IdleHomePhase = 'stopped' | 'paused' | 'playing'

export interface UseIdleHomeParams {
  // settings toggle "Auto-switch to Home when idle" (default ON)
  enabled: boolean
  // true only while the base route is settled idle/player — no offline/auth/
  // boot/setup screen, no drop hold, not in library navigation, no forced dev
  // screen. While false the machine neither arms nor clears the view.
  eligible: boolean
  phase: IdleHomePhase
  // the auto-home flag is currently raised (view showing)
  showing: boolean
  onShow: () => void
  onHide: () => void
}

// every physical control reaches the browser as these DOM events — dial =
// wheel, screen tap = pointerdown, knob press / back / presets / power =
// keydown (see useHardwareButtons). Capture phase so a handler that stops
// propagation cannot look like quiet.
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

export function useIdleHome({
  enabled,
  eligible,
  phase,
  showing,
  onShow,
  onHide,
}: UseIdleHomeParams): void {
  // A playing player takes over immediately regardless of the current view
  // (spec), and a disabled toggle hides the view. Mere ineligibility (a system
  // screen over the menu) does NOT clear the flag — the route ladder masks the
  // menu while those screens are up, and the view resumes when they clear
  // instead of re-arming another idle timer.
  useEffect(() => {
    if (!showing) return
    if (phase === 'playing' || !enabled) onHide()
  }, [showing, phase, enabled, onHide])

  // arm the switch while the player is stopped/paused and no other view owns
  // the screen; any user interaction restarts the full delay, a phase change
  // re-arms with that phase's delay.
  useEffect(() => {
    if (!eligible || !enabled || showing || phase === 'playing') return
    const ms = phase === 'paused' ? IDLE_HOME_PAUSED_MS : IDLE_HOME_STOPPED_MS
    let timer = window.setTimeout(onShow, ms)
    const restart = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(onShow, ms)
    }
    for (const name of INPUT_EVENTS) window.addEventListener(name, restart, { capture: true })
    return () => {
      window.clearTimeout(timer)
      for (const name of INPUT_EVENTS) window.removeEventListener(name, restart, { capture: true })
    }
  }, [eligible, enabled, phase, showing, onShow])
}
