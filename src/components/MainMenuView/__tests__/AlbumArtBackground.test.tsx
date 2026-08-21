import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { AlbumArtBackground } from '../AlbumArtBackground'

describe('AlbumArtBackground', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders no image while there is no artwork', () => {
    const { container } = render(<AlbumArtBackground />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('shows the artwork immediately on mount', () => {
    const { container } = render(<AlbumArtBackground art="http://img/a.jpg" />)
    const shown = container.querySelector('.albumBg .show img')
    expect(shown).not.toBeNull()
    expect(shown).toHaveAttribute('src', 'http://img/a.jpg')
  })

  it('crossfades to the new artwork and removes the old layer after the fade', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<AlbumArtBackground art="http://img/a.jpg" />)

    rerender(<AlbumArtBackground art="http://img/b.jpg" />)

    const shown = container.querySelector('.albumBg .show img')
    expect(shown).toHaveAttribute('src', 'http://img/b.jpg')
    // old layer is still fading out during the transition
    expect(container.querySelectorAll('img')).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('clears the pending layer when the artwork goes away', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<AlbumArtBackground art="http://img/a.jpg" />)

    rerender(<AlbumArtBackground art={undefined} />)

    const shown = container.querySelector('.albumBg .show')
    expect(shown).not.toBeNull()
    expect(shown?.querySelectorAll('img')).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
