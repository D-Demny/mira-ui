import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Controls } from '../Controls'

// presentational only, optimistic + double-tap logic lives in usePlayerControls
function defaultProps() {
  return {
    isPaused: true,
    shuffleMode: 'off' as const,
    repeat: 'off' as const,
    disallowPrev: false,
    disallowNext: false,
    onPrev: vi.fn(),
    onPlayPause: vi.fn(),
    onNext: vi.fn(),
    onMore: vi.fn(),
    onCycleShuffle: vi.fn(),
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

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(props.onCycleShuffle).toHaveBeenCalledTimes(1)
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

  it('labels the repeat button by mode (off/context/track)', () => {
    // 'track' renders RepeatOneIcon, others render RepeatIcon the accessible name is the user-facing discriminator
    const { rerender } = render(<Controls {...defaultProps()} repeat="off" />)
    expect(screen.getByRole('button', { name: 'Repeat off' })).toBeInTheDocument()

    rerender(<Controls {...defaultProps()} repeat="context" />)
    expect(screen.getByRole('button', { name: 'Repeat context' })).toBeInTheDocument()

    rerender(<Controls {...defaultProps()} repeat="track" />)
    expect(screen.getByRole('button', { name: 'Repeat track' })).toBeInTheDocument()
  })

  it('labels the shuffle button by state (off/on/smart)', () => {
    const { rerender } = render(<Controls {...defaultProps()} shuffleMode="off" />)
    expect(screen.getByRole('button', { name: 'Shuffle off' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Smart shuffle on' })).toBeNull()

    rerender(<Controls {...defaultProps()} shuffleMode="on" />)
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shuffle off' })).toBeNull()

    rerender(<Controls {...defaultProps()} shuffleMode="smart" />)
    expect(screen.getByRole('button', { name: 'Smart shuffle on' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shuffle on' })).toBeNull()
  })

  it('keeps aria-pressed true for both on-states and false for off', () => {
    const { rerender } = render(<Controls {...defaultProps()} shuffleMode="off" />)
    expect(screen.getByRole('button', { name: 'Shuffle off' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    rerender(<Controls {...defaultProps()} shuffleMode="on" />)
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    rerender(<Controls {...defaultProps()} shuffleMode="smart" />)
    expect(screen.getByRole('button', { name: 'Smart shuffle on' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('applies the active toggle class for both on-states and not for off', () => {
    const { rerender } = render(<Controls {...defaultProps()} shuffleMode="off" />)
    expect(screen.getByRole('button', { name: 'Shuffle off' })).not.toHaveClass('toggleOn')

    rerender(<Controls {...defaultProps()} shuffleMode="on" />)
    expect(screen.getByRole('button', { name: 'Shuffle on' })).toHaveClass('toggleOn')

    rerender(<Controls {...defaultProps()} shuffleMode="smart" />)
    expect(screen.getByRole('button', { name: 'Smart shuffle on' })).toHaveClass('toggleOn')
  })

  it('swaps to the smart-sparkle icon in smart mode, keeping the shared shuffle arc', () => {
    // icons are aria-hidden inline svgs; compare path geometry instead of names
    const plain = render(<Controls {...defaultProps()} shuffleMode="on" />)
    const smart = render(<Controls {...defaultProps()} shuffleMode="smart" />)

    const pathDs = (container: HTMLElement, label: string) =>
      Array.from(container.querySelectorAll(`button[aria-label="${label}"] svg path`)).map((p) =>
        p.getAttribute('d'),
      )

    const plainPaths = pathDs(plain.container, 'Shuffle on')
    const smartPaths = pathDs(smart.container, 'Smart shuffle on')

    expect(plainPaths).toHaveLength(2)
    expect(smartPaths).toHaveLength(2)
    // first shape differs (arrows vs sparkle), both keep the shared shuffle arc
    expect(smartPaths[0]).not.toBe(plainPaths[0])
    expect(smartPaths[1]).toBe(plainPaths[1])
  })
})
