import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DefaultDeviceRow } from '../DefaultDeviceRow'
import type { ConnectDevice } from '@/api/types'

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
  makeDevice({ id: 'dev-001', name: 'Living Room', type: 'SMARTPHONE' }),
  makeDevice({ id: 'dev-002', name: 'MacBook', type: 'COMPUTER' }),
  makeDevice({ id: 'dev-003', name: 'Phone', type: 'SMARTPHONE', is_offline: true }),
]

const makeActiveDevice = (): ConnectDevice =>
  makeDevice({ id: 'dev-002', name: 'MacBook', type: 'COMPUTER', is_active: true })

const activeDevices: ConnectDevice[] = [
  makeDevice({ id: 'dev-001', name: 'Living Room' }),
  makeActiveDevice(),
  makeDevice({ id: 'dev-003', name: 'Phone', is_offline: true }),
]

describe('DefaultDeviceRow', () => {
  it('renders "None" option by default', () => {
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('button')
    expect(options[0]).toHaveTextContent('None')
  })

  it('shows current default device name in header', () => {
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    const header = screen.getByText(/default device/i)
    expect(header.parentElement?.textContent).toContain('Living Room')
  })

  it('marks offline device with offline indicator', () => {
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('button')
    const phoneOption = options.find((el) => el.textContent?.includes('Phone'))
    expect(phoneOption).toHaveClass('offline')
  })

  it('calls onChange with device id when selecting a device', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
      />,
    )
    const options = screen.getAllByRole('button')
    // skip "None" (index 0), click first device
    fireEvent.click(options[1])
    expect(onChange).toHaveBeenCalledWith('dev-001')
  })

  it('calls onChange with null when clearing default', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
      />,
    )
    const options = screen.getAllByRole('button')
    fireEvent.click(options[0]) // None option
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('calls onTransfer when activating default and music is playing elsewhere', () => {
    const onTransfer = vi.fn()
    render(
      <DefaultDeviceRow
        devices={activeDevices}
        currentDefaultId="dev-001"
        isActiveDevice={true}
        onTransfer={onTransfer}
        onChange={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('button')
    // Living Room is already selected, but let's select it again
    fireEvent.click(options[1])
    // onTransfer should be called because isActiveDevice && currentDefault && !is_active
    expect(onTransfer).toHaveBeenCalled()
  })

  it('highlights selected device', () => {
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId="dev-002"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('button')
    const macbookOption = options.find((el) => el.textContent?.includes('MacBook'))
    expect(macbookOption).toHaveClass('selected')
  })

  it('does not call onTransfer when music is not active', () => {
    const onTransfer = vi.fn()
    render(
      <DefaultDeviceRow
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={onTransfer}
        onChange={vi.fn()}
      />,
    )
    const options = screen.getAllByRole('button')
    fireEvent.click(options[1]) // Living Room (already selected)
    expect(onTransfer).not.toHaveBeenCalled()
  })
})
