import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { REMOTE_ART_TIMEOUT_MS, remoteArtUrl } from '@/api/miraImg'
import {
  __resetMiraServerState,
  checkMiraServer,
} from '@/hooks/useMiraServer'
import { __resetSettings, updateSettings } from '@/settings'
import type { MiraServerCapabilities } from '@/api/miraServer'
import { AlbumArt } from '../AlbumArt'

describe('AlbumArt', () => {
  it('renders an img for a valid source', () => {
    render(<AlbumArt src="http://img/a.jpg" alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toHaveAttribute('src', 'http://img/a.jpg')
  })

  // bug27: a missing src shows the music-note placeholder immediately — never
  // an <img> with an empty src (which would leave a pure black box)
  it('renders the music-note placeholder when no source is given', () => {
    const { container } = render(<AlbumArt src={undefined} alt="" size={100} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })

  it('renders the music-note placeholder for an empty src string (bug27)', () => {
    const { container } = render(<AlbumArt src="" alt="Cover" size={100} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })

  it('shows the music-note placeholder when the image fails to load (bug15)', () => {
    const { container } = render(<AlbumArt src="http://img/broken.jpg" alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toBeInTheDocument()

    // a failed load swaps the broken img for the music-note fallback (no black box)
    fireEvent.error(img)

    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })
})

describe('epic10 task 2: remoteBlur artwork adapter', () => {
  const CDN = 'http://i.scdn.co/image/ab67616d0000remoteblur'

  const COMPUTE: MiraServerCapabilities = {
    tier: 'compute',
    disk_cache: true,
    remote_colors: true,
    remote_blur: true,
  }

  beforeEach(() => {
    __resetMiraServerState()
    __resetSettings() // ticket10-5A: start every test without a Pi profile
  })

  // ticket10-5A: an active profile is the target of BOTH the capabilities
  // check and the /img/.../160.jpg route (no hard-coded default address
  // anymore). The handler is registered before the profile so the re-target
  // check the profile creation triggers already sees the COMPUTE answer —
  // the check completes before anything renders
  async function enableRemoteBlur() {
    server.use(http.get('*/api/v1/capabilities', () => HttpResponse.json(COMPUTE)))
    updateSettings({
      piProfiles: [
        { id: 'pi-1', label: 'Pi 1', ip: '192.168.7.1', user: 'root', password: '', keyInstalled: false },
      ],
      activePiId: 'pi-1',
    })
    await act(async () => {
      await checkMiraServer('192.168.7.1')
    })
  }

  it('loads the direct CDN url in standalone mode (regression)', () => {
    // the default MSW capabilities handler answers an error → standalone
    render(<AlbumArt src={CDN} alt="Cover" size={100} />)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', CDN)
  })

  it('loads the Pi pre-processed url when remoteBlur is enabled', async () => {
    await enableRemoteBlur()
    render(<AlbumArt src={CDN} alt="Cover" size={100} />)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', remoteArtUrl(CDN))
  })

  it('falls back to the CDN url when the Pi image errors (no placeholder flash)', async () => {
    await enableRemoteBlur()
    render(<AlbumArt src={CDN} alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toHaveAttribute('src', remoteArtUrl(CDN))

    // the Pi image fails: the img stays mounted and swaps to the CDN url —
    // the placeholder only shows after a second (CDN) failure
    fireEvent.error(img)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', CDN)
  })

  it('shows the placeholder only when the CDN fallback fails too', async () => {
    await enableRemoteBlur()
    const { container } = render(<AlbumArt src={CDN} alt="Cover" size={100} />)

    fireEvent.error(screen.getByRole('img', { name: 'Cover' })) // Pi image fails
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', CDN)
    fireEvent.error(screen.getByRole('img', { name: 'Cover' })) // CDN fails too

    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })

  it('falls back to the CDN url when the Pi image times out', async () => {
    vi.useFakeTimers()
    await enableRemoteBlur()
    const { unmount } = render(<AlbumArt src={CDN} alt="Cover" size={100} />)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', remoteArtUrl(CDN))

    // CR69: the timeout is a plain setTimeout (no AbortSignal.timeout)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_ART_TIMEOUT_MS)
    })
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', CDN)
    unmount()
    vi.useRealTimers()
  })

  it('switches to the Pi url when the mode flips while mounted', async () => {
    render(<AlbumArt src={CDN} alt="Cover" size={100} />)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', CDN)

    // settle the mount-time check first (standalone via the default handler)
    // so enableRemoteBlur's re-check is a fresh request, not a join of the
    // in-flight one
    await act(async () => {
      await checkMiraServer('192.168.7.1')
    })
    await enableRemoteBlur()
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', remoteArtUrl(CDN))
  })
})
