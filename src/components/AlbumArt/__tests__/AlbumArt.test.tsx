import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AlbumArt } from '../AlbumArt'

describe('AlbumArt', () => {
  it('renders an img for a valid source', () => {
    render(<AlbumArt src="http://img/a.jpg" alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toHaveAttribute('src', 'http://img/a.jpg')
  })

  // bug27: a missing src shows the music-note placeholder immediately — never
  // an <img> with an empty src (which would leave a pure black box)
  it('renders the music-note placeholder when no source is given', () => {
    const { container } = render(<AlbumArt src={undefined} alt="" size={100} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })

  it('renders the music-note placeholder for an empty src string (bug27)', () => {
    const { container } = render(<AlbumArt src="" alt="Cover" size={100} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })

  it('shows the music-note placeholder when the image fails to load (bug15)', () => {
    const { container } = render(<AlbumArt src="http://img/broken.jpg" alt="Cover" size={100} />)
    const img = screen.getByRole('img', { name: 'Cover' })
    expect(img).toBeInTheDocument()

    // a failed load swaps the broken img for the music-note fallback (no black box)
    fireEvent.error(img)

    expect(screen.queryByRole('img', { name: 'Cover' })).not.toBeInTheDocument()
    expect(container.querySelector('.placeholder svg')).toBeInTheDocument()
  })
})
