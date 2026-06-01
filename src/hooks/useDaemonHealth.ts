import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/config'

// disabled in App.tsx atm
const POLL_MS = 4000
const FAIL_THRESHOLD = 6
const REQUEST_TIMEOUT_MS = 3000

export function useDaemonHealth(): { daemonDown: boolean } {
  const [daemonDown, setDaemonDown] = useState(false)
  const failsRef = useRef(0)
  const everSucceededRef = useRef(false)
  const downRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const ac = new AbortController()
      const timer = window.setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(`${API_BASE}/observer/status`, {
          signal: ac.signal,
          cache: 'no-store',
        })
        if (cancelled) return
        if (res.ok) {
          failsRef.current = 0
          everSucceededRef.current = true
          if (downRef.current) {
            downRef.current = false
            setDaemonDown(false)
          }
        } else {
          failsRef.current++
        }
      } catch {
        if (cancelled) return
        failsRef.current++
      } finally {
        window.clearTimeout(timer)
      }

      if (!downRef.current && failsRef.current >= FAIL_THRESHOLD && !everSucceededRef.current) {
        downRef.current = true
        setDaemonDown(true)
      }
    }

    void check()
    const id = window.setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return { daemonDown }
}
