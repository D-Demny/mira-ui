import type { MenuCard } from './mockData'

export interface CarouselCardProps {
  card: MenuCard
  index: number
  isFocused: boolean
  // bug58 T3: the card currently overlaps the sidebar area in the 'blur' menu
  // background mode — it carries the .blurred class (`filter: blur`) while
  // under the glass. The parent recomputes the set arithmetically on every
  // dial tick (sidebarOverlap), so a blur flip must force a re-render,
  // exactly like an isFocused flip (a `filter` added/removed per card is the
  // whole cost of this feature — no layout work in between).
  blurred?: boolean
  interactive: boolean
  onCardTap?: (card: MenuCard, index: number) => void
  // bug53: fired when the card is HELD (pointer down ≥ CARD_HOLD_MS without
  // slop movement). The parent must pass a STABLE callback (the card is
  // memoized and keeps the first closure it receives)
  onCardHold?: (card: MenuCard, index: number) => void
  // attaches the focused card element to the parent's ref (for scrollIntoView)
  registerRef?: (el: HTMLElement | null) => void
}

// bug8.2: a card re-renders only when its focus state or its data changes, so a
// dial tick re-renders exactly the previously and the newly focused card.
// bug58 T3: a flip of `blurred` (the card crossed the sidebar edge under the
// glass) also forces a re-render — that is the only per-tick work this feature
// adds, and it must land in the same commit as the dial scroll write.
// Lives in a plain (non-component) module so ContentCarousel.tsx keeps
// exporting components only (react-refresh).
export function carouselCardAreEqual(prev: CarouselCardProps, next: CarouselCardProps): boolean {
  return (
    prev.isFocused === next.isFocused &&
    prev.blurred === next.blurred &&
    prev.card === next.card &&
    prev.interactive === next.interactive
  )
}
