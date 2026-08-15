// Module-level callback stack for list focus priority over volume controls

export interface ListFocusEntry {
  onWheel: (e: WheelEvent) => void
  onConfirm: (() => void) | null
  active: boolean
}

const noopEntry: ListFocusEntry = { onWheel: () => {}, onConfirm: null, active: false }

let currentEntry: ListFocusEntry = noopEntry

export const ListFocusContext: {
  entry: ListFocusEntry
  setActive: (entry: ListFocusEntry | null) => void
} = {
  get entry() { return currentEntry },
  setActive(entry: ListFocusEntry | null) {
    currentEntry = entry ?? noopEntry
  },
}

export function useListFocusCtx() {
  return ListFocusContext
}
