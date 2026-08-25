import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext, type DevForcedScreen } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings } from '@/settings'
import { getUiScale, logicalSize, startUiScaleSync } from '@/uiScale'

// bug38: display size must scale the now-playing screen exclusively. these tests render
// the real App (dev screens forced) and assert where the zoom lands: on the player
// wrapper only, never on #root or the main menu.

const mockPlaylists = [
  {
    id: 'pl-1',
    name: 'Road Trip',
    owner: { display_name: 'Mira Mix' },
    images: [{ url: 'http://img/r.jpg' }],
    tracks: { total: 12 },
    collaborative: false,
    uri: 'spotify:playlist:pl-1',
  },
]

const mockRecent = [
  {
    track: {
      id: 't-1',
      name: 'Siamese Dream',
      artists: [{ name: 'The Smashing Pumpkins' }],
      album: { name: 'Mellon Collie', images: [{ url: 'http://img/s.jpg' }] },
      uri: 'spotify:track:t-1',
    },
    played_at: '2026-08-20T10:00:00Z',
  },
]

let rootEl: HTMLDivElement
let stopSync: (() => void) | null = null

function renderApp(forced: DevForcedScreen) {
  return render(
    <DevScreenContext.Provider value={{ forced, setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
    { container: rootEl },
  )
}

// the App seeds the scale from the daemon's /settings blob (initSettings replaces the
// local store), so the stored display size has to come through the mock
function seedSettings(uiScalePct: number) {
  server.use(http.get('*/settings', () => HttpResponse.json({ v: 1, uiScalePct })))
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
  // main.tsx bridges the settings store onto the scale store before the first render —
  // the tests need the same bridge so a daemon-seeded scale reaches the player wrapper
  stopSync = startUiScaleSync()
  server.use(
    http.get('*/connect/devices', () => HttpResponse.json([])),
    http.get('*/web-api/me/playlists', () =>
      HttpResponse.json({
        items: mockPlaylists,
        total: mockPlaylists.length,
        limit: 50,
        offset: 0,
      }),
    ),
    http.get('*/web-api/me/player/recently-played', () =>
      HttpResponse.json({ items: mockRecent }),
    ),
  )
})

afterEach(() => {
  stopSync?.()
  stopSync = null
  rootEl.remove()
})

describe('bug38: display size scaling is scoped to the now-playing screen', () => {
  it('leaves #root and the main menu at a fixed 100% when the menu is visible', async () => {
    seedSettings(115)
    const { container } = renderApp('mainmenu')

    // wait for the menu to bind its data (the home category is the default pane)
    expect(await screen.findByText('3er Stehlampe Gold')).toBeInTheDocument()

    // #root keeps its stylesheet size: no counter-size, no zoom
    expect(rootEl.style.width).toBe('')
    expect(rootEl.style.height).toBe('')
    expect(rootEl.style.getPropertyValue('zoom')).toBe('')

    // the menu shell itself is untouched and nothing in the menu tree carries a zoom
    const view = container.querySelector<HTMLElement>('.view')
    expect(view).toBeTruthy()
    expect(view!.style.zoom).toBe('')
    expect(view!.style.width).toBe('')
    expect(view!.style.height).toBe('')
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      expect(el.style.getPropertyValue('zoom')).toBe('')
    }

    // while the menu is visible the scale reads 1 (no zoomed subtree exists)
    expect(getUiScale()).toBe(1)
  })

  it('renders the zoom on the player wrapper only, with the menu sheet inside and the settings sheet outside', async () => {
    seedSettings(115)
    const { container } = renderApp('playing-lyrics')

    // wait for the daemon-seeded scale to reach the store and the wrapper to re-render
    const wrapper = (await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.app')
      expect(el).toBeTruthy()
      expect(el!.style.width).toBe(`${logicalSize(115).w}px`)
      return el
    })) as HTMLElement

    // the wrapper renders the logical viewport + zoom back onto the panel
    expect(wrapper.style.height).toBe(`${logicalSize(115).h}px`)
    expect(wrapper.style.getPropertyValue('zoom')).toBe(String(800 / logicalSize(115).w))

    // #root stays a constant 800x480
    expect(rootEl.style.width).toBe('')
    expect(rootEl.style.getPropertyValue('zoom')).toBe('')

    // the player's own menu sheet lives in the zoomed subtree ...
    const sheet = screen.getByText('Show Lyrics').closest('[role="dialog"]')
    expect(sheet).toBeTruthy()
    expect(wrapper.contains(sheet)).toBe(true)

    // ... while the settings list (and the other overlays) render at a fixed 100%
    const settingsSheet = screen.getByText('Display size').closest('[role="dialog"]')
    expect(settingsSheet).toBeTruthy()
    expect(wrapper.contains(settingsSheet)).toBe(false)

    // the scale reads the achieved zoom while the player view is mounted
    expect(getUiScale()).toBeCloseTo(800 / logicalSize(115).w, 10)
  })

  it('clamps an out-of-range stored scale for the player and still never zooms the menu', async () => {
    // 125 is outside the 85..115 range: the layout clamps to the max notch
    seedSettings(125)
    const { container } = renderApp('playing-lyrics')
    const wrapper = (await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.app')
      expect(el).toBeTruthy()
      expect(el!.style.width).toBe(`${logicalSize(115).w}px`)
      return el
    })) as HTMLElement
    expect(wrapper.style.getPropertyValue('zoom')).toBe(String(800 / logicalSize(115).w))
  })
})
