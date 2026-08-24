// Module-level callback stack for list focus priority over volume controls.
// The top of the stack (the last pushed entry) receives the hardware dial and
// back button. setActive() replaces the whole stack for views that exclusively
// own the hardware buttons (menu panes, list views); pushEntry() adds a scoped
// overlay entry (bug31: the settings popups) and returns a cleanup that removes
// exactly that entry, restoring the previous top on unmount.

export interface ListFocusEntry {
  onWheel: (e: WheelEvent) => void
  onConfirm: (() => void) | null
  // called for the physical Back button; return true when the press was handled
  onBack?: (() => boolean) | null
  active: boolean
}

const noopEntry: ListFocusEntry = { onWheel: () => {}, onConfirm: null, active: false }

let stack: ListFocusEntry[] = []

export const ListFocusContext: {
  entry: ListFocusEntry
  setActive: (entry: ListFocusEntry | null) => void
  pushEntry: (entry: ListFocusEntry) => () => void
} = {
  // the top of the stack; the noop entry while it is empty
  get entry() {
    return stack.length > 0 ? stack[stack.length - 1] : noopEntry
  },
  setActive(entry: ListFocusEntry | null) {
    stack = entry ? [entry] : []
  },
  pushEntry(entry: ListFocusEntry) {
    stack = [...stack, entry]
    return () => {
      // remove exactly this entry (a newer entry may have been pushed on top
      // since); a stale or repeated cleanup is a no-op
      if (stack.includes(entry)) {
        stack = stack.filter((e) => e !== entry)
      }
    }
  },
}

export function useListFocusCtx() {
  return ListFocusContext
}
