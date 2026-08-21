import type { MenuCard } from './mockData'

export interface CarouselCardProps {
  card: MenuCard
  index: number
  isFocused: boolean
  interactive: boolean
  onCardTap?: (card: MenuCard, index: number) => void
  // attaches the focused card element to the parent's ref (for scrollIntoView)
  registerRef?: (el: HTMLElement | null) => void
}

// bug8.2: a card re-renders only when its focus state or its data changes, so a
// dial tick re-renders exactly the previously and the newly focused card.
// Lives in a plain (non-component) module so ContentCarousel.tsx keeps
// exporting components only (react-refresh).
export function carouselCardAreEqual(prev: CarouselCardProps, next: CarouselCardProps): boolean {
  return (
    prev.isFocused === next.isFocused &&
    prev.card === next.card &&
    prev.interactive === next.interactive
  )
}
