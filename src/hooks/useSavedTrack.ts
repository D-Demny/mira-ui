import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSavedState, setSavedState } from '@/api/client'

export interface UseSavedTrackResult {
  saved: boolean
  ready: boolean
  toggle: () => void
}

interface SavedState {
  uri: string | null
  saved: boolean | null
}

// tracks if the track is in liked songs. does not show on podcasts (yet?)
export function useSavedTrack(
  uri: string | null,
  onError?: (message: string) => void,
): UseSavedTrackResult {
  const [state, setState] = useState<SavedState>({ uri: null, saved: null })
  const userActedRef = useRef(false)

  useEffect(() => {
    userActedRef.current = false
    if (!uri) return

    const ac = new AbortController()
    fetchSavedState(uri, ac.signal)
      .then((s) => {
        if (ac.signal.aborted || userActedRef.current) return
        setState({ uri, saved: s })
      })
      .catch((err) => {
        if (ac.signal.aborted || userActedRef.current) return
        console.warn('saved-state fetch failed', err)
        setState({ uri, saved: false })
      })
    return () => ac.abort()
  }, [uri])

  // the stored value is only valid for the URI it was fetched against
  const current = state.uri === uri ? state.saved : null

  const toggle = useCallback(() => {
    if (!uri) return
    const before = current ?? false
    const next = !before
    userActedRef.current = true
    setState({ uri, saved: next }) // optimistic
    void setSavedState(uri, next).catch((err) => {
      console.warn('saved-state update failed', err)
      // revert
      setState({ uri, saved: before })
      onError?.(next ? "Couldn't add to Liked Songs" : "Couldn't remove from Liked Songs")
    })
  }, [current, onError, uri])

  return { saved: current ?? false, ready: current !== null, toggle }
}
