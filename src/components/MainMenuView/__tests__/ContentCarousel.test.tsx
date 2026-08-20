import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainMenuView } from '../MainMenuView'
import { MENU_CATEGORIES } from '../mockData'

describe('ContentCarousel', () => {
  it('renders one card per entry of the active category', () => {
    const { container } = render(<MainMenuView />)
    const home = MENU_CATEGORIES.find((c) => c.id === 'home')!
    expect(container.querySelectorAll('.card')).toHaveLength(home.cards.length)
  })

  it('shows title and subtitle for every card', () => {
    render(<MainMenuView />)
    const home = MENU_CATEGORIES.find((c) => c.id === 'home')!
    for (const card of home.cards) {
      expect(screen.getByText(card.title)).toBeInTheDocument()
      expect(screen.getAllByText(card.subtitle).length).toBeGreaterThan(0)
    }
  })

  it('shows square album artwork for every card that has art', () => {
    render(<MainMenuView />)
    const home = MENU_CATEGORIES.find((c) => c.id === 'home')!
    const withArt = home.cards.filter((c) => c.art !== undefined)
    expect(screen.getAllByRole('img')).toHaveLength(withArt.length)
    for (const card of withArt) {
      expect(screen.getByRole('img', { name: card.title })).toBeInTheDocument()
    }
  })

  it('swaps the cards when another category is selected in the sidebar', () => {
    render(<MainMenuView />)
    expect(screen.getByText('Guten Morgen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }))
    expect(screen.getByText('Road Trip')).toBeInTheDocument()
    expect(screen.queryByText('Guten Morgen')).not.toBeInTheDocument()
  })
})
