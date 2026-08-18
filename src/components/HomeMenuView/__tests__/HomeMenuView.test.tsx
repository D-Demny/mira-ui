import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomeMenuView } from '../HomeMenuView'

describe('HomeMenuView', () => {
  it('renders the Home title and placeholder items', () => {
    render(<HomeMenuView />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Light (placeholder)')).toBeInTheDocument()
    expect(screen.getByText('Switch (placeholder)')).toBeInTheDocument()
    expect(screen.getByText('Scene (placeholder)')).toBeInTheDocument()
  })

  it('highlights the first item by default', () => {
    render(<HomeMenuView />)
    const items = screen.getAllByRole('button')
    expect(items[0]).toHaveClass('focused')
    expect(items[1]).not.toHaveClass('focused')
  })

  it('moves focus down on a clockwise dial turn', () => {
    const { container } = render(<HomeMenuView />)
    const list = container.querySelector('ul') as HTMLElement
    fireEvent.wheel(list, { deltaX: -1 })
    const items = screen.getAllByRole('button')
    expect(items[1]).toHaveClass('focused')
    expect(items[0]).not.toHaveClass('focused')
  })

  it('notifies navigation on tap select', () => {
    const onNavigate = vi.fn()
    render(<HomeMenuView onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('Switch (placeholder)'))
    expect(onNavigate).toHaveBeenCalledWith('switch-demo')
  })
})
