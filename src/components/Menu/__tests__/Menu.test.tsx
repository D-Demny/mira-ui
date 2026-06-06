import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Menu } from '../Menu'

const baseProps = () => ({
  open: true,
  onClose: vi.fn(),
  showLyrics: true,
  onToggleLyrics: vi.fn(),
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
})
