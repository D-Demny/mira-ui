import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/_global.scss'
import App from './App.tsx'
import { DevOverlay, DevScreenProvider } from '@/dev/DevScreens'
import { NavigationProvider } from '@/navigation/navigationContext'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { VoiceNotifier } from '@/voice/VoiceNotifier'
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary'
import { startUiScaleSync } from '@/uiScale'
import { API_BASE } from '@/config'

let uiErrorsSent = 0
function reportUiError(message: string) {
  if (uiErrorsSent >= 10) return
  uiErrorsSent++
  void fetch(`${API_BASE}/debug/ui-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.slice(0, 300) }),
  }).catch(() => {})
}

window.addEventListener('error', (e) => {
  console.error('uncaught:', e.error ?? e.message)
  const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''
  reportUiError(String(e.error ?? e.message) + where)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('unhandled rejection:', e.reason)
  reportUiError('unhandled rejection: ' + String(e.reason))
})

// before render, so the scale store is seeded (from localStorage) before the first
// now-playing render — the player wrapper renders the stored display size inline, so
// the ui never paints at the wrong size. bug38: the zoom itself lives on the player
// wrapper, #root stays a constant 800x480
startUiScaleSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NavigationProvider>
        <DevScreenProvider>
          <NotifyProvider>
            <App />
            <VoiceNotifier />
          </NotifyProvider>
          <DevOverlay />
        </DevScreenProvider>
      </NavigationProvider>
    </ErrorBoundary>
  </StrictMode>,
)
