import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { OutputPicker } from '../OutputPicker'
import type { ConnectDevice } from '@/api/types'
import { ListFocusContext } from '@/navigation/listFocusContext'

const makeDevice = (overrides: Partial<ConnectDevice> = {}): ConnectDevice => ({
  id: 'dev-001',
  name: 'WiiM Amp Wohnzimmer',
  type: 'OTHER',
  volume: 40,
  volume_steps: 100,
  volume_disabled: false,
  is_active: false,
  is_offline: false,
  can_transfer: true,
  ...overrides,
})

const devices: ConnectDevice[] = [
  makeDevice({ id: 'dev-001', name: 'WiiM Amp Wohnzimmer', is_active: true }),
  makeDevice({ id: 'dev-002', name: 'MacBook Air', type: 'COMPUTER' }),
  makeDevice({ id: 'dev-003', name: 'Old Phone', type: 'SMARTPHONE', is_offline: true }),
]

function dialWheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({
      deltaX,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent)
  })
}

function dialConfirm() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

const props = () => ({
  devices,
  currentDefaultId: 'dev-002',
  onSelect: vi.fn(),
  onSetDefault: vi.fn(),
  onClose: vi.fn(),
})

describe('issue #92: OutputPicker (Ausgabegeräte)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('renders the title, device names and the active row with an "Aktiv" subtitle', () => {
    render(<OutputPicker {...props()} />)

    expect(screen.getByText('Ausgabegeräte')).toBeInTheDocument()
    for (const d of devices) expect(screen.getByText(d.name)).toBeInTheDocument()

    const activeRow = screen.getByText('WiiM Amp Wohnzimmer').closest('.activeRow')
    expect(activeRow).toBeTruthy()
    // the subtitle is in the same row container as the name
    const row = screen.getByText('WiiM Amp Wohnzimmer').parentElement!.parentElement!
    expect(row.textContent).toContain('Aktiv')
  })

  it('marks the default device with a filled star and label; others get an outline star', () => {
    render(<OutputPicker {...props()} />)

    // dev-002 is the Standard-Gerät
    expect(screen.getByRole('button', { name: 'Standard-Gerät: MacBook Air' })).toBeInTheDocument()
    expect(screen.getByText('Standard-Gerät')).toBeInTheDocument()

    // the non-default rows only get the "set as default" star
    expect(
      screen.getByRole('button', { name: 'WiiM Amp Wohnzimmer als Standard-Gerät festlegen' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('WiiM Amp WohnzimmerStandard-Gerät')).not.toBeInTheDocument()
  })

  it('a row tap transfers (onSelect) and does not touch the default', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    fireEvent.click(screen.getByText('MacBook Air'))

    expect(p.onSelect).toHaveBeenCalledTimes(1)
    expect(p.onSelect).toHaveBeenCalledWith(devices[1])
    expect(p.onSetDefault).not.toHaveBeenCalled()
  })

  it('a star tap only persists the default (no transfer, no close)', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'WiiM Amp Wohnzimmer als Standard-Gerät festlegen' }),
    )

    expect(p.onSetDefault).toHaveBeenCalledTimes(1)
    expect(p.onSetDefault).toHaveBeenCalledWith('dev-001')
    expect(p.onSelect).not.toHaveBeenCalled()
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('the close button closes the modal', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('starts with the active device focused; dial + confirm transfer to the focused row', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    // focus starts on 'WiiM Amp Wohnzimmer' (index 0); turn down to 'MacBook Air'
    dialWheel(-10)
    const focused = document.querySelector('.row.focused')
    expect(focused?.textContent).toContain('MacBook Air')

    dialConfirm()
    expect(p.onSelect).toHaveBeenCalledTimes(1)
    expect(p.onSelect).toHaveBeenCalledWith(devices[1])
  })

  it('issue #127: confirming an offline-but-transferable row still transfers', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    // focus 0 → turn down twice to 'Old Phone' (offline, index 2) — it is
    // transferable (can_transfer: true), so confirm must select it
    dialWheel(-10)
    dialWheel(-10)
    dialConfirm()
    expect(p.onSelect).toHaveBeenCalledTimes(1)
    expect(p.onSelect).toHaveBeenCalledWith(devices[2])
  })

  it('the back button closes the modal and is consumed by the entry', () => {
    const p = props()
    render(<OutputPicker {...p} />)

    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })

    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
  })

  it('shows the empty state for no devices', () => {
    const p = props()
    render(<OutputPicker {...p} devices={[]} />)

    expect(screen.getByText('Keine Audioausgaben verfügbar')).toBeInTheDocument()
    expect(p.onClose).not.toHaveBeenCalled()
  })
})
