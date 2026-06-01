import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Menu } from '../Menu'
import { server } from '../../../__tests__/msw-server'

beforeEach(() => {
  localStorage.clear()
})

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

  it('renders the Show Lyrics + Reset device rows when open', () => {
    render(<Menu {...baseProps()} />)
    expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
    expect(screen.getByText('Reset device')).toBeInTheDocument()
    expect(screen.queryByText('Reset device?')).toBeNull()
  })

  it('fires onToggleLyrics when the Show Lyrics row is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Show Lyrics'))
    expect(props.onToggleLyrics).toHaveBeenCalledTimes(1)
  })

  it('opens the confirmation dialog when Reset device is clicked (does NOT fire the reset)', async () => {
    // regression for "double-tap destructive action"
    let resetCalls = 0
    server.use(
      http.post('*/system/reset', () => {
        resetCalls++
        return HttpResponse.json({})
      }),
    )

    render(<Menu {...baseProps()} />)
    fireEvent.click(screen.getByText('Reset device'))

    expect(screen.getByText('Reset device?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()

    expect(resetCalls).toBe(0)
  })

  it('returns to the main menu (without firing reset) when Cancel is pressed', async () => {
    let resetCalls = 0
    server.use(
      http.post('*/system/reset', () => {
        resetCalls++
        return HttpResponse.json({})
      }),
    )

    render(<Menu {...baseProps()} />)
    fireEvent.click(screen.getByText('Reset device'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
    expect(screen.queryByText('Reset device?')).toBeNull()
    expect(resetCalls).toBe(0)
  })

  it('clears localStorage and POSTs /system/reset when Reset is confirmed', async () => {
    // localStorage cleared BEFORE the daemon call so it's gone regardless of mid-reboot issues
    localStorage.setItem('thing.bluetooth.lastDevice', 'AA:BB:CC:DD:EE:FF')

    let resetCalls = 0
    server.use(
      http.post('*/system/reset', () => {
        resetCalls++
        return HttpResponse.json({})
      }),
    )

    render(<Menu {...baseProps()} />)
    fireEvent.click(screen.getByText('Reset device'))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(localStorage.getItem('thing.bluetooth.lastDevice')).toBeNull()
    expect(screen.getByRole('button', { name: 'Resetting...' })).toBeDisabled()

    await waitFor(() => expect(resetCalls).toBe(1))
  })

  it('Escape inside the confirm dialog dismisses confirm without calling onClose', () => {
    // first escape backs out of confirm, second escape closes the whole menu
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Reset device'))
    expect(screen.getByText('Reset device?')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByText('Reset device?')).toBeNull()
    expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('resets the confirm dialog state when the menu is closed and reopened', () => {
    const { rerender } = render(<Menu {...baseProps()} />)
    fireEvent.click(screen.getByText('Reset device'))
    expect(screen.getByText('Reset device?')).toBeInTheDocument()

    rerender(<Menu {...baseProps()} open={false} />)
    rerender(<Menu {...baseProps()} open={true} />)

    expect(screen.queryByText('Reset device?')).toBeNull()
    expect(screen.getByText('Show Lyrics')).toBeInTheDocument()
  })
})
