import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import App from '@/App'
import { DevScreenContext } from '@/dev/devContext'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import { clearRecentCache } from '@/hooks/useRecent'
import { clearTracksCache } from '@/hooks/usePlaylistTracks'
import { __resetSettings } from '@/settings'
import { startUiScaleSync } from '@/uiScale'
import type { LyricsResult } from '@/api/types'

// issue #26: the split-view vs. standard-layout decision must stay STICKY through a
// track change's lyrics fetch window — the layout only flips on a confirmed resolve
// (real data or a confirmed empty result), never because loading=true. The dev mock
// status pins one track, so this file replays exactly the state sequence the real
// useLyrics emits on a track change (stale-lyrics + loading → confirmed) through a
// mocked hook and asserts on the view layers App toggles.

type LyricsStateLike = { lyrics: LyricsResult | null; loading: boolean; error: string | null }

const ctrl = vi.hoisted(() => {
  let state: LyricsStateLike = { lyrics: null, loading: false, error: null }
  let version = 0
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: LyricsStateLike) {
      state = next
      version += 1
      listeners.forEach((l) => l())
    },
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getVersion: () => version,
  }
})

// vi.mock hoists above the imports; the async factory re-exports everything from
// the real module (primeLyricsCache, useLyricStarts, __lyricsCacheStats, ...) and
// only replaces the hook under test with a scripted state source
vi.mock('@/hooks/useLyrics', async () => {
  const { useSyncExternalStore } = await import('react')
  const mod = (await vi.importActual('@/hooks/useLyrics')) as Record<string, unknown>
  return {
    ...mod,
    useLyrics: () => {
      useSyncExternalStore(ctrl.subscribe, ctrl.getVersion)
      return ctrl.get()
    },
  }
})

const A_LYRICS: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [
    { startTimeMs: '0', words: 'A song line' },
    { startTimeMs: '5000', words: 'A second line' },
  ],
}
const B_LYRICS: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [
    { startTimeMs: '0', words: 'B song line' },
    { startTimeMs: '5000', words: 'B second line' },
  ],
}
// AC3 fixtures: the mid-play richsync upgrade replaces line-only lyrics with the
// same content plus word timing (KaraokeLine renders per-syllable spans)
const LINE_ONLY: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [{ startTimeMs: '0', words: 'C line' }],
}
const WORD_LEVEL: LyricsResult = {
  syncType: 'LINE_SYNCED',
  lines: [
    {
      startTimeMs: '0',
      words: 'C line',
      syllables: [
        { startTimeMs: '0', word: 'C' },
        { startTimeMs: '300', word: ' line' },
      ],
    },
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
// carries the viewActive class, the hidden one viewInactive (same helpers as
// nowPlayingLyricsFallback.test.tsx)
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

function seedMockTrack() {
  vi.stubEnv('VITE_MOCK_TRACK_ID', 'mock-track-1')
  vi.stubEnv('VITE_MOCK_TRACK_URI', 'spotify:track:mock-track-1')
  vi.stubEnv('VITE_MOCK_TRACK_NAME', 'Mock Track')
  vi.stubEnv('VITE_MOCK_TRACK_ARTIST', 'Mock Artist')
  vi.stubEnv('VITE_MOCK_TRACK_ALBUM', 'Mock Album')
  vi.stubEnv('VITE_MOCK_TRACK_IMAGE', 'http://img/mock-cover.jpg')
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  clearCache()
  clearRecentCache()
  clearTracksCache()
  ctrl.set({ lyrics: null, loading: false, error: null })
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

describe('issue #26: layout decision stays sticky across a track change', () => {
  it('no-lyrics -> with-lyrics: stays standard until the fetch confirms, then switches once', async () => {
    const { container } = renderApp()

    // previous track confirmed without lyrics
    await waitFor(() => expect(standardLayerActive(container)).toBe(true))
    expect(lyricsLayerActive(container)).toBe(false)

    // track change: new song's lyrics in flight — nothing was confirmed before,
    // so the standard layout holds (no lyrics box, no flash either way)
    act(() => {
      ctrl.set({ lyrics: null, loading: true, error: null })
    })
    expect(standardLayerActive(container)).toBe(true)
    expect(lyricsLayerActive(container)).toBe(false)

    // confirmed arrival: single switch to the split view
    act(() => {
      ctrl.set({ lyrics: B_LYRICS, loading: false, error: null })
    })
    expect(await screen.findByText('B song line')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
  })

  it('with-lyrics -> no-lyrics: split view holds during the fetch, hides only on the confirmed empty result', async () => {
    const { container } = renderApp()
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: false, error: null })
    })
    expect(await screen.findByText('A song line')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)

    // track change into a no-lyrics song: the previous decision (split view)
    // sticks while the fetch is in flight — no early drop to standard
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: true, error: null }) // stale, still confirmed
    })
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
    // and no stale lines of the previous song render — only the loading state
    expect(screen.queryByText('A song line')).not.toBeInTheDocument()
    expect(screen.getByText('Loading lyrics...')).toBeInTheDocument()

    // confirmed empty (404 / zero lines, or "Instrumental" normalized to null per #25)
    act(() => {
      ctrl.set({ lyrics: null, loading: false, error: null })
    })
    expect(standardLayerActive(container)).toBe(true)
    expect(lyricsLayerActive(container)).toBe(false)
    expect(screen.queryByText('A song line')).not.toBeInTheDocument()
  })

  it('with-lyrics -> with-lyrics: no standard-layout flash during the fetch window (the flicker)', async () => {
    const { container } = renderApp()
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: false, error: null })
    })
    expect(await screen.findByText('A song line')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)

    // track change: B's fetch in flight. Before the fix this dropped to the
    // standard layer for the whole 0.5-1 s window and flipped back on arrival
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: true, error: null })
    })
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
    expect(screen.queryByText('A song line')).not.toBeInTheDocument()
    expect(screen.getByText('Loading lyrics...')).toBeInTheDocument()

    // B's lyrics arrive — the split view was never away
    act(() => {
      ctrl.set({ lyrics: B_LYRICS, loading: false, error: null })
    })
    expect(await screen.findByText('B song line')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
  })

  it('richsync mid-play upgrade still lands in the active layout without a flash', async () => {
    const { container } = renderApp()
    act(() => {
      ctrl.set({ lyrics: LINE_ONLY, loading: false, error: null })
    })
    expect(await screen.findByText('C line')).toBeInTheDocument()
    expect(lyricsLayerActive(container)).toBe(true)

    // the word-by-word upgrade arrives mid-play (confirmed state, not a track change)
    act(() => {
      ctrl.set({ lyrics: WORD_LEVEL, loading: false, error: null })
    })
    // same layout throughout — only the line re-renders as karaoke spans
    expect(lyricsLayerActive(container)).toBe(true)
    expect(standardLayerActive(container)).toBe(false)
    await waitFor(() => {
      // 'C line' is now split into per-syllable spans ('C' + ' line') — the word
      // spans carry a class containing 'word' (word / wordSung), plain lines do not
      const wordSpans = Array.from(container.querySelectorAll<HTMLElement>('span')).filter((s) =>
        s.className.includes('word'),
      )
      expect(wordSpans.map((s) => s.textContent).join('')).toBe('C line')
    })
  })

  it('instrumental (normalized to null per #25) keeps the standard layout stable across a switch', async () => {
    const { container } = renderApp()
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: false, error: null })
    })
    expect(await screen.findByText('A song line')).toBeInTheDocument()

    // next track is instrumental: client.ts normalizes the placeholder to null at
    // fetch time, so the confirmed state is exactly the no-lyrics one
    act(() => {
      ctrl.set({ lyrics: A_LYRICS, loading: true, error: null })
    })
    expect(lyricsLayerActive(container)).toBe(true) // sticky during the fetch

    act(() => {
      ctrl.set({ lyrics: null, loading: false, error: null })
    })
    await waitFor(() => expect(standardLayerActive(container)).toBe(true))
    expect(lyricsLayerActive(container)).toBe(false)
    // the placeholder text itself never renders anywhere
    expect(container.textContent).not.toMatch(/instrumental/i)
  })
})
