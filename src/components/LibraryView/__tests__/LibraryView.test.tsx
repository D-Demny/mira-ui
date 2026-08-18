import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { LibraryView } from '../LibraryView'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'
import type { SpotifyPlaylist } from '@/api/types'

beforeEach(() => {
  clearCache()
})

const mockPlaylists: SpotifyPlaylist[] = [
  {
    id: 'pl1',
    name: 'My Playlist',
    uri: 'spotify:playlist:pl1',
    owner: { display_name: 'User' },
    images: [],
    tracks: { total: 10 },
    collaborative: false,
  },
]

function mockPlaylistsApi(delayMs = 0) {
  server.use(
    http.get('*/web-api/me/playlists', async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      return HttpResponse.json({
        items: mockPlaylists,
        total: mockPlaylists.length,
        limit: 50,
        offset: 0,
      })
    }),
  )
}

describe('LibraryView', () => {
  it('shows the Home entry above the playlists', async () => {
    mockPlaylistsApi()
    render(<LibraryView onNavigate={vi.fn()} />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('My Playlist')).toBeInTheDocument())
  })

  it('keeps the Home entry visible while playlists load', () => {
    mockPlaylistsApi(50)
    render(<LibraryView onNavigate={vi.fn()} />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('navigates to home when the Home entry is selected', () => {
    mockPlaylistsApi()
    const onNavigate = vi.fn()
    render(<LibraryView onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Home'))
    expect(onNavigate).toHaveBeenCalledWith('home')
  })

  it('still plays a playlist when selected', async () => {
    mockPlaylistsApi()
    const onNavigate = vi.fn()
    const onPlay = vi.fn()
    render(<LibraryView onNavigate={onNavigate} onPlay={onPlay} />)
    await waitFor(() => expect(screen.getByText('My Playlist')).toBeInTheDocument())
    fireEvent.click(screen.getByText('My Playlist'))
    expect(onNavigate).toHaveBeenCalledWith('playlist')
    expect(onPlay).toHaveBeenCalledWith('spotify:playlist:pl1')
  })

  it('moves focus from Home to the first playlist on a dial turn', async () => {
    mockPlaylistsApi()
    const { container } = render(<LibraryView onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('My Playlist')).toBeInTheDocument())
    const menuList = container.querySelector('ul') as HTMLElement
    fireEvent.wheel(menuList, { deltaX: -1 })
    expect(screen.getByText('My Playlist').closest('li')).toHaveClass('focused')
    expect(screen.getByText('Home').closest('li')).not.toHaveClass('focused')
  })
})
