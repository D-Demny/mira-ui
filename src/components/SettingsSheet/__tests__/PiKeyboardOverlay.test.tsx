import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PiKeyboardOverlay } from '../PiKeyboardOverlay'
import { __resetSettings, getSettings, updateActivePiProfileField } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ListFocusEntry } from '@/navigation/listFocusContext'

// ticket10-2: the on-screen keyboard for the Pi credential fields — dial walk
// with wrap, confirm-inserts-character, backspace/case/space, masked password
// preview, Back closes only the keyboard (consumed by the focus entry)

// the 40 keys in dial order (index: key)
//  0:'1'  1:'2'  2:'3'  3:'4'  4:'5'  5:'6'  6:'7'  7:'8'  8:'9'  9:'0'
// 10:'q' 11:'w' 12:'e' 13:'r' 14:'t' 15:'y' 16:'u' 17:'i' 18:'o' 19:'p'
// 20:'a' 21:'s' 22:'d' 23:'f' 24:'g' 25:'h' 26:'j' 27:'k' 28:'l' 29:⌫
// 30:'z' 31:'x' 32:'c' 33:'v' 34:'b' 35:'n' 36:'m' 37:'.' 38:Aa 39:␣

function wheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({
      deltaX,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent)
  })
}

function turnClockwise(times: number) {
  for (let i = 0; i < times; i++) wheel(-40)
}

function confirmDial() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

function pressBack(): boolean | undefined {
  let consumed: boolean | undefined
  act(() => {
    consumed = ListFocusContext.entry.onBack?.()
  })
  return consumed
}

function focusedKey() {
  return document.querySelector('.key.focused')
}

describe('PiKeyboardOverlay (ticket10-2)', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetSettings()
  })

  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('renders the 40-key grid + OK, the field label, and focuses the first key', () => {
    render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'IP-Adresse' })).toBeInTheDocument()
    // 40 keys + the OK button
    expect(screen.getAllByRole('button')).toHaveLength(41)
    expect(screen.getByRole('button', { name: '1' })).toHaveClass('focused')
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
  })

  it('registers a focus entry on the list focus stack while open (bug31 pattern)', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
    ListFocusContext.setActive(parent)
    const { unmount } = render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)

    expect(ListFocusContext.entry).not.toBe(parent)
    expect(ListFocusContext.entry.active).toBe(true)

    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  describe('dial navigation', () => {
    it('walks the keys clockwise across rows, wrapping at the end (row-based flat walk)', () => {
      render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

      turnClockwise(9) // 1 → 0 (end of the digit row)
      expect(screen.getByRole('button', { name: '0' })).toHaveClass('focused')

      wheel(-40) // row boundary: 0 → q (first key of the next row)
      expect(screen.getByRole('button', { name: 'q' })).toHaveClass('focused')

      turnClockwise(29) // q → ␣ (last key, index 39)
      expect(screen.getByRole('button', { name: '␣' })).toHaveClass('focused')

      wheel(-40) // wraps to the first key
      expect(screen.getByRole('button', { name: '1' })).toHaveClass('focused')
    })

    it('walks counter-clockwise and wraps at the start', () => {
      render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

      wheel(40) // 1 → ␣ (last key)
      expect(screen.getByRole('button', { name: '␣' })).toHaveClass('focused')

      wheel(40) // ␣ → Aa
      expect(screen.getByRole('button', { name: 'Aa' })).toHaveClass('focused')

      wheel(-40) // and back to the last key
      expect(screen.getByRole('button', { name: '␣' })).toHaveClass('focused')
    })
  })

  describe('dial press (confirm) inserts into the active field', () => {
    it('appends the confirmed character to the user field', () => {
      render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)
      // ticket10-5A: without a profile the display shows the default user
      expect(screen.getByText('root')).toBeInTheDocument()

      turnClockwise(20) // → 'a' (index 20)
      confirmDial()

      // the first write lazily creates profile 1 with the entered value
      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].user).toBe('roota')
    })

    it('appends the confirmed character to the ip field', () => {
      render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)
      // without a profile the display shows the default ip
      expect(screen.getByText('192.168.7.1')).toBeInTheDocument()

      turnClockwise(4) // → '5' (index 4)
      confirmDial()

      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].ip).toBe('192.168.7.15')
    })

    it('tapping a key focuses it and inserts (touch path)', () => {
      render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: '7' }))

      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].ip).toBe('192.168.7.17')
      expect(screen.getByRole('button', { name: '7' })).toHaveClass('focused')
    })
  })

  describe('special keys', () => {
    it('⌫ removes the last character of the active field', () => {
      render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)

      turnClockwise(29) // → ⌫ (index 29)
      confirmDial()

      // ticket10-5A: the write creates profile 1 with the shortened value
      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].user).toBe('roo')
    })

    it('⌫ on an empty field is a no-op (no profile is created)', () => {
      render(<PiKeyboardOverlay field="password" onClose={vi.fn()} />)

      turnClockwise(29)
      confirmDial()

      // ticket10-5A: writing the empty default on a fresh store persists nothing
      expect(getSettings().piProfiles).toEqual([])
    })

    it('Aa toggles the case for the following letters', () => {
      render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)

      turnClockwise(38) // → Aa (index 38)
      confirmDial()
      // the letter labels flip to uppercase
      expect(screen.getByRole('button', { name: 'Q' })).toBeInTheDocument()

      // from Aa: 1 → ␣, 1 → (wrap) 1, then 20 → 'a'
      turnClockwise(22)
      expect(screen.getByRole('button', { name: 'A' })).toHaveClass('focused')
      confirmDial()

      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].user).toBe('rootA')
    })

    it('␣ inserts a space', () => {
      render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)

      turnClockwise(39) // → ␣ (index 39)
      confirmDial()

      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].user).toBe('root ')
    })

    it('. inserts the dot (for ip addresses)', () => {
      render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

      turnClockwise(37) // → '.' (index 37)
      confirmDial()

      expect(getSettings().piProfiles).toHaveLength(1)
      expect(getSettings().piProfiles[0].ip).toBe('192.168.7.1.')
    })
  })

  it('keeps the password masked in the preview and routes characters to it', () => {
    updateActivePiProfileField('password', 'secret')
    render(<PiKeyboardOverlay field="password" onClose={vi.fn()} />)

    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '5' }))

    expect(getSettings().piProfiles[0].password).toBe('secret5')
    expect(screen.getByText('•••••••')).toBeInTheDocument()
    expect(screen.queryByText('secret5')).not.toBeInTheDocument()
  })

  it('shows the plain value for the non-secret fields', () => {
    updateActivePiProfileField('user', 'dietpi')
    render(<PiKeyboardOverlay field="user" onClose={vi.fn()} />)

    expect(screen.getByText('dietpi')).toBeInTheDocument()
  })

  it('back closes only the keyboard and the press is consumed (parent entry untouched)', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
    ListFocusContext.setActive(parent)
    const onClose = vi.fn()
    render(<PiKeyboardOverlay field="ip" onClose={onClose} />)

    const consumed = pressBack()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(consumed).toBe(true)
    expect(parent.onBack).not.toHaveBeenCalled()
  })

  it('the OK button and the backdrop close the keyboard; the card swallows its own clicks', () => {
    const onClose = vi.fn()
    render(<PiKeyboardOverlay field="ip" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click inside the card does not close, a click on the backdrop does', () => {
    const onClose = vi.fn()
    render(<PiKeyboardOverlay field="ip" onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog')) // the card swallows its own clicks
    expect(onClose).not.toHaveBeenCalled()

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focused key stays in sync with the walk (ref follows the focus)', () => {
    render(<PiKeyboardOverlay field="ip" onClose={vi.fn()} />)

    turnClockwise(3)

    expect(focusedKey()).toBe(screen.getByRole('button', { name: '4' }))
  })
})
