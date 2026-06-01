import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Controls } from '../Controls'

// presentational only, optimistic + double-tap logic lives in usePlayerControls
function defaultProps() {
  return {
    isPaused: true,
    shuffle: false,
    repeat: 'off' as const,
    disallowPrev: false,
    disallowNext: false,
    onPrev: vi.fn(),
    onPlayPause: vi.fn(),
    onNext: vi.fn(),
    onMore: vi.fn(),
    onToggleShuffle: vi.fn(),
    onCycleRepeat: vi.fn(),
  }
}

describe('Controls', () => {
  it('renders the play icon when paused, swaps to pause when playing', () => {
    const { rerender } = render(<Controls {...defaultProps()} isPaused={true} />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()

    rerender(<Controls {...defaultProps()} isPaused={false} />)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  it('routes each button click to its matching callback exactly once', () => {
    const props = defaultProps()
    render(<Controls {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(props.onToggleShuffle).toHaveBeenCalledTimes(1)
    expect(props.onPrev).toHaveBeenCalledTimes(1)
    expect(props.onPlayPause).toHaveBeenCalledTimes(1)
    expect(props.onNext).toHaveBeenCalledTimes(1)
    expect(props.onCycleRepeat).toHaveBeenCalledTimes(1)
    expect(props.onMore).toHaveBeenCalledTimes(1)
  })

  it('disables and swallows clicks on prev when disallowPrev is true', () => {
    const props = defaultProps()
    render(<Controls {...props} disallowPrev={true} />)

    const prev = screen.getByRole('button', { name: 'Previous' })
    expect(prev).toBeDisabled()
    expect(prev).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(prev)
    expect(props.onPrev).not.toHaveBeenCalled()
  })

  it('disables and swallows clicks on next when disallowNext is true', () => {
    const props = defaultProps()
    render(<Controls {...props} disallowNext={true} />)

    const nextBtn = screen.getByRole('button', { name: 'Next' })
    expect(nextBtn).toBeDisabled()
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(nextBtn)
    expect(props.onNext).not.toHaveBeenCalled()
  })

  it('renders the "1" badge only when repeat === "track"', () => {
    const { rerender } = render(<Controls {...defaultProps()} repeat="off" />)
    expect(screen.queryByText('1')).toBeNull()

    rerender(<Controls {...defaultProps()} repeat="context" />)
    expect(screen.queryByText('1')).toBeNull()

    rerender(<Controls {...defaultProps()} repeat="track" />)
    expect(screen.getByText('1')).toBeInTheDocument()
    const repeatBtn = screen.getByRole('button', { name: 'Repeat track' })
    expect(repeatBtn).toContainElement(screen.getByText('1'))
  })
})
