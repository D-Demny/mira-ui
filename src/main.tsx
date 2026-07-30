import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/_global.scss'
import App from './App.tsx'
import { DevOverlay, DevScreenProvider } from '@/dev/DevScreens'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { VoiceNotifier } from '@/voice/VoiceNotifier'
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary'
import { startUiScaleSync } from '@/uiScale'

window.addEventListener('error', (e) => console.error('uncaught:', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('unhandled rejection:', e.reason),
)

// before render, so the ui never paints at the wrong size
startUiScaleSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <DevScreenProvider>
        <NotifyProvider>
          <App />
          <VoiceNotifier />
        </NotifyProvider>
        <DevOverlay />
      </DevScreenProvider>
    </ErrorBoundary>
  </StrictMode>,
)
