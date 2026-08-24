import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'
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

function makeParentEntry(): ListFocusEntry {
  return { onWheel: vi.fn(), onConfirm: null, active: true }
}

describe('bug31: DevicePicker dial + back', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('the inline placement does not register a list focus entry', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)

    render(<DevicePicker devices={devices} placement="inline" onSelect={vi.fn()} />)

    // the sentinel stays on top — the inline box must not grab the dial
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('the modal placement registers an entry on top of the parent', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)

    render(
      <DevicePicker devices={devices} placement="modal" onSelect={vi.fn()} onClose={vi.fn()} />,
    )

    expect(ListFocusContext.entry).not.toBe(parent)
    expect(ListFocusContext.entry.active).toBe(true)
  })

  it('starts with the active device focused', () => {
    render(
      <DevicePicker devices={devices} placement="modal" onSelect={vi.fn()} onClose={vi.fn()} />,
    )
    const focused = document.querySelector('.row.focused')
    expect(focused).toBeTruthy()
    expect(focused?.textContent).toContain('MacBook')
  })

  it('moves the focus with the dial and confirms the focused device', () => {
    const onSelect = vi.fn()
    render(
      <DevicePicker devices={devices} placement="modal" onSelect={onSelect} onClose={vi.fn()} />,
    )

    // focus starts at 'MacBook' (index 1); turn up to 'Living Room' (index 0)
    dialWheel(10)
    const focused = document.querySelector('.row.focused')
    expect(focused?.textContent).toContain('Living Room')

    dialConfirm()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(devices[0])
  })

  it('turning down confirms a device below the active one', () => {
    const onSelect = vi.fn()
    render(
      <DevicePicker devices={devices} placement="modal" onSelect={onSelect} onClose={vi.fn()} />,
    )

    // focus starts at 'MacBook' (index 1); turn down to 'Old Phone' (index 2)
    dialWheel(-10)
    const focused = document.querySelector('.row.focused')
    expect(focused?.textContent).toContain('Old Phone')

    // offline rows are not selectable, so the confirm is a no-op
    dialConfirm()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('the back button closes the modal and is consumed by the entry', () => {
    const onClose = vi.fn()
    render(
      <DevicePicker devices={devices} placement="modal" onSelect={vi.fn()} onClose={onClose} />,
    )

    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
  })

  it('restores the parent entry after the modal unmounts', () => {
    const parent = makeParentEntry()
    ListFocusContext.setActive(parent)

    const { unmount } = render(
      <DevicePicker devices={devices} placement="modal" onSelect={vi.fn()} onClose={vi.fn()} />,
    )
    expect(ListFocusContext.entry).not.toBe(parent)

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('clamps the focus at the end of the list', () => {
    render(
      <DevicePicker devices={devices} placement="modal" onSelect={vi.fn()} onClose={vi.fn()} />,
    )

    // focus starts at index 1; turn down past the last row (index 2)
    dialWheel(-10) // -> 2
    dialWheel(-10) // clamped at 2
    const focused = document.querySelector('.row.focused')
    expect(focused?.textContent).toContain('Old Phone')
  })
})
