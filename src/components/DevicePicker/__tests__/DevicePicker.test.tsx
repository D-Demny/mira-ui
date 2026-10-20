import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DevicePicker } from '../DevicePicker'
import type { ConnectDevice, MaDevice } from '@/api/types'
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
  // issue #127: offline but transferable — idle speakers from the merged
  // account-wide list must stay selectable (tapping re-registers them)
  makeDevice({ id: 'dev-003', name: 'Old Phone', is_offline: true }),
  makeDevice({ id: 'dev-004', name: 'Blocked Box', can_transfer: false }),
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

  it('routes row clicks to onSelect; offline-but-transferable rows stay tappable (issue #127)', () => {
    const onSelect = vi.fn()
    render(<DevicePicker devices={devices} onSelect={onSelect} />)

    // 'Blocked Box' (can_transfer: false) gets no button role; the offline
    // 'Old Phone' does — interactivity follows can_transfer, not is_offline
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Old Phone' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(devices[2])
  })
})

// issue #134: the Music Assistant variant (source='ma') — same row anatomy as
// the spotify list above; interactivity follows `available` exactly like
// `can_transfer`, and the header/empty copy switches with the source
describe('DevicePicker (MA source, issue #134)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  const maDevices: MaDevice[] = [
    { id: 'ma-001', name: 'Stereoanlage', available: true },
    { id: 'ma-002', name: 'Kitchen Speaker', available: false },
    { id: 'ma-003', name: 'Beamer', available: true },
  ]

  it('renders the MA player names under the MA header (the spotify list is ignored)', () => {
    render(<DevicePicker devices={devices} source="ma" maDevices={maDevices} />)
    expect(screen.getByText('Music Assistant abspielen')).toBeInTheDocument()
    expect(screen.queryByText('Spotify abspielen')).not.toBeInTheDocument()
    expect(screen.getByText('Stereoanlage')).toBeInTheDocument()
    expect(screen.getByText('Kitchen Speaker')).toBeInTheDocument()
    expect(screen.getByText('Beamer')).toBeInTheDocument()
    // the spotify rows are not rendered in ma mode
    expect(screen.queryByText('Living Room')).not.toBeInTheDocument()
  })

  it('shows the MA empty text for an empty player list', () => {
    render(<DevicePicker devices={devices} source="ma" maDevices={[]} />)
    expect(screen.getByText('Keine verfügbaren Wiedergabegeräte')).toBeInTheDocument()
  })

  it('routes row clicks to onMaSelect; unavailable rows get no button role', () => {
    const onMaSelect = vi.fn()
    render(
      <DevicePicker devices={devices} source="ma" maDevices={maDevices} onMaSelect={onMaSelect} />,
    )
    // only the two available players are interactive — 'Kitchen Speaker'
    // (available: false) gets no role, same convention as can_transfer above
    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Stereoanlage' }))
    expect(onMaSelect).toHaveBeenCalledTimes(1)
    expect(onMaSelect).toHaveBeenCalledWith(maDevices[0])
  })
})
