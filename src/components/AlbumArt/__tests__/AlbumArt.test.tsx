import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { REMOTE_ART_TIMEOUT_MS, remoteArtUrl } from '@/api/miraImg'
import { __resetMiraServerState, checkMiraServer } from '@/hooks/useMiraServer'
import { __resetSettings, updateSettings } from '@/settings'
import type { MiraServerCapabilities } from '@/api/miraServer'
import { AlbumArt, RETRY_DELAY_MS } from '../AlbumArt'

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

  // bug15/#50: since the single bounded retry (F2), the placeholder is only
  // permanent once the retry fails too — a first failure blanks the broken
  // img and schedules one re-fetch after RETRY_DELAY_MS
  it('shows the music-note placeholder when the image fails and its single retry fails (bug15/#50 F2)', () => {
    vi.useFakeTimers()
    const { container, unmount } = render(
      <AlbumArt src="http://img/broken.jpg" alt="Cover" size={100} />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Cover' })) // first failure → retry scheduled
    expect(screen.getByRole('img', { name: 'Cover' })).not.toHaveAttribute('src') // broken img blanked
    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS)
    })

    // only the second (retry) failure swaps in the music-note fallback — never a black box
    fireEvent.error(screen.getByRole('img', { name: 'Cover' }))
    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()

    unmount()
    vi.useRealTimers()
  })

  it('retries a failed standalone load exactly once, after RETRY_DELAY_MS (#50 F2)', () => {
    vi.useFakeTimers()
    const { unmount } = render(<AlbumArt src="http://img/broken.jpg" alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    const baseline = vi.getTimerCount()

    // first failure: the broken img is blanked — React drops the src
    // attribute (placeholder shows through) — and exactly one retry is
    // scheduled
    fireEvent.error(img)
    expect(img).not.toHaveAttribute('src')
    expect(vi.getTimerCount()).toBe(baseline + 1)

    // nothing is re-set before the delay has elapsed
    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS - 1)
    })
    expect(img).not.toHaveAttribute('src')

    // after RETRY_DELAY_MS the src is re-set to force a fresh fetch ...
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(img).toHaveAttribute('src', 'http://img/broken.jpg')
    expect(vi.getTimerCount()).toBe(baseline)

    // ... and a successful retry settles with the img visible (no further
    // retry is possible for this mount in any case)
    fireEvent.load(img)
    expect(img).toHaveAttribute('src', 'http://img/broken.jpg')

    unmount()
    vi.useRealTimers()
  })

  it('keeps the placeholder and never retries twice when the retry fails too (#50 F2)', () => {
    vi.useFakeTimers()
    const { container, unmount } = render(
      <AlbumArt src="http://img/broken.jpg" alt="Cover" size={100} />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'Cover' })) // first failure → retry scheduled
    act(() => {
      vi.advanceTimersByTime(RETRY_DELAY_MS)
    })

    // the re-set load fails again: permanent placeholder, no second retry
    fireEvent.error(screen.getByRole('img', { name: 'Cover' }))
    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)

    unmount()
    vi.useRealTimers()
  })

  it('does not touch the retry path on a successful load (#50 F2)', () => {
    vi.useFakeTimers()
    const { unmount } = render(<AlbumArt src="http://img/a.jpg" alt="Cover" size={100} />)

    fireEvent.load(screen.getByRole('img', { name: 'Cover' }))

    // no retry timer was ever scheduled and the img stays as-is
    expect(vi.getTimerCount()).toBe(0)
    expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', 'http://img/a.jpg')

    unmount()
    vi.useRealTimers()
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
        {
          id: 'pi-1',
          label: 'Pi 1',
          ip: '192.168.7.1',
          user: 'root',
          password: '',
          keyInstalled: false,
        },
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
