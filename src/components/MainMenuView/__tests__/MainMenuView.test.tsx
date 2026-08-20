import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MainMenuView } from '../MainMenuView'

describe('MainMenuView', () => {
  it('renders the split-screen shell with sidebar and content panes', () => {
    render(<MainMenuView />)
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
