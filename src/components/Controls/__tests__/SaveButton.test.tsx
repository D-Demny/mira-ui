import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SaveButton } from '../SaveButton'

describe('SaveButton', () => {
  it('labels itself by state and reflects aria-pressed', () => {
    const { rerender } = render(<SaveButton saved={false} />)
    const add = screen.getByRole('button', { name: 'Add to Liked Songs' })
    expect(add).toHaveAttribute('aria-pressed', 'false')

    rerender(<SaveButton saved={true} />)
    const remove = screen.getByRole('button', { name: 'Remove from Liked Songs' })
    expect(remove).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onToggle on click', () => {
    const onToggle = vi.fn()
    render(<SaveButton saved={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to Liked Songs' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
