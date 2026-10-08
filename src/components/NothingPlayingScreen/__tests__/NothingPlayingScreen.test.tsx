import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NothingPlayingScreen } from '../NothingPlayingScreen'
import type { ConnectDevice } from '@/api/types'

const DEVICES: ConnectDevice[] = [
  {
    id: 'dev-1',
    name: 'Office PC',
    type: 'source',
    volume: 60,
    volume_steps: 16,
    volume_disabled: false,
    is_active: true,
    is_offline: false,
    can_transfer: true,
  },
]

// issue #100: the pre-#95 idle screen restored for the 'Idle Screen
// aktivieren' OFF state — plain markup and copy, no scene zone
describe('NothingPlayingScreen (issue #100)', () => {
  it('shows the "Nothing playing" title with the select-a-device hint', () => {
    render(<NothingPlayingScreen connected devices={DEVICES} />)

    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    // two-variant subtitle: devices available → prompt to pick one
    expect(screen.getByText(/Select one below/)).toBeInTheDocument()
    // the full-width (non-compact) device picker carries the renamed header
    expect(screen.getByText('Spotify abspielen')).toBeInTheDocument()
    expect(screen.getByText('Office PC')).toBeInTheDocument()
  })

  it('swaps to the open-Spotify hint when no devices are listed', () => {
    render(<NothingPlayingScreen connected devices={[]} />)

    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    expect(screen.getByText(/Open Spotify on your phone to control it here/)).toBeInTheDocument()
  })

  it('shows the reconnecting status only when disconnected', () => {
    const { rerender } = render(<NothingPlayingScreen connected devices={DEVICES} />)
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()

    rerender(<NothingPlayingScreen connected={false} devices={DEVICES} />)
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
  })

  it('respects defaultDeviceId (only the pinned device is listed)', () => {
    const others: ConnectDevice[] = [
      ...DEVICES,
      {
        id: 'dev-2',
        name: 'Büro Speaker',
        type: 'sink',
        volume: 50,
        volume_steps: 16,
        volume_disabled: false,
        is_active: false,
        is_offline: false,
        can_transfer: true,
      },
    ]
    render(<NothingPlayingScreen connected devices={others} defaultDeviceId="dev-2" />)

    expect(screen.queryByText('Office PC')).not.toBeInTheDocument()
    expect(screen.getByText('Büro Speaker')).toBeInTheDocument()
  })
})
