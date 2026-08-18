import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHaEntityState, toggleHaEntity } from '@/api/homeassistant'

export const HOME_LIGHT_ENTITY_ID = 'light.3er_stehlampe_gold_esszimmer'
export const HOME_LIGHT_LABEL = '3er Stehlampe Gold'

export type HomeLightState = 'on' | 'off'

function toLightState(raw: string): HomeLightState {
  return raw === 'on' ? 'on' : 'off'
}

export function useHomeLight() {
  const [state, setState] = useState<HomeLightState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchState = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const entity = await fetchHaEntityState(HOME_LIGHT_ENTITY_ID, signal)
      if (!signal.aborted) {
        setState(toLightState(entity.state))
        setLoading(false)
      }
    } catch (err: unknown) {
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : 'Failed to reach Home Assistant'
        console.warn('useHomeLight error:', message)
        setError(message)
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    void fetchState(controller.signal)
    return () => controller.abort()
  }, [fetchState])

  const toggle = useCallback(async () => {
    if (toggling) return
    setToggling(true)
    setError(null)
    const previous = state
    if (previous) setState(previous === 'on' ? 'off' : 'on')
    try {
      const updated = await toggleHaEntity(HOME_LIGHT_ENTITY_ID)
      if (updated) {
        setState(toLightState(updated.state))
      } else {
        // no entity in the service response — resync from the states endpoint
        const entity = await fetchHaEntityState(HOME_LIGHT_ENTITY_ID)
        setState(toLightState(entity.state))
      }
    } catch (err: unknown) {
      if (previous) setState(previous)
      const message = err instanceof Error ? err.message : 'Failed to toggle light'
      console.warn('useHomeLight toggle error:', message)
      setError(message)
    } finally {
      setToggling(false)
    }
  }, [toggling, state])

  const refetch = useCallback(() => {
    const controller = new AbortController()
    abortRef.current = controller
    void fetchState(controller.signal)
  }, [fetchState])

  return { state, loading, error, toggling, toggle, refetch }
}
