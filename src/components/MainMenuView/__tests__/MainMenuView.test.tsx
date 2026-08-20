import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainMenuView } from '../MainMenuView'
import { MENU_CATEGORIES } from '../mockData'

describe('MainMenuView', () => {
  it('renders the split-screen shell with sidebar and content panes', () => {
    render(<MainMenuView />)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('renders every sidebar category label', () => {
    render(<MainMenuView />)
    for (const category of MENU_CATEGORIES) {
      expect(screen.getByRole('button', { name: category.label })).toBeInTheDocument()
    }
  })

  it('marks the active item with aria-current and a white pill', () => {
    const { container } = render(<MainMenuView />)
    const home = screen.getByRole('button', { name: 'Home' })
    expect(home).toHaveAttribute('aria-current', 'true')
    expect(container.querySelector('.pill')).not.toBeNull()
    const playlists = screen.getByRole('button', { name: 'Playlists' })
    expect(playlists).not.toHaveAttribute('aria-current')
  })

  it('moves the active indicator when another category is selected', () => {
    render(<MainMenuView />)
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(screen.getByRole('button', { name: 'Playlists' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })
})
