import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetLyricsCache } from '@/hooks/useLyrics'
import { __resetSettings, getSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'

// bug52: a track without available lyrics must render the standard full-width
// player layout (the exact layout "Show lyrics" OFF renders) instead of the
// split view with an empty "No lyrics available" box.

// the dev mock status takes its track identity from VITE_MOCK_* env vars
function seedMockTrack() {
  vi.stubEnv('VITE_MOCK_TRACK_ID', 'mock-track-1')
  vi.stubEnv('VITE_MOCK_TRACK_URI', 'spotify:track:mock-track-1')
  vi.stubEnv('VITE_MOCK_TRACK_NAME', 'Mock Track')
  vi.stubEnv('VITE_MOCK_TRACK_ARTIST', 'Mock Artist')
  vi.stubEnv('VITE_MOCK_TRACK_ALBUM', 'Mock Album')
  vi.stubEnv('VITE_MOCK_TRACK_IMAGE', 'http://img/mock-cover.jpg')
}

const LYRICS_FIXTURE = {
  syncType: 'LINE_SYNCED',
  lines: [
    { startTimeMs: '0', words: 'Mock lyric line one' },
    { startTimeMs: '5000', words: 'Mock lyric line two' },
  ],
}

let rootEl: HTMLDivElement
let stopSync: (() => void) | null = null

function renderApp() {
  return render(
    <DevScreenContext.Provider value={{ forced: 'playing-lyrics', setForced: vi.fn() }}>
      <App />
    </DevScreenContext.Provider>,
    { container: rootEl },
  )
}

// both now-playing layers stay mounted for the cross-fade; the visible one
// carries the viewActive class, the hidden one viewInactive
function lyricsLayer(container: HTMLElement): HTMLElement {
  return container.querySelectorAll<HTMLElement>('.viewLayer')[0]
}
function standardLayer(container: HTMLElement): HTMLElement {
  return container.querySelectorAll<HTMLElement>('.viewLayer')[1]
}
function lyricsLayerActive(container: HTMLElement): boolean {
  return lyricsLayer(container).className.includes('viewActive')
}
function standardLayerActive(container: HTMLElement): boolean {
  return standardLayer(container).className.includes('viewActive')
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  clearCache()
  clearRecentCache()
  clearTracksCache()
  __resetLyricsCache()
  seedMockTrack()
  rootEl = document.createElement('div')
  rootEl.id = 'root'
  document.body.appendChild(rootEl)
  stopSync = startUiScaleSync()
  server.use(
    http.get('*/connect/devices', () => HttpResponse.json([])),
    http.get('*/player/saved', () => HttpResponse.json({ saved: false })),
    http.get('*/web-api/me/playlists', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 }),
    ),
    http.get('*/web-api/me/player/recently-played', () => HttpResponse.json({ items: [] })),
  )
})

afterEach(() => {
  stopSync?.()
  stopSync = null
  rootEl.remove()
  vi.unstubAllEnvs()
})

describe('bug52: now-playing layout follows lyrics availability', () => {
  it('keeps the split view when the setting is ON and the track has lyrics', async () => {
    server.use(http.get('*/lyrics/mock-track-1', () => HttpResponse.json(LYRICS_FIXTURE)))

    const { container } = renderApp()

    expect(await screen.findByText('Mock lyric line one')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
  })

  it('falls back to the standard layout when the track has no lyrics (404)', async () => {
    let hits = 0
    server.use(
      http.get('*/lyrics/mock-track-1', () => {
        hits++
        return new HttpResponse(null, { status: 404 })
      }),
    )

    const { container } = renderApp()

    // wait for the fetch round trip (150ms debounce + 404) to complete
    await waitFor(() => expect(hits).toBeGreaterThan(0))
    await waitFor(() => expect(standardLayerActive(container)).toBe(true))
    expect(lyricsLayerActive(container)).toBe(false)
    // standard layout: cover + artist/title, and no empty lyrics box in the
    // visible layer
    const std = standardLayer(container)
    expect(std.textContent).toContain('Mock Track')
    expect(std.textContent).toContain('Mock Artist')
    expect(std.textContent).not.toContain('No lyrics available')
  })

  it('falls back to the standard layout on a lyrics fetch error (500)', async () => {
    let hits = 0
    server.use(
      http.get('*/lyrics/mock-track-1', () => {
        hits++
        return new HttpResponse(null, { status: 500 })
      }),
    )

    const { container } = renderApp()

    await waitFor(() => expect(hits).toBeGreaterThan(0))
    await waitFor(() => expect(standardLayerActive(container)).toBe(true))
    expect(lyricsLayerActive(container)).toBe(false)
    expect(standardLayer(container).textContent).not.toContain('No lyrics available')
  })

  it('falls back to the standard layout when the daemon returns zero lines', async () => {
    let hits = 0
    server.use(
      http.get('*/lyrics/mock-track-1', () => {
        hits++
        return HttpResponse.json({ syncType: 'UNSYNCED', lines: [] })
      }),
    )

    const { container } = renderApp()

    await waitFor(() => expect(hits).toBeGreaterThan(0))
    await waitFor(() => expect(standardLayerActive(container)).toBe(true))
    expect(lyricsLayerActive(container)).toBe(false)
    expect(standardLayer(container).textContent).not.toContain('No lyrics available')
  })

  it('strictly keeps the standard layout when the setting is OFF and does not fetch lyrics', async () => {
    server.use(http.get('*/settings', () => HttpResponse.json({ v: 1, showLyrics: false })))
    let hits = 0
    server.use(
      http.get('*/lyrics/mock-track-1', () => {
        hits++
        return HttpResponse.json(LYRICS_FIXTURE)
      }),
    )

    const { container } = renderApp()

    // wait for the daemon-seeded setting to land, then let the fetch debounce
    // window (150ms) pass
    await waitFor(() => expect(getSettings().showLyrics).toBe(false))
    await new Promise((r) => setTimeout(r, 200))
    expect(standardLayerActive(container)).toBe(true)
    expect(lyricsLayerActive(container)).toBe(false)
    expect(hits).toBe(0)
  })

  it('shows the standard layout while lyrics are loading, then switches to the split view on arrival', async () => {
    let hits = 0
    let release: (() => void) | null = null
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('*/lyrics/mock-track-1', async () => {
        hits++
        await pending
        return HttpResponse.json(LYRICS_FIXTURE)
      }),
    )

    const { container } = renderApp()

    // fetch in flight: standard layout, no lyrics box in the visible layer
    await waitFor(() => expect(hits).toBeGreaterThan(0))
    expect(standardLayerActive(container)).toBe(true)
    expect(lyricsLayerActive(container)).toBe(false)
    expect(standardLayer(container).textContent).not.toContain('No lyrics available')

    // lyrics arrive -> switch to the split view
    release!()
    expect(await screen.findByText('Mock lyric line one')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
  })
})
