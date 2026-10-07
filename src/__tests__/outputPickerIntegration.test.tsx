import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings, getSettings } from '@/settings'

// issue #92: the player's speaker-wireless button opens the "Ausgabegeräte" modal
// (Connect devices only, for now). Rendered as the real App with a mocked daemon so the
// full wiring is exercised: Controls → overlays → OverlayHost → OutputPicker → settings.

const mockDevices = [
  {
    id: 'dev-living',
    name: 'Living Room',
    type: 'OTHER',
    volume: 40,
    volume_steps: 100,
    volume_disabled: false,
    is_active: true,
    is_offline: false,
    can_transfer: true,
  },
  {
    id: 'dev-kitchen',
    name: 'Kitchen',
    type: 'OTHER',
    volume: 40,
    volume_steps: 100,
    volume_disabled: false,
    is_active: false,
    is_offline: false,
    can_transfer: true,
  },
]

let rootEl: HTMLDivElement

function renderApp() {
  return render(
    <DevScreenContext.Provider value={{ forced: 'playing-lyrics', setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
    { container: rootEl },
  )
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  clearCache()
  clearRecentCache()
  clearTracksCache()
  rootEl = document.createElement('div')
  rootEl.id = 'root'
  document.body.appendChild(rootEl)
  server.use(
    http.get('*/connect/devices', () => HttpResponse.json({ devices: mockDevices })),
    http.get('*/web-api/me/playlists', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
    ),
    http.get('*/web-api/me/player/recently-played', () => HttpResponse.json({ items: [] })),
  )
})

afterEach(() => {
  rootEl.remove()
})

describe('issue #92: speaker icon opens the Ausgabegeräte modal on the player', () => {
  it('lists the connect devices with the active one highlighted', async () => {
    renderApp()

    // the player's own output button (issue #92 replaced the three-dots "More")
    const button = await screen.findByRole('button', { name: 'Select output' })
    fireEvent.click(button)

    expect(await screen.findByText('Ausgabegeräte')).toBeInTheDocument()
    expect(screen.getByText('Living Room')).toBeInTheDocument()
    expect(screen.getByText('Kitchen')).toBeInTheDocument()

    // the row the playback is currently on gets the highlight + "Aktiv" subtitle
    const row = screen.getByText('Living Room').closest('.activeRow')
    expect(row).toBeTruthy()
    expect(row!.textContent).toContain('Aktiv')
    expect(screen.getByText('Kitchen').closest('.activeRow')).toBeNull()
  })

  it('a star tap persists the Standard-Gerät without selecting a device', async () => {
    renderApp()
    const button = await screen.findByRole('button', { name: 'Select output' })
    fireEvent.click(button)
    await screen.findByText('Ausgabegeräte')

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen als Standard-Gerät festlegen' }))

    expect(getSettings().defaultDeviceId).toBe('dev-kitchen')
  })

  it('a row tap transfers playback and closes the modal', async () => {
    renderApp()
    const button = await screen.findByRole('button', { name: 'Select output' })
    fireEvent.click(button)
    await screen.findByText('Ausgabegeräte')

    // Kitchen is not the active device; tapping it sends the transfer and dismisses
    fireEvent.click(screen.getByText('Kitchen'))

    await waitFor(() => expect(screen.queryByText('Ausgabegeräte')).not.toBeInTheDocument())
  })
})
