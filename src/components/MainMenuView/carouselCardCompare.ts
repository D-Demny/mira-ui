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
  // bug59: registers THIS card's element in the parent's per-index registry
  // (the live-blur rAF loop blurs/deblurs DOM nodes by index). ONE stable
  // parent callback — `index` comes from the child's own prop, so there are
  // no per-index closures to cache/keep. Deliberately NOT compared by the
  // memo comparator below (a flip of it must never force a re-render; the
  // loop owns the classes while it runs)
  registerCardEl?: (index: number, el: HTMLElement | null) => void
  // bug59b (A): the settle-handoff epoch — bumped once per handoff by the
  // parent. A flip forces EVERY mounted card to re-render in that ONE
  // handoff commit, so React's canonical classNames (the render-derived
  // target set) are committed atomically with the liveBlur flip instead of
  // one frame apart (Bug59b). Compared by the memo comparator below; never
  // read by the card body (plumbing only — like registerCardEl, a prop the
  // child receives but never touches)
  blurEpoch?: number
}

// bug8.2: a card re-renders only when its focus state or its data changes, so a
// dial tick re-renders exactly the previously and the newly focused card.
// bug58 T3: a flip of `blurred` (the card crossed the sidebar edge under the
// glass) also forces a re-render — that is the only per-tick work this feature
// adds, and it must land in the same commit as the dial scroll write.
// bug59b (A): a flip of `blurEpoch` (a settle handoff) re-renders EVERY card
// once — the canonical className rewrite that makes React's target set the
// authoritative DOM state in the one handoff commit (stale-blur guard). It is
// stable on every dial tick, so the bug8.2 per-tick churn stays untouched.
// Lives in a plain (non-component) module so ContentCarousel.tsx keeps
// exporting components only (react-refresh).
export function carouselCardAreEqual(prev: CarouselCardProps, next: CarouselCardProps): boolean {
  return (
    prev.isFocused === next.isFocused &&
    prev.blurred === next.blurred &&
    prev.card === next.card &&
    prev.interactive === next.interactive &&
    prev.blurEpoch === next.blurEpoch
  )
}
