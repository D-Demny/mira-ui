import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/_global.scss'
import App from './App.tsx'
import { DevOverlay, DevScreenProvider } from '@/dev/DevScreens'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { VoiceNotifier } from '@/voice/VoiceNotifier'
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary'

window.addEventListener('error', (e) => console.error('uncaught:', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.error('unhandled rejection:', e.reason),
)

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
