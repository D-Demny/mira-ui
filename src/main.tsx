import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/_global.scss'
import App from './App.tsx'
import { DevOverlay, DevScreenProvider } from '@/dev/DevScreens'
import { NotifyProvider } from '@/notify/NotifyProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevScreenProvider>
      <NotifyProvider>
        <App />
      </NotifyProvider>
      <DevOverlay />
    </DevScreenProvider>
  </StrictMode>,
)
