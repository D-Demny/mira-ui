import { useCallback, useRef, useState } from 'react'
import { transferToDevice } from '@/api/client'
import type { ConnectDevice, ObserverStatus } from '@/api/types'
import { getSettings } from '@/settings'
import type { NotifyFn } from '@/notify/notifyContext'

// issue #79: after a decline the prompt stays quiet for this long; the next
// interaction then asks again
export const DEFAULT_DEVICE_PROMPT_SUPPRESS_MS = 10 * 60 * 1000

/** the open prompt: the deferred interaction plus its switch target */
export interface DefaultDevicePromptState {
  /** runs on accept or decline (never on cancel) */
  action: () => void
  deviceId: string
  deviceName: string
}

export interface UseDefaultDevicePromptParams {
  status: ObserverStatus | null
  connectDevices: ConnectDevice[]
  notify: NotifyFn
}

export interface UseDefaultDevicePromptResult {
  /**
   * Wraps a playback interaction (play/pause/next/prev/track selection). When
   * a default device is set, the active device differs from it, and the prompt
   * is not currently suppressed, the action is deferred and the prompt opens;
   * otherwise it runs immediately. Returns true when the action was deferred
   * behind the prompt.
   */
  wrapAction: (action: () => void) => boolean
  /** open prompt state, null while closed */
  prompt: DefaultDevicePromptState | null
  /** accept: run the deferred action AND transfer playback to the default device */
  accept: () => void
  /** decline: run the deferred action only, suppress the prompt for 10 minutes */
  decline: () => void
  /** cancel (Back / close): dismiss without running anything */
  cancel: () => void
}

export function useDefaultDevicePrompt({
  status,
  connectDevices,
  notify,
}: UseDefaultDevicePromptParams): UseDefaultDevicePromptResult {
  const suppressedUntilRef = useRef(0)
  const [prompt, setPrompt] = useState<DefaultDevicePromptState | null>(null)

  const wrapAction = useCallback(
    (action: () => void): boolean => {
      // a prompt is already up: swallow the extra interaction rather than
      // replacing the deferred one
      if (prompt != null) return true
      const defaultId = getSettings().defaultDeviceId
      if (
        defaultId == null ||
        status?.active !== true ||
        status.device_id === defaultId ||
        suppressedUntilRef.current > Date.now()
      ) {
        action()
        return false
      }
      const device = connectDevices.find((d) => d.id === defaultId)
      if (device == null) {
        // the stored default is no longer in the Connect list — nothing to
        // switch to, so the interaction just runs
        action()
        return false
      }
      setPrompt({ action, deviceId: defaultId, deviceName: device.name })
      return true
    },
    [prompt, status, connectDevices],
  )

  const accept = useCallback(() => {
    if (prompt == null) return
    const { action, deviceId } = prompt
    setPrompt(null)
    // the interaction always happens; a failed transfer degrades to the
    // decline outcome (action ran, device unchanged) plus an error toast
    action()
    void transferToDevice(deviceId).catch((err: unknown) => {
      console.warn('default device transfer failed', err)
      notify(`Couldn't switch to the default device`, { variant: 'error' })
    })
  }, [notify, prompt])

  const decline = useCallback(() => {
    if (prompt == null) return
    const { action } = prompt
    setPrompt(null)
    suppressedUntilRef.current = Date.now() + DEFAULT_DEVICE_PROMPT_SUPPRESS_MS
    action()
  }, [prompt])

  const cancel = useCallback(() => {
    setPrompt(null)
  }, [])

  return { wrapAction, prompt, accept, decline, cancel }
}
