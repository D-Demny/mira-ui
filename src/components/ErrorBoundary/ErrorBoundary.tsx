import { Component, type CSSProperties, type ReactNode } from 'react'
import { BRAND_NAME } from '@/brand'

// crash screen

const RELOAD_DELAY_MS = 8000
const LOOP_WINDOW_MS = 90_000
const LOOP_MAX = 3
const KEY = 'mira.crashReloads'

function recentReloads(): number[] {
  try {
    const arr: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    const now = Date.now()
    return arr.filter((t): t is number => typeof t === 'number' && now - t < LOOP_WINDOW_MS)
  } catch {
    return []
  }
}

// inline styles only
const wrapStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  background: '#121212',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
}

interface Props {
  children: ReactNode
}

interface State {
  crashed: boolean
  givingUp: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, givingUp: false }
  private timer: number | undefined

  static getDerivedStateFromError(): Partial<State> {
    return { crashed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('render crash:', error)
    const recent = recentReloads()
    if (recent.length >= LOOP_MAX) {
      this.setState({ givingUp: true })
      return
    }
    try {
      sessionStorage.setItem(KEY, JSON.stringify([...recent, Date.now()]))
    } catch {
      // a full/blocked storage must not break the fallback
    }
    this.timer = window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
  }

  componentWillUnmount(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children
    return (
      <div style={wrapStyle}>
        <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: 1 }}>
          {BRAND_NAME.toLowerCase()}
        </div>
        <div style={{ fontSize: 20, marginTop: 18, opacity: 0.9 }}>Something went wrong</div>
        <div style={{ fontSize: 16, marginTop: 10, opacity: 0.6 }}>
          {this.state.givingUp
            ? 'Please restart the device (unplug and replug power)'
            : 'Restarting the display...'}
        </div>
      </div>
    )
  }
}
