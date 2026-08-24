import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DefaultDeviceModal } from '../DefaultDeviceModal'
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

function findItemByText(text: string) {
  const items = screen.getAllByRole('button')
  return items.find((el) => el.textContent?.includes(text))
}

describe('DefaultDeviceModal', () => {
  it('renders title and close button', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Default Device')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('renders "None" option', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const noneItem = findItemByText('None')
    expect(noneItem).toBeTruthy()
    expect(noneItem).toHaveTextContent('None')
  })

  it('shows current default device name in header', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Default Device')).toBeInTheDocument()
    const currentName = document.querySelector('.currentName')
    expect(currentName).toHaveTextContent('Living Room')
  })

  it('marks offline device with offline indicator', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const phoneItem = findItemByText('Phone')
    expect(phoneItem).toHaveClass('offline')
  })

  it('calls onChange with device id when selecting a device', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )
    const livingRoomItem = findItemByText('Living Room')!
    fireEvent.click(livingRoomItem)
    expect(onChange).toHaveBeenCalledWith('dev-001')
  })

  it('calls onChange with null when clearing default', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )
    const noneItem = findItemByText('None')!
    fireEvent.click(noneItem)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('calls onTransfer when activating default and music is playing elsewhere', () => {
    const onTransfer = vi.fn()
    render(
      <DefaultDeviceModal
        devices={activeDevices}
        currentDefaultId="dev-001"
        isActiveDevice={true}
        onTransfer={onTransfer}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const livingRoomItem = findItemByText('Living Room')!
    fireEvent.click(livingRoomItem)
    expect(onTransfer).toHaveBeenCalled()
  })

  it('highlights selected device', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-002"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const macbookItem = findItemByText('MacBook')!
    expect(macbookItem).toHaveClass('selected')
  })

  it('does not call onTransfer when music is not active', () => {
    const onTransfer = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={onTransfer}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const livingRoomItem = findItemByText('Living Room')!
    fireEvent.click(livingRoomItem)
    expect(onTransfer).not.toHaveBeenCalled()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )
    const backdrop = document.querySelector('.backdrop') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close when clicking inside the card', () => {
    const onClose = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )
    const card = document.querySelector('.card') as HTMLElement
    fireEvent.click(card)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows active tag when default device is active', () => {
    render(
      <DefaultDeviceModal
        devices={activeDevices}
        currentDefaultId="dev-002"
        isActiveDevice={true}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows transfer button when default is set and not active', () => {
    render(
      <DefaultDeviceModal
        devices={activeDevices}
        currentDefaultId="dev-001"
        isActiveDevice={true}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/Play on Living Room/)).toBeInTheDocument()
  })
})

describe('bug31: DefaultDeviceModal dial + back', () => {
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

  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('starts with the current default device focused', () => {
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-002"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const focused = document.querySelector('.option.focused')
    expect(focused).toBeTruthy()
    expect(focused?.textContent).toContain('MacBook')
  })

  it('moves the focus with the dial and confirms the focused device', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    // focus starts at 'None' (index 0); turn down to 'Living Room' (index 1)
    dialWheel(-10)
    const focused = document.querySelector('.option.focused')
    expect(focused?.textContent).toContain('Living Room')

    dialConfirm()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('dev-001')
  })

  it('confirms None via the dial', () => {
    const onChange = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId="dev-001"
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    // focus starts at the current default 'Living Room' (index 1); turn up to 'None'
    dialWheel(10)
    const focused = document.querySelector('.option.focused')
    expect(focused?.textContent).toContain('None')

    dialConfirm()
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('the back button closes the modal and is consumed by the entry', () => {
    const onClose = vi.fn()
    render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )

    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
  })

  it('restores the parent entry after the modal unmounts', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, active: true }
    ListFocusContext.setActive(parent)

    const { unmount } = render(
      <DefaultDeviceModal
        devices={devices}
        currentDefaultId={null}
        isActiveDevice={false}
        onTransfer={vi.fn()}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(ListFocusContext.entry).not.toBe(parent)

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })
})
