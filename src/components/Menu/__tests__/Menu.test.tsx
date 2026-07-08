import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Menu } from '../Menu'

const baseProps = () => ({
  open: true,
  onClose: vi.fn(),
  showLyrics: true,
  onToggleLyrics: vi.fn(),
  karaokeLyrics: true,
  onToggleKaraoke: vi.fn(),
  voiceMic: true,
  onToggleVoiceMic: vi.fn(),
  onOpenDevices: vi.fn(),
  onOpenBluetooth: vi.fn(),
  onOpenSettings: vi.fn(),
})

describe('Menu', () => {
  it('hides the dialog from assistive tech when open=false', () => {
    const { container } = render(<Menu {...baseProps()} open={false} />)
    const root = container.firstElementChild
    expect(root).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the Show Lyrics row when open, and no longer the reset row', () => {
    render(<Menu {...baseProps()} />)
    expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
    expect(screen.queryByText('Reset device')).toBeNull()
  })

  it('fires onToggleLyrics when the Show Lyrics row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Show Lyrics'))
    expect(props.onToggleLyrics).toHaveBeenCalledTimes(1)
  })

  it('fires onToggleKaraoke when the Karaoke Lyrics row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Karaoke Lyrics'))
    expect(props.onToggleKaraoke).toHaveBeenCalledTimes(1)
  })

  it('fires onToggleVoiceMic when the Mic row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Mic'))
    expect(props.onToggleVoiceMic).toHaveBeenCalledTimes(1)
  })

  it('fires onOpenSettings when the Settings row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Settings'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('fires onOpenBluetooth when the Bluetooth Pairing row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Bluetooth Pairing'))
    expect(props.onOpenBluetooth).toHaveBeenCalledTimes(1)
  })
})
