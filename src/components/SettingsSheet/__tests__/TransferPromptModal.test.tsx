import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { TransferPromptModal } from '../TransferPromptModal'
import { ListFocusContext } from '@/navigation/listFocusContext'

// issue #79: the default-device switch prompt. Rows are Yes (0) / No (1);
// focus starts on 'Yes'. The dial/Enter/Escape contract is driven through
// ListFocusContext exactly like the bug31 DefaultDeviceModal tests.

function findRow(text: string) {
  const rows = screen.getAllByRole('button')
  return rows.find((el) => el.textContent === text)
}

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

describe('TransferPromptModal', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('renders the device name, starts with Yes focused, and shows the 10-minute hint', () => {
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('Continue playing on Living Room?')).toBeInTheDocument()
    const focused = document.querySelector('.option.focused')
    expect(focused?.textContent).toBe('Yes')
    expect(screen.getByText(/10 minutes/)).toBeInTheDocument()
  })

  it('confirms the switch with the dial on Yes', () => {
    const onAccept = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={onAccept}
        onDecline={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    dialConfirm()
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('moves to No with the dial and declines', () => {
    const onDecline = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={vi.fn()}
        onDecline={onDecline}
        onCancel={vi.fn()}
      />,
    )

    dialWheel(-10) // down one row: Yes -> No
    const focused = document.querySelector('.option.focused')
    expect(focused?.textContent).toBe('No')

    dialConfirm()
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('the back button closes via cancel and is consumed by the entry', () => {
    const onCancel = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onCancel={onCancel}
      />,
    )

    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
  })

  it('tap on Yes accepts, tap on No declines', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={onAccept}
        onDecline={onDecline}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(findRow('Yes')!)
    expect(onAccept).toHaveBeenCalledTimes(1)
    fireEvent.click(findRow('No')!)
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('backdrop click cancels, clicking inside the card does not', () => {
    const onCancel = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('Continue playing on Living Room?'))
    expect(onCancel).not.toHaveBeenCalled()

    const backdrop = document.querySelector('.backdrop')!
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('the close button cancels', () => {
    const onCancel = vi.fn()
    render(
      <TransferPromptModal
        deviceName="Living Room"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
