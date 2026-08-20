import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const hookState = vi.hoisted(() => ({
  toggle: vi.fn(),
}))

vi.mock('@/hooks/usePlaylists', () => ({
  usePlaylists: () => ({
    items: [
      {
        id: 'pl-1',
        name: 'Road Trip',
        owner: { display_name: 'Mira Mix' },
        images: [{ url: 'http://img/r.jpg' }],
        tracks: { total: 12 },
        collaborative: false,
        uri: 'spotify:playlist:pl-1',
      },
      {
        id: 'pl-2',
        name: 'Workout',
        owner: { display_name: 'Mira Mix' },
        images: [],
        tracks: { total: 8 },
        collaborative: false,
        uri: 'spotify:playlist:pl-2',
      },
    ],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))

vi.mock('@/hooks/useRecent', () => ({
  useRecent: () => ({
    items: [
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
    ],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))

vi.mock('@/hooks/useHomeLight', () => ({
  HOME_LIGHT_LABEL: '3er Stehlampe Gold',
  useHomeLight: () => ({
    state: 'on',
    loading: false,
    error: null,
    toggling: false,
    toggle: hookState.toggle,
  }),
}))

vi.mock('@/settings', () => ({
  useSettings: () => ({
    showLyrics: false,
    karaokeLyrics: false,
    lyricOffsetMs: 0,
    volumeStepPct: 5,
    autoBrightness: true,
    brightness: 70,
    voiceMic: false,
    uiScalePct: 100,
    presets: {},
    defaultDeviceId: null,
  }),
}))

import { MainMenuView } from '../MainMenuView'
import type { ObserverStatusActive } from '@/api/types'

const nowPlaying: ObserverStatusActive = {
  active: true,
  device_id: 'device-1',
  device_name: 'Mira',
  device_type: 'speaker',
  track_id: 't-9',
  track_uri: 'spotify:track:t-9',
  track_name: 'Heat Waves',
  track_artist: 'Glass Animals',
  track_album: 'Heat Waves',
  track_image: 'http://img/h.jpg',
  context_uri: 'spotify:context:1',
  context_name: 'Chill',
  duration: 200,
  position: 10,
  is_playing: true,
  is_paused: false,
  shuffle: false,
  repeat_context: false,
  repeat_track: false,
  lyrics_url: '',
  received_at: 0,
  next_tracks: [
    {
      uri: 'spotify:track:t-10',
      track_id: 't-10',
      name: 'Next Song',
      artist: 'Someone',
      album: 'An Album',
      image_url: '',
    },
  ],
}

describe('ContentCarousel', () => {
  beforeEach(() => {
    hookState.toggle.mockClear()
  })

  it('binds the Home category to the live light state', () => {
    render(<MainMenuView />)
    expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
    expect(screen.getByText('An')).toBeInTheDocument()
  })

  it('binds the Playlists category to the fetched playlists', () => {
    const { container } = render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(screen.getByText('Road Trip')).toBeInTheDocument()
    expect(screen.getByText('Mira Mix · 12 Titel')).toBeInTheDocument()
    expect(screen.getByText('Workout')).toBeInTheDocument()
    expect(container.querySelectorAll('.card')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Road Trip' })).toBeInTheDocument()
  })

  it('binds the Zuletzt category to recently played tracks', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Zuletzt' }))
    expect(screen.getByText('Siamese Dream')).toBeInTheDocument()
    expect(screen.getByText('The Smashing Pumpkins')).toBeInTheDocument()
  })

  it('binds the Einstellungen category to live settings values', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))
    expect(screen.getByText('Lyrics')).toBeInTheDocument()
    expect(screen.getByText('Auto · 70%')).toBeInTheDocument()
    expect(screen.getByText('+5% pro Schritt')).toBeInTheDocument()
    expect(screen.getByText('Sprach-Mikrofon')).toBeInTheDocument()
  })

  it('tapping a media card starts playback and switches to Läuft gerade', () => {
    const onPlay = vi.fn()
    render(<MainMenuView onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    fireEvent.click(screen.getByText('Road Trip'))
    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl-1')
    expect(screen.getByRole('button', { name: 'Läuft gerade' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText('Nichts läuft')).toBeInTheDocument()
  })

  it('tapping the light action card toggles the light without leaving the menu', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByText('3er Stehlampe Gold'))
    expect(hookState.toggle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('shows the current track and queue in the Läuft gerade category', () => {
    render(<MainMenuView nowPlaying={nowPlaying} />)
    fireEvent.click(screen.getByRole('button', { name: 'Läuft gerade' }))
    expect(screen.getByText('Heat Waves')).toBeInTheDocument()
    expect(screen.getByText('Glass Animals')).toBeInTheDocument()
    expect(screen.getByText('Next Song')).toBeInTheDocument()
  })
})
