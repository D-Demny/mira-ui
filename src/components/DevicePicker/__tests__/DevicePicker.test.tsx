import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DevicePicker } from '../DevicePicker'
import type { ConnectDevice } from '@/api/types'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ListFocusEntry } from '@/navigation/listFocusContext'

const makeDevice = (overrides: Partial<ConnectDevice> = {}): ConnectDevice => ({
  id: 'dev-001',
  name: 'Living Room',
  type: 'SMARTPHONE',
  volume: 40,
  volume_steps: 100,
  volume_disabled: false,
  is_active: false,
  is_offline: false,
  can_transfer: true,
  ...overrides,
})

const devices: ConnectDevice[] = [
  makeDevice({ id: 'dev-001', name: 'Living Room' }),
  makeDevice({ id: 'dev-002', name: 'MacBook', type: 'COMPUTER', is_active: true }),
  makeDevice({ id: 'dev-003', name: 'Old Phone', is_offline: true }),
]

function makeParentEntry(): ListFocusEntry {
  return { onWheel: vi.fn(), onConfirm: null, active: true }
}

// issue #92: the modal placement moved to OutputPicker; only the inline list
// (embedded in the idle screen) is left.
describe('DevicePicker (inline)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('does not register a list focus entry', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)

    render(<DevicePicker devices={devices} onSelect={vi.fn()} />)

    // the sentinel stays on top — the inline box must not grab the dial
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('renders the device names, and the empty text for an empty list', () => {
    const { rerender } = render(<DevicePicker devices={devices} />)
    expect(screen.getByText('Living Room')).toBeInTheDocument()
    expect(screen.getByText('MacBook')).toBeInTheDocument()
    expect(screen.getByText('Old Phone')).toBeInTheDocument()

    // issue #98: the header reads "Spotify abspielen", exactly as written
    expect(screen.getByText('Spotify abspielen')).toBeInTheDocument()

    rerender(<DevicePicker devices={[]} />)
    expect(screen.getByText('No active devices to select from for playback')).toBeInTheDocument()
  })

  it('routes a row click to onSelect, but offline rows are not buttons', () => {
    const onSelect = vi.fn()
    render(<DevicePicker devices={devices} onSelect={onSelect} />)

    // 'Old Phone' is offline → no button role at all
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(2)

    fireEvent.click(rows[0])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(devices[0])
  })
})
