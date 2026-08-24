import { afterEach, describe, expect, it } from 'vitest'
import { ListFocusContext } from '../listFocusContext'
import type { ListFocusEntry } from '../listFocusContext'

// bug31: the list focus context is a stack so a modal overlay can sit on top
// of the view's entry (wheel/Enter/Escape route to the top) and the view's
// entry regains the hardware buttons when the modal unmounts

function makeEntry(): ListFocusEntry {
  return { onWheel: () => {}, onConfirm: null, onBack: () => true, active: true }
}

describe('ListFocusContext stack (bug31)', () => {
  afterEach(() => {
    ListFocusContext.setActive(null)
  })

  it('exposes an inactive noop entry while the stack is empty', () => {
    ListFocusContext.setActive(null)
    expect(ListFocusContext.entry.active).toBe(false)
    expect(ListFocusContext.entry.onConfirm).toBeNull()
  })

  it('setActive replaces the whole stack and null clears it', () => {
    const a = makeEntry()
    ListFocusContext.setActive(a)
    expect(ListFocusContext.entry).toBe(a)

    ListFocusContext.setActive(null)
    expect(ListFocusContext.entry.active).toBe(false)
  })

  it('pushEntry puts the entry on top of the stack, pop restores the previous top', () => {
    const parent = makeEntry()
    const overlay = makeEntry()
    ListFocusContext.setActive(parent)

    const pop = ListFocusContext.pushEntry(overlay)
    expect(ListFocusContext.entry).toBe(overlay)

    pop()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('pops multiple overlays in LIFO order', () => {
    const a = makeEntry()
    const b = makeEntry()
    const c = makeEntry()
    const popA = ListFocusContext.pushEntry(a)
    const popB = ListFocusContext.pushEntry(b)
    const popC = ListFocusContext.pushEntry(c)

    expect(ListFocusContext.entry).toBe(c)
    popC()
    expect(ListFocusContext.entry).toBe(b)
    popB()
    expect(ListFocusContext.entry).toBe(a)
    popA()
    expect(ListFocusContext.entry.active).toBe(false)
  })

  it('removes exactly the pushed entry, leaving other entries in place', () => {
    const a = makeEntry()
    const b = makeEntry()
    const c = makeEntry()
    const popA = ListFocusContext.pushEntry(a)
    const popB = ListFocusContext.pushEntry(b)
    const popC = ListFocusContext.pushEntry(c)

    popA() // a unmounts while b and c are still open
    expect(ListFocusContext.entry).toBe(c)
    popB()
    expect(ListFocusContext.entry).toBe(c)
    popC()
    expect(ListFocusContext.entry.active).toBe(false)
  })

  it('a repeated cleanup is a no-op', () => {
    const a = makeEntry()
    const b = makeEntry()
    const popA = ListFocusContext.pushEntry(a)
    const popB = ListFocusContext.pushEntry(b)

    popA()
    popA() // second call must not remove b
    expect(ListFocusContext.entry).toBe(b)
    popB()
    expect(ListFocusContext.entry.active).toBe(false)
  })

  it('a cleanup after the stack was reset is a no-op', () => {
    const a = makeEntry()
    const popA = ListFocusContext.pushEntry(a)
    const b = makeEntry()
    ListFocusContext.setActive(b)

    popA() // a is no longer in the stack
    expect(ListFocusContext.entry).toBe(b)
  })

  it('setActive after pushes replaces the whole stack', () => {
    const a = makeEntry()
    const popA = ListFocusContext.pushEntry(a)
    const b = makeEntry()
    ListFocusContext.setActive(b)
    expect(ListFocusContext.entry).toBe(b)

    popA() // stale cleanup, a was already replaced
    expect(ListFocusContext.entry).toBe(b)
  })
})
