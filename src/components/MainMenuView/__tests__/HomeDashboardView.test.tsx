// ticket 9.6 (Task B): smoke test for HomeDashboardView — the pure rendering
// contract on top of the homeDashboard.ts view models (Task A): a zone renders
// only when real entities exist for it (issue #48; the light grid always
// renders), unmapped slots carry placeholder markers, data-entity-id is set
// only on real entities, and focusedIndex marks exactly one node.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CARD_HOLD_MS } from '@/hooks/useHardwareButtons'
import { HomeDashboardView } from '../HomeDashboardView'
import type { DashboardEntity } from '../homeDashboard'

function scene(entityId: string, label: string): DashboardEntity {
  return {
    entityId,
    domain: 'scene',
    label,
    state: null,
    active: null,
    dimmable: false,
    brightnessPct: null,
    positionPct: null, // issue #57 (T2): fixtures carry no cover position
  }
}

function light(entityId: string, label: string): DashboardEntity {
  return {
    entityId,
    domain: 'light',
    label,
    state: 'on',
    active: true,
    dimmable: true,
    brightnessPct: 40,
    positionPct: null, // issue #57 (T2): fixtures carry no cover position
  }
}

function cover(entityId: string, label: string): DashboardEntity {
  return {
    entityId,
    domain: 'cover',
    label,
    state: 'closed',
    active: null,
    dimmable: false,
    brightnessPct: null,
    positionPct: null, // issue #57 (T2): fixtures report no position
  }
}

describe('HomeDashboardView (ticket9.6)', () => {
  it('renders only the light grid (placeholder tiles) when nothing is configured (issue #48)', () => {
    const { container } = render(<HomeDashboardView entities={[]} />)
    // no scene row and no cover section at all — only the light grid renders,
    // filled with its 4 placeholder tiles (the always-on zone by design)
    expect(container.querySelector('.sceneRow')).toBeNull()
    expect(container.querySelector('.coverSection')).toBeNull()
    expect(container.querySelectorAll('[data-dashboard-placeholder="true"]').length).toBe(4)
    for (const label of ['Esstisch', 'Flurlicht', 'Stehlampen', 'Treppenspots']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // the scene/cover mock content is gone with the zones
    expect(screen.queryByText('Normales Licht')).not.toBeInTheDocument()
    expect(screen.queryByText('Wohnzimmer und Esszimmer')).not.toBeInTheDocument()
  })

  it('renders real labels and fills the remaining slots with placeholders', () => {
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    // data-entity-id on the 3 real nodes only — placeholders fill the rest
    // (2 scene slots + 2 light tiles = 4 marked; no covers configured → the
    // cover section is suppressed, issue #48)
    expect(container.querySelectorAll('[data-entity-id]').length).toBe(3)
    expect(screen.getByText('Abendstimmung')).toBeInTheDocument()
    expect(container.querySelector('.coverSection')).toBeNull()
    expect(container.querySelectorAll('[data-dashboard-placeholder="true"]').length).toBe(4)
  })

  it('marks exactly one node focused (chain: scenes → lights → covers)', () => {
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    // 3 scene slots + 4 light tiles + 2 cover columns → index 4 = 2nd light tile
    const { container, rerender } = render(
      <HomeDashboardView entities={entities} focusedIndex={4} />,
    )
    const focused = container.querySelectorAll('.focused')
    expect(focused.length).toBe(1)
    expect(focused[0]).toHaveAttribute('data-entity-id', 'light.flurlicht')
    // undefined focusedIndex → nothing focused
    rerender(<HomeDashboardView entities={entities} />)
    expect(container.querySelectorAll('.focused').length).toBe(0)
  })
})

// ticket 9.6 W2-3a: touch hold (pattern ported from ContentCarousel). A held
// press (≥ CARD_HOLD_MS) fires the hold callback once and suppresses the
// short-press that follows it; a press under the threshold stays a plain tap.
describe('HomeDashboardView touch hold (ticket 9.6 W2-3a)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // grab the interactive node for a given entity label (light tile or cover button)
  function nodeFor(container: HTMLElement, selector: string): HTMLElement {
    const el = container.querySelector(selector)
    expect(el).not.toBeNull()
    return el as HTMLElement
  }

  it('dimmable light tile hold fires onLightHold after CARD_HOLD_MS and suppresses the click', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    const entities = [light('light.esstisch_lampe', 'Esstisch Lampe')]
    const { container } = render(
      <HomeDashboardView entities={entities} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.esstisch_lampe"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS - 1) // still inside the hold budget
    expect(onLightHold).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1) // the deadline fires exactly once
    expect(onLightHold).toHaveBeenCalledTimes(1)
    // the LIGHT TILE view model (Task A), not the raw entity
    expect(onLightHold).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'light.esstisch_lampe', dimmable: true }),
    )

    // the click that follows a long press must be suppressed — no short-press tap
    fireEvent.pointerUp(tile)
    fireEvent.click(tile)
    expect(onLightTap).not.toHaveBeenCalled()
  })

  it('non-dimmable light tile fires no hold (short-press stays plain W2-2)', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    // switch-like light: dimmable false → the tile is NOT holdable
    const entity: DashboardEntity = {
      entityId: 'light.trichtspot',
      domain: 'light',
      label: 'Trittspot',
      state: 'on',
      active: true,
      dimmable: false,
      brightnessPct: null,
      positionPct: null, // issue #57 (T2): fixtures carry no cover position
    }
    const { container } = render(
      <HomeDashboardView entities={[entity]} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.trichtspot"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS * 2) // well past the deadline
    expect(onLightHold).not.toHaveBeenCalled()

    // no hold armed → the short-press click still routes to onLightTap
    fireEvent.pointerUp(tile)
    fireEvent.click(tile)
    expect(onLightTap).toHaveBeenCalledTimes(1)
    // the LIGHT TILE view model (Task A), not the raw entity
    expect(onLightTap).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'light.trichtspot', dimmable: false }),
    )
  })

  it('cover button hold fires onCoverHold with the column (both ^ and v)', () => {
    vi.useFakeTimers()
    const onCoverAction = vi.fn()
    const onCoverHold = vi.fn()
    // issue #48: zero covers suppress the whole section — a real cover is
    // needed for any column to hold at all (1 real + 1 placeholder column)
    const { container } = render(
      <HomeDashboardView
        entities={[cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]}
        onCoverAction={onCoverAction}
        onCoverHold={onCoverHold}
      />,
    )
    const upBtn = nodeFor(
      container,
      '[data-entity-id="cover.wohnzimmer_rollo"] [data-cover-action="up"]',
    )

    fireEvent.pointerDown(upBtn)
    vi.advanceTimersByTime(CARD_HOLD_MS) // the deadline fires the column hold
    expect(onCoverHold).toHaveBeenCalledTimes(1)
    // the REAL column model (entityId + label, not a placeholder)
    expect(onCoverHold).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'cover.wohnzimmer_rollo', isPlaceholder: false }),
    )

    // a fired hold suppresses the subsequent ^ short-press on the same press
    fireEvent.pointerUp(upBtn)
    fireEvent.click(upBtn)
    expect(onCoverAction).not.toHaveBeenCalled()
  })

  it('placeholder cover column hold also shows the W2-2 toast', () => {
    vi.useFakeTimers()
    const onCoverHold = vi.fn()
    // one real cover → one real column + one placeholder column ('Esszimmer')
    const { container } = render(
      <HomeDashboardView
        entities={[cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]}
        onCoverHold={onCoverHold}
      />,
    )
    const upBtns = container.querySelectorAll('[data-cover-action="up"]')
    const placeholderUp = upBtns[1] as HTMLElement

    fireEvent.pointerDown(placeholderUp)
    act(() => {
      vi.advanceTimersByTime(CARD_HOLD_MS) // the deadline fires the column hold
    })
    expect(onCoverHold).toHaveBeenCalledTimes(1)
    // W2-3: a placeholder column is a no-op for the parent, so the component
    // reuses the W2-2 toast as the feedback for the hold
    const toast = container.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast).toHaveTextContent('„Esszimmer" ist noch nicht zugewiesen')
  })

  it('short press (under CARD_HOLD_MS) fires the tap only, no hold', () => {
    vi.useFakeTimers()
    const onLightTap = vi.fn()
    const onLightHold = vi.fn()
    const entities = [light('light.esstisch_lampe', 'Esstisch Lampe')]
    const { container } = render(
      <HomeDashboardView entities={entities} onLightTap={onLightTap} onLightHold={onLightHold} />,
    )
    const tile = nodeFor(container, '[data-entity-id="light.esstisch_lampe"]')

    fireEvent.pointerDown(tile)
    vi.advanceTimersByTime(CARD_HOLD_MS - 1) // still inside the hold budget
    fireEvent.pointerUp(tile) // released before the deadline → a short press
    expect(onLightHold).not.toHaveBeenCalled()

    fireEvent.click(tile)
    expect(onLightTap).toHaveBeenCalledTimes(1)
    expect(onLightHold).not.toHaveBeenCalled()
  })
})

// ticket 9.6 W2-4 + issue #45: fine dial navigation — a focused slot outside
// the scroll port's visible area is scrolled into view on every dial tick
// (useLayoutEffect; containment is checked against the .scroller itself, the
// dashboard's own vertical scroll port). jsdom has no geometry, so the
// zero-viewport fallback branch runs: the native scrollIntoView call is made
// unconditionally.
describe('HomeDashboardView fine dial scrolling (ticket 9.6 W2-4, issue #45)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls the focused slot into view when focusedIndex changes', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    // 3 scene slots + 4 light tiles + 2 cover columns → index 4 = 2nd light tile
    const { rerender } = render(<HomeDashboardView entities={entities} focusedIndex={1} />)
    expect(scrollIntoView).toHaveBeenCalled() // the mount focus already scrolled
    scrollIntoView.mockClear()

    rerender(<HomeDashboardView entities={entities} focusedIndex={4} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    })
    // the LIGHT TILE node (light.flurlicht), not a scene or cover slot —
    // `instances` carries the call's `this` (the prototype spy sees no args'
    // receiver, only the options object as an argument)
    const scrolled = scrollIntoView.mock.instances.at(-1) as unknown as HTMLElement | undefined
    expect(scrolled).not.toBeUndefined()
    expect(scrolled).toHaveAttribute('data-entity-id', 'light.flurlicht')
  })

  it('is a no-op for out-of-range or undefined focusedIndex', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const entities = [light('light.esstisch_lampe', 'Esstisch Lampe')]
    // issue #48: 0 scenes / 0 covers → both zones suppressed → 4 total focus
    // stops (1 real + 3 placeholder light tiles), index 0 = the first light
    const { rerender } = render(<HomeDashboardView entities={entities} focusedIndex={0} />)
    expect(scrollIntoView).toHaveBeenCalled() // valid focus at mount
    scrollIntoView.mockClear()

    rerender(<HomeDashboardView entities={entities} focusedIndex={99} />) // out of range
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(<HomeDashboardView entities={entities} />) // undefined → still nothing
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('gives the dashboard its own vertical scroll port around all three zones (issue #45)', () => {
    // issue #48: a zone renders only for its configured entities — give each
    // of the three zones one real entity so all of them are inside the scroller
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo'),
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    // exactly one scroll port — the W2-4 effect's containment target
    expect(container.querySelectorAll('[data-home-scroller="true"]').length).toBe(1)
    const scroller = container.querySelector('[data-home-scroller="true"]') as HTMLElement
    // all three zones render INSIDE the scroller (touch + dial scroll it natively)
    expect(scroller.querySelector('.sceneRow')).not.toBeNull()
    expect(scroller.querySelector('.lightGrid')).not.toBeNull()
    expect(scroller.querySelector('.coverSection')).not.toBeNull()
    // the placeholder toast stays a SIBLING of the scroller — pinned to .root,
    // it never scrolls with the content (pressing a PLACEHOLDER scene slot)
    fireEvent.click(
      scroller.querySelector('.sceneRow [data-dashboard-placeholder="true"]') as HTMLElement,
    )
    const toast = container.querySelector('[role="status"]') as HTMLElement
    expect(toast).not.toBeNull()
    expect(toast.closest('[data-home-scroller="true"]')).toBeNull()
  })

  it('moving focus back UP still nudges scrollIntoView when outside containment (issue #45)', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const entities = [
      scene('scene.abendstimmung', 'Abendstimmung'),
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    // start deep in the chain (index 4 = 2nd light tile), then dial back UP to
    // the scene row — with the dedicated scroller port (issue #45) the upward
    // nudge is as reliable as the downward one; on jsdom's zero geometry this
    // takes the fallback branch, same unconditional native call.
    const { rerender } = render(<HomeDashboardView entities={entities} focusedIndex={4} />)
    scrollIntoView.mockClear()

    rerender(<HomeDashboardView entities={entities} focusedIndex={1} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    })
    // the receiver is a SCENE slot (row index 1), not the light tile we left
    const scrolled = scrollIntoView.mock.instances.at(-1) as unknown as HTMLElement | undefined
    expect(scrolled).not.toBeUndefined()
    expect(scrolled).toHaveClass('sceneBtn')
  })
})

// issue #48: empty-zone suppression — a zone with zero configured entities
// renders NOTHING (no buttons, no header, no columns), and the focus chain
// skips it so the remaining zones shift up.
describe('HomeDashboardView empty-zone suppression (issue #48)', () => {
  it('renders no scene row when zero scenes are configured', () => {
    const { container } = render(
      <HomeDashboardView entities={[light('light.esstisch_lampe', 'Esstisch Lampe')]} />,
    )
    expect(container.querySelector('.sceneRow')).toBeNull()
    // the light grid still renders: 1 real tile + 3 placeholder tiles
    expect(container.querySelectorAll('[data-entity-id]').length).toBe(1)
    expect(container.querySelectorAll('[data-dashboard-placeholder="true"]').length).toBe(3)
  })

  it('renders no cover section when zero covers are configured', () => {
    const { container } = render(
      <HomeDashboardView entities={[scene('scene.abendstimmung', 'Abendstimmung')]} />,
    )
    expect(container.querySelector('.coverSection')).toBeNull()
    // the scene row still renders: 1 real button + 2 placeholder buttons
    expect(container.querySelectorAll('.sceneRow [data-dashboard-placeholder="true"]').length).toBe(
      2,
    )
    expect(screen.getByText('Abendstimmung')).toBeInTheDocument()
  })

  it('focus chain skips hidden zones — index 0 targets the first light slot', () => {
    // 0 scenes + 2 lights + 0 covers → 4 focus stops, all light slots
    const entities = [
      light('light.esstisch_lampe', 'Esstisch Lampe'),
      light('light.flurlicht', 'Flurlampe'),
    ]
    const { container, rerender } = render(
      <HomeDashboardView entities={entities} focusedIndex={0} />,
    )
    const focused = container.querySelectorAll('.focused')
    expect(focused.length).toBe(1)
    expect(focused[0]).toHaveAttribute('data-entity-id', 'light.esstisch_lampe')

    rerender(<HomeDashboardView entities={entities} focusedIndex={1} />)
    const second = container.querySelectorAll('.focused')
    expect(second.length).toBe(1)
    expect(second[0]).toHaveAttribute('data-entity-id', 'light.flurlicht')
  })
})

// issue #53: on-device, scenes AND covers configured pushed the total zone
// height past the 480px viewport — and the zones (direct flex children of
// .scroller with the default flex-shrink: 1) were compressed BELOW their
// content height instead of overflowing (thin empty boxes overlapping the
// next zone; the bug51 class). jsdom does not compute class-based styles and
// vitest's CSS pipeline intercepts .scss imports, so the fix is pinned in the
// stylesheet source — same readFileSync idiom as PiServerModal.test.tsx and
// the bug43 min-height pin in SettingsList.test.tsx.
describe('HomeDashboardView stylesheet pins (issue #53)', () => {
  const scss = readFileSync('src/components/MainMenuView/HomeDashboardView.module.scss', 'utf8')

  // extract a top-level block (brace-balanced — .scroller nests its child
  // selector)
  const block = (selector: string): string => {
    const start = scss.indexOf(`.${selector} {`)
    expect(start, `${selector} block missing`).toBeGreaterThanOrEqual(0)
    let depth = 0
    let end = -1
    for (let i = start; i < scss.length; i++) {
      if (scss[i] === '{') depth += 1
      else if (scss[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    expect(end, `${selector} block unbalanced`).toBeGreaterThanOrEqual(0)
    return scss.slice(start, end + 1)
  }

  it('pins the direct children of .scroller to flex-shrink: 0 (zones keep content height)', () => {
    // The exact bug51 idiom (PiServerModal/HaSettingsModal .content,
    // SettingsList rows): every zone stays at its content height so the
    // overflow — with it the scroll and the dial's scrollIntoView — happens
    // inside the port instead of compressing the zones.
    const scroller = block('scroller')
    expect(scroller).toContain('overflow-y: auto;')
    expect(scroller).toMatch(/> \* \{\s*flex-shrink: 0;\s*\}/)
  })

  it('declares explicit content min-heights on .sceneBtn and .coverColumn', () => {
    // Content-based heights alone were compressed on the device (bug36/bug43
    // precedent: explicit min-heights survive where content-min didn't). The
    // values are derived from the real scale (border-box, line-height 1.4):
    // .sceneBtn = padding $s-3 x2 (24) + icon 20px + gap $s-1 (4) + label line
    // $fs-sm x1.4 (16.8) = 64.8 -> 65px; .coverColumn = padding $s-2 x2 (16) +
    // label line $fs-md x1.4 (19.6) + gap $s-2 (8) + control row (the slider
    // track is 120px and anchors the row — the enlarged button stack
    // 48+12+48 = 108 centers inside it) = 163.6 -> 164px (issue #57 T5 added
    // the slider row, issue #61 removed the icon + footer readout, issue #64
    // enlarged the track + buttons). Update both the SCSS and this pin together.
    expect(block('sceneBtn')).toMatch(/min-height: 65px;/)
    expect(block('coverColumn')).toMatch(/min-height: 164px;/)
    // cover columns read as entity tiles — same tint as .lightTile / .sceneBtn
    expect(block('coverColumn')).toContain('background: rgba(255, 255, 255, 0.07);')
  })

  it('drops the .coverStatus rule and the icon-only tint from .coverBtns (issue #61)', () => {
    // The bottom position readout ('45% Position' / 'Position –') and the
    // blinds icon between the ^ / v buttons are gone — their SCSS must be too:
    // no .coverStatus rule, and .coverBtns no longer sets a text color (that
    // tint only existed for the now-removed icon; .coverBtn sets its own).
    expect(scss.indexOf('.coverStatus {')).toBe(-1)
    expect(block('coverBtns')).not.toMatch(/color:\s*\$text-secondary/)
  })

  it('pins the issue #64 cover sizing: visible track groove, enlarged thumb, button tiles, wider gaps', () => {
    // issue #64 restyled the control row into three clearly separated
    // elements: a visible vertical track GROOVE (14 x 120px) with a clearly
    // defined 28px amber THUMB inside it; the ^ / v controls became SEPARATE
    // rounded button tiles (56 x 48px, $r-md radius) with comfortable touch
    // hitboxes; and the gaps between buttons | slider | scale were expanded.
    // All CR69-safe: fixed px sizes + margin-based gap mixins only.
    const track = block('coverTrack')
    expect(track).toContain('width: 14px;')
    expect(track).toContain('height: 120px;')
    // the thumb is a defined knob (bigger than the old 18px), still amber,
    // still centered on its computed top offset (issue #63 builds on it)
    const thumb = block('coverThumb')
    expect(thumb).toContain('width: 28px;')
    expect(thumb).toContain('height: 28px;')
    expect(thumb).toContain('background: $light-amber;')
    expect(thumb).toContain('translate(-50%, -50%)')
    // the ^ / v controls are separate rounded button tiles, not flat icons
    expect(block('coverBtn')).toContain('height: 48px;')
    expect(block('coverBtn')).toContain('border-radius: $r-md;')
    expect(block('coverBtns')).toContain('width: 56px;')
    // expanded gaps: buttons|slider = $s-4, track|scale = $s-2
    expect(block('coverRow')).toContain('@include flex-gap-x($s-4);')
    expect(block('coverSlider')).toContain('@include flex-gap-x($s-2);')
    // scale marks are pinned to EXACT track heights: absolute positioning +
    // vertical centering, the inline top is driven in the component
    const scale = block('coverScale')
    expect(scale).toMatch(/span \{\s*position: absolute;/)
    expect(scale).toContain('transform: translateY(-50%);')
  })

  it('introduces no raw flex gap (CR69: Chromium 69 ignores it)', () => {
    // The only raw `gap:` in the module is on .lightGrid — a GRID container,
    // CR69-safe since Chrome 66 and the repo's established grid pattern. All
    // FLEX containers (.scroller and its zones) must stay on the margin-based
    // flex-gap-x/y mixins.
    const rawGaps = scss.match(/gap\s*:/g) ?? []
    expect(rawGaps.length).toBe(1)
    for (const selector of ['scroller', 'sceneBtn', 'coverColumn']) {
      expect(block(selector)).not.toMatch(/gap\s*:/)
    }
  })

  it('keeps the light slider fill out of the green accent (issue #60)', () => {
    // The turn-off transition window (an OFF tile still carrying its stale
    // level for ~1–2 s) used to flash GREEN: the base fill was $accent and no
    // .tileIsOff override existed. Pin: the base fill resolves to the local
    // warm amber (green is not selectable in ANY state), and .tileFadingOff
    // re-warms the track with the same tint .tileIsOn uses, so the slider
    // stays yellow until the level unmounts.
    // match the DECLARATION (the comment may still name $accent historically)
    const fill = block('brightnessFill')
    expect(fill).toContain('background: $light-amber;')
    expect(fill).not.toMatch(/background:\s*\$accent/)
    expect(block('tileFadingOff')).toContain('rgba($light-amber, 0.24)')
  })
})

// issue #57 T1: touch-input dial focus behavior — a SHORT tap reports the
// slot's LINEAR chain index (onSlotTapped; the parent re-roots the dial on it
// WITHOUT confirming). A real finger scroll (content movement beyond ~10 px)
// clears the dial focus exactly ONCE per touch (onTouchScroll), fed by two
// independent movement signals — pointermove travel and the scroller's scrollTop
// delta (on CR69 the browser takes over the pan early, fires pointercancel and
// stops pointermove, but the scroll event keeps firing). A plain tap or
// sub-slop jitter never fires it.
describe('HomeDashboardView tap + touch-scroll focus (issue #57 T1)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const entities = [
    scene('scene.abendstimmung', 'Abendstimmung'),
    light('light.esstisch_lampe', 'Esstisch Lampe'),
    cover('cover.wohnzimmer', 'Wohnzimmer Rollo'),
  ]

  it('reports the LINEAR chain index of every tapped slot (scenes → lights → covers)', () => {
    const onSlotTapped = vi.fn()
    const onTouchScroll = vi.fn()
    const { container } = render(
      <HomeDashboardView
        entities={entities}
        onSlotTapped={onSlotTapped}
        onTouchScroll={onTouchScroll}
      />,
    )
    // 3 scene slots (1 real + 2 placeholders) + 4 light tiles + 2 cover columns:
    // chain indices scenes 0..2, lights 3..6, covers 7..8
    fireEvent.click(screen.getByText('Abendstimmung'))
    expect(onSlotTapped).toHaveBeenLastCalledWith(0)

    fireEvent.click(screen.getByText('Esstisch Lampe'))
    expect(onSlotTapped).toHaveBeenLastCalledWith(3)

    const coverCol = container.querySelector('[data-entity-id="cover.wohnzimmer"]') as HTMLElement
    const upBtn = coverCol.querySelector('[data-cover-action="up"]') as HTMLElement
    fireEvent.click(upBtn)
    expect(onSlotTapped).toHaveBeenLastCalledWith(7)

    // a plain tap is never a scroll — the taps above must not clear the focus
    expect(onTouchScroll).not.toHaveBeenCalled()
  })

  it('fires onTouchScroll ONCE per touch when the content moves beyond slop (scrollTop delta)', () => {
    const onTouchScroll = vi.fn()
    const { container } = render(
      <HomeDashboardView entities={entities} onTouchScroll={onTouchScroll} />,
    )
    const scroller = container.querySelector('[data-home-scroller="true"]') as HTMLElement
    // pointerdown starts the session at scrollTop 0 (jsdom's real value here)
    fireEvent.pointerDown(scroller, { clientX: 100, clientY: 100 })
    // jsdom does not compute scroll geometry — stub the content position to
    // simulate a real pan. This is exactly the CR69 signal: the scroll event
    // keeps firing even after pointercancel stopped the pointermove stream.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 60 })
    fireEvent.scroll(scroller)
    expect(onTouchScroll).toHaveBeenCalledTimes(1)
    // a further step of the SAME touch stays silent (one fire per session)
    fireEvent.scroll(scroller)
    expect(onTouchScroll).toHaveBeenCalledTimes(1)
  })

  it('fires onTouchScroll when the finger travels beyond slop (pointermove signal)', () => {
    const onTouchScroll = vi.fn()
    const { container } = render(
      <HomeDashboardView entities={entities} onTouchScroll={onTouchScroll} />,
    )
    const scroller = container.querySelector('[data-home-scroller="true"]') as HTMLElement
    fireEvent.pointerDown(scroller, { clientX: 100, clientY: 100 })
    // 40 px travel > slop — marks the session moved; the scroll event commits
    fireEvent.pointerMove(scroller, { clientX: 100, clientY: 60 })
    fireEvent.scroll(scroller)
    expect(onTouchScroll).toHaveBeenCalledTimes(1)
  })

  it('does not fire onTouchScroll for a plain tap or sub-slop jitter', () => {
    const onTouchScroll = vi.fn()
    const { container } = render(
      <HomeDashboardView entities={entities} onTouchScroll={onTouchScroll} />,
    )
    const scroller = container.querySelector('[data-home-scroller="true"]') as HTMLElement
    fireEvent.pointerDown(scroller, { clientX: 100, clientY: 100 })
    // under the slop in BOTH signals (jsdom scrollTop stays 0 → delta 0)
    fireEvent.pointerMove(scroller, { clientX: 103, clientY: 102 })
    fireEvent.scroll(scroller)
    fireEvent.pointerUp(scroller)
    expect(onTouchScroll).not.toHaveBeenCalled()
  })

  it('ends an abandoned session after the idle window (pointercancel without pointerup)', () => {
    vi.useFakeTimers()
    const onTouchScroll = vi.fn()
    const { container } = render(
      <HomeDashboardView entities={entities} onTouchScroll={onTouchScroll} />,
    )
    const scroller = container.querySelector('[data-home-scroller="true"]') as HTMLElement
    fireEvent.pointerDown(scroller, { clientX: 100, clientY: 100 })
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 40 })
    // fires and arms the idle expiry (module constant TOUCH_SCROLL_IDLE_MS = 400)
    fireEvent.scroll(scroller)
    expect(onTouchScroll).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.scroll(scroller) // the session is gone — must not re-fire
    expect(onTouchScroll).toHaveBeenCalledTimes(1)
  })
})

// issue #57 T4: light tile readout rule + state-aware styling classes. The
// readout shows '0%' next to 'Aus' for OFF dimmable tiles (the level is known
// to be zero), the reported 'N%' for ON tiles with a KNOWN level, and no
// number at all for ON tiles whose level is unknown (brightnessPct null).
// Non-dimmable tiles keep the plain rule. Tiles carry .tileIsOn / .tileIsOff
// so the SCSS can render the warm ON accent / muted OFF treatment; issue #60
// adds .tileFadingOff for the turn-off transition window (OFF + level known).
describe('HomeDashboardView light readout + state classes (issue #57 T4)', () => {
  function offDimmable(entityId: string, label: string): DashboardEntity {
    return { ...light(entityId, label), active: false, brightnessPct: null }
  }

  function onUnknownLevel(entityId: string, label: string): DashboardEntity {
    return { ...light(entityId, label), brightnessPct: null }
  }

  it('shows 0% next to Aus for an OFF dimmable tile', () => {
    const { container } = render(
      <HomeDashboardView
        entities={[offDimmable('light.sofa', 'Sofa'), light('light.tisch', 'Tisch')]}
      />,
    )
    const tile = container.querySelector('[data-entity-id="light.sofa"]') as HTMLElement
    expect(tile.textContent).toContain('0%')
    expect(tile.textContent).toContain('Aus')
  })

  it('shows the reported percent next to An for an ON tile with a known level', () => {
    const { container } = render(<HomeDashboardView entities={[light('light.tisch', 'Tisch')]} />)
    // the light() fixture reports brightnessPct 40 → the readout shows it
    const tile = container.querySelector('[data-entity-id="light.tisch"]') as HTMLElement
    expect(tile.textContent).toContain('40%')
    expect(tile.textContent).toContain('An')
  })

  it('shows no number for an ON tile whose level is unknown (just An)', () => {
    const { container } = render(
      <HomeDashboardView entities={[onUnknownLevel('light.kueste', 'Kueste')]} />,
    )
    const tile = container.querySelector('[data-entity-id="light.kueste"]') as HTMLElement
    expect(tile.textContent).not.toContain('%')
    expect(tile.textContent).toContain('An')
  })

  it('keeps non-dimmable tiles on the plain rule (no number without a level)', () => {
    const { container } = render(
      <HomeDashboardView
        entities={[
          {
            ...light('light.lichtschalter', 'Lichtschalter'),
            dimmable: false,
            brightnessPct: null,
          },
        ]}
      />,
    )
    const tile = container.querySelector('[data-entity-id="light.lichtschalter"]') as HTMLElement
    expect(tile.textContent).not.toContain('%')
  })

  it('marks light tiles with the state classes (.tileIsOn / .tileIsOff)', () => {
    const { container } = render(
      <HomeDashboardView entities={[light('light.an', 'An'), offDimmable('light.aus', 'Aus')]} />,
    )
    const onTile = container.querySelector('[data-entity-id="light.an"]') as HTMLElement
    const offTile = container.querySelector('[data-entity-id="light.aus"]') as HTMLElement
    expect(onTile.classList.contains('tileIsOn')).toBe(true)
    expect(onTile.classList.contains('tileIsOff')).toBe(false)
    expect(offTile.classList.contains('tileIsOff')).toBe(true)
    expect(offTile.classList.contains('tileIsOn')).toBe(false)
  })

  it('keeps the last-level slider on its warm accent through the turn-off transition (issue #60)', () => {
    // OFF dimmable tile that still carries its level = the turn-off window
    // (the optimistic flip / HA went 'off' first, attributes.brightness lags)
    const fading: DashboardEntity = {
      ...light('light.dimm', 'Dimm'),
      active: false,
      state: 'off',
      brightnessPct: 40,
    }
    const { container } = render(
      <HomeDashboardView entities={[fading, offDimmable('light.aus', 'Aus')]} />,
    )
    const tile = container.querySelector('[data-entity-id="light.dimm"]') as HTMLElement
    // still an OFF tile (dimmed icon + '0% Aus' readout)...
    expect(tile.classList.contains('tileIsOff')).toBe(true)
    expect(tile.classList.contains('tileIsOn')).toBe(false)
    // ...but the transition marker is set — the warm accent state the SCSS keys on
    expect(tile.classList.contains('tileFadingOff')).toBe(true)
    // and the slider keeps its last level mounted (fill + knob at 40%)
    const fill = tile.querySelector('.brightnessFill') as HTMLElement
    expect(fill).not.toBeNull()
    expect(fill.style.width).toBe('40%')
    expect(tile.querySelector('.knob')).not.toBeNull()
    // a settled OFF tile (level cleared) shows neither fill nor marker
    const settled = container.querySelector('[data-entity-id="light.aus"]') as HTMLElement
    expect(settled.classList.contains('tileFadingOff')).toBe(false)
    expect(settled.querySelector('.brightnessFill')).toBeNull()
  })

  it('never carries the turn-off marker on ON tiles (issue #60)', () => {
    const { container } = render(<HomeDashboardView entities={[light('light.an', 'An')]} />)
    const tile = container.querySelector('[data-entity-id="light.an"]') as HTMLElement
    expect(tile.classList.contains('tileFadingOff')).toBe(false)
  })
})

// issue #57 T5, reworked in issues #61 + #64, made interactive in issue #63:
// cover column layout — label on top, then the control row with THREE elements
// side by side: the stacked ^ / v BUTTON TILES (LEFT), the vertical position
// slider — visible track (groove) + clearly defined thumb (MIDDLE) — and the
// static percentage SCALE (RIGHT). NO zone icon between the buttons, NO
// position readout text under the row. HA cover semantics (issue #63):
// current_position 0 = fully OPEN → thumb at the TOP of the track
// (top: positionPct% — NO inversion anywhere), 100 = fully closed → thumb at
// the BOTTOM. The scale reads "how far down the blind is" top→bottom:
// '0% (Auf)' / '25%' / '50%' / '75%' / '100% (Zu)', each mark pinned to its
// exact track height — and that value equals the thumb's top offset, so the
// thumb always lines up with its own label. The track is the drag/tap target
// for direct positioning ([data-cover-track], handlers wired in issue #63).
describe('HomeDashboardView cover column layout (issue #57 T5, issues #61 + #64)', () => {
  it('stacks ^ and v with NO zone icon between them in every column (issue #61)', () => {
    // one real cover → 1 real column + 1 placeholder column ('Esszimmer')
    const { container } = render(
      <HomeDashboardView entities={[cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]} />,
    )
    const cols = Array.from(container.querySelectorAll('.coverColumn'))
    expect(cols.length).toBe(2)
    for (const col of cols) {
      // issue #61: no icon anywhere in the column — the blinds MenuIcon that
      // used to sit between the two buttons is gone (no svg at all)
      expect(col.querySelectorAll('svg').length).toBe(0)
      // both arrow buttons stay stacked in .coverBtns, ^ ABOVE v, and keep
      // their data-cover-action wiring (both actionable + holdable)
      const btns = col.querySelector('.coverBtns') as HTMLElement
      const arrows = Array.from(btns.querySelectorAll('[data-cover-action]')) as HTMLElement[]
      expect(arrows.length).toBe(2)
      expect(arrows[0].dataset.coverAction).toBe('up')
      expect(arrows[0].textContent).toBe('^')
      expect(arrows[1].dataset.coverAction).toBe('down')
      expect(arrows[1].textContent).toBe('v')
    }
  })

  it('renders NO position readout text under the control row (issue #61)', () => {
    const entities: DashboardEntity[] = [
      // known position → used to render '45% Position'; unknown → 'Position –'
      { ...cover('cover.kueche_rollo', 'Kueche Rollo'), positionPct: 45 },
      cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo'),
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    for (const col of Array.from(container.querySelectorAll('.coverColumn'))) {
      // the removed .coverStatus element is gone entirely — neither the known
      // '45% Position' text nor the 'Position –' dash path
      expect(col.querySelector('.coverStatus')).toBeNull()
      expect((col.textContent ?? '').includes('Position')).toBe(false)
    }
  })

  it('renders the vertical scale 0% (Auf) at top → 100% (Zu) at bottom, pinned to track heights (issue #64)', () => {
    const { container } = render(
      <HomeDashboardView entities={[cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]} />,
    )
    const col = container.querySelector('.coverColumn') as HTMLElement
    const scale = col.querySelector('.coverScale') as HTMLElement
    // 5 static marks reading "how far down the blind is": 0% (Auf) at the TOP
    // of the track ... 100% (Zu) at the BOTTOM — the same scale as HA's
    // current_position (issue #63: 0 = fully open, 100 = fully closed). Each
    // mark carries an inline top matching its own label value, so 0%/50%/100%
    // line up with the track top/middle/bottom.
    const marks = Array.from(scale.querySelectorAll('span')) as HTMLElement[]
    expect(marks.map((m) => m.textContent)).toEqual(['0% (Auf)', '25%', '50%', '75%', '100% (Zu)'])
    expect(marks.map((m) => m.style.top)).toEqual(['0%', '25%', '50%', '75%', '100%'])
  })

  it('renders the slider structure: track groove + thumb inside it, marked as the drag/tap target (issues #64 + #63)', () => {
    const entities: DashboardEntity[] = [
      { ...cover('cover.kueche_rollo', 'Kueche Rollo'), positionPct: 45 },
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    const col = container.querySelector('[data-entity-id="cover.kueche_rollo"]') as HTMLElement
    // the track is the element issue #63 wires its pointer handlers to
    const track = col.querySelector('.coverTrack[data-cover-track="true"]') as HTMLElement
    expect(track).not.toBeNull()
    // the thumb sits INSIDE the track (its position target), not beside it
    const thumb = track.querySelector('.coverThumb') as HTMLElement
    expect(thumb).not.toBeNull()
  })

  it('shows the thumb at exactly top: positionPct% for a known position — no inversion (issues #61 + #63)', () => {
    const entities: DashboardEntity[] = [
      { ...cover('cover.kueche_rollo', 'Kueche Rollo'), positionPct: 45 },
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    const col = container.querySelector('[data-entity-id="cover.kueche_rollo"]') as HTMLElement
    // thumb present; issue #63 semantics: positionPct ≡ HA's current_position
    // (0 = fully open / "Auf" at the top, 100 = fully closed / "Zu" at the
    // bottom) and is carried through UNCHANGED — 45% closed → top: 45%, which
    // is also the "how far down" percentage, so the thumb lines up with the
    // ~45% area of its own scale (issues #61 + #64)
    const thumb = col.querySelector('.coverThumb') as HTMLElement
    expect(thumb).not.toBeNull()
    expect(thumb.style.top).toBe('45%')
    // issue #61: the position is shown ONLY via the thumb — no text readout
    expect(col.querySelector('.coverStatus')).toBeNull()
  })

  it('renders no thumb when the position is unknown (no readout either, issue #61)', () => {
    const { container } = render(
      <HomeDashboardView entities={[cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]} />,
    )
    // the fixture reports no position (positionPct null) — as do all
    // placeholder columns, so BOTH the real and the placeholder column take
    // the null path (no thumb; issue #61 removed the dash readout too)
    const cols = Array.from(container.querySelectorAll('.coverColumn'))
    expect(cols.length).toBe(2)
    for (const col of cols) {
      expect(col.querySelector('.coverThumb')).toBeNull()
      expect(col.querySelector('.coverStatus')).toBeNull()
    }
  })
})

// issue #63: direct positioning from the position slider — a tap/drag on
// [data-cover-track] sends the pointer's % down from the track's top edge as
// cover.set_cover_position (via onCoverSetPosition): exactly ONE send per
// press for a tap, one send per INTEGER change while dragging, plus the final
// value on release iff its integer differs. The thumb mapping test lives in
// the layout describe above (top: positionPct%, no inversion).
describe('HomeDashboardView cover slider direct positioning (issue #63)', () => {
  // jsdom gives every element a zero-sized rect and no pointer capture, so
  // the track's % down computation needs a stubbed geometry (same approach as
  // MainMenuView.test.tsx's stubBar)
  function stubTrack(el: HTMLElement, top = 100, height = 200): void {
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 14,
        right: 14,
        top,
        bottom: top + height,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
    el.setPointerCapture = () => undefined
    el.releasePointerCapture = () => undefined
    el.hasPointerCapture = () => false
  }

  it('renders the thumb at exactly its scale mark for open / half / closed (no inversion)', () => {
    const entities: DashboardEntity[] = [
      { ...cover('cover.auf', 'Auf'), positionPct: 0 }, // fully open → TOP
      { ...cover('cover.halb', 'Halb'), positionPct: 50 },
      { ...cover('cover.zu', 'Zu'), positionPct: 100 }, // fully closed → BOTTOM
    ]
    const { container } = render(<HomeDashboardView entities={entities} />)
    for (const [id, top] of [
      ['cover.auf', '0%'],
      ['cover.halb', '50%'],
      ['cover.zu', '100%'],
    ] as const) {
      const col = container.querySelector(`[data-entity-id="${id}"]`) as HTMLElement
      const thumb = col.querySelector('.coverThumb') as HTMLElement
      expect(thumb).not.toBeNull()
      // the thumb's top IS its position value — it sits on its own scale mark
      expect(thumb.style.top).toBe(top)
    }
  })

  it('tap on the track sends EXACTLY ONE command at the tapped position and re-roots the dial', () => {
    // default fixture: unknown position (positionPct null) — a REAL cover is
    // still fully operable (issue #63 decision); the thumb just stays hidden
    const onCoverSetPosition = vi.fn()
    const onSlotTapped = vi.fn()
    const entities = [cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]
    const { container } = render(
      <HomeDashboardView
        entities={entities}
        onCoverSetPosition={onCoverSetPosition}
        onSlotTapped={onSlotTapped}
      />,
    )
    const col = container.querySelector('[data-entity-id="cover.wohnzimmer_rollo"]') as HTMLElement
    expect(col.querySelector('.coverThumb')).toBeNull() // unknown position
    const track = col.querySelector('.coverTrack[data-cover-track="true"]') as HTMLElement
    stubTrack(track) // top 100, height 200 → clientY 200 == the middle == 50
    fireEvent.pointerDown(track, { clientX: 7, clientY: 200 })
    fireEvent.pointerUp(track, { clientX: 7, clientY: 200 }) // no travel → a tap
    expect(onCoverSetPosition).toHaveBeenCalledTimes(1)
    // the REAL column model + the integer target position
    expect(onCoverSetPosition).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'cover.wohnzimmer_rollo' }),
      50,
    )
    // a short tap re-roots the dial onto the column (chain: 4 light slots + i)
    expect(onSlotTapped).toHaveBeenCalledTimes(1)
    expect(onSlotTapped).toHaveBeenCalledWith(4)
  })

  it('drag sends only on INTEGER change and the final value on release; never re-roots the dial', () => {
    const onCoverSetPosition = vi.fn()
    const onSlotTapped = vi.fn()
    const entities = [cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]
    const { container } = render(
      <HomeDashboardView
        entities={entities}
        onCoverSetPosition={onCoverSetPosition}
        onSlotTapped={onSlotTapped}
      />,
    )
    const col = container.querySelector('[data-entity-id="cover.wohnzimmer_rollo"]') as HTMLElement
    const track = col.querySelector('.coverTrack[data-cover-track="true"]') as HTMLElement
    stubTrack(track) // top 100, height 200 → pctDown = (clientY - 100) / 2
    fireEvent.pointerDown(track, { clientX: 7, clientY: 100 }) // 0% — first send
    fireEvent.pointerMove(track, { clientX: 7, clientY: 150 }) // 25% — integer change
    fireEvent.pointerMove(track, { clientX: 7, clientY: 149.5 }) // 24.75 → 25 — NO send
    fireEvent.pointerMove(track, { clientX: 7, clientY: 160 }) // 30% — integer change
    fireEvent.pointerUp(track, { clientX: 7, clientY: 200 }) // release at 50% — final send
    expect(onCoverSetPosition.mock.calls.map((c) => c[1])).toEqual([0, 25, 30, 50])
    // a drag is never a tap — the dial focus does not move
    expect(onSlotTapped).not.toHaveBeenCalled()
  })

  it('placeholder track shows the toast and sends nothing', () => {
    const onCoverSetPosition = vi.fn()
    const entities = [cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]
    const { container } = render(
      <HomeDashboardView entities={entities} onCoverSetPosition={onCoverSetPosition} />,
    )
    // one real cover → 1 real column + 1 placeholder column ('Esszimmer')
    const tracks = Array.from(container.querySelectorAll('.coverTrack[data-cover-track="true"]'))
    expect(tracks.length).toBe(2)
    const placeholderTrack = tracks[1] as HTMLElement
    expect(placeholderTrack.closest('[data-dashboard-placeholder="true"]')).not.toBeNull()
    stubTrack(placeholderTrack)
    fireEvent.pointerDown(placeholderTrack, { clientX: 7, clientY: 200 })
    // W2-2 pattern: the component toasts the placeholder press (parent no-op)
    const toast = container.querySelector('[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast).toHaveTextContent('„Esszimmer" ist noch nicht zugewiesen')
    expect(onCoverSetPosition).not.toHaveBeenCalled()
    // no session was recorded — move/release on the placeholder stay silent
    fireEvent.pointerMove(placeholderTrack, { clientX: 7, clientY: 120 })
    fireEvent.pointerUp(placeholderTrack, { clientX: 7, clientY: 120 })
    expect(onCoverSetPosition).not.toHaveBeenCalled()
  })

  it('stray pointermove without a pointerdown sends nothing', () => {
    const onCoverSetPosition = vi.fn()
    const entities = [cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]
    const { container } = render(
      <HomeDashboardView entities={entities} onCoverSetPosition={onCoverSetPosition} />,
    )
    const col = container.querySelector('[data-entity-id="cover.wohnzimmer_rollo"]') as HTMLElement
    const track = col.querySelector('.coverTrack[data-cover-track="true"]') as HTMLElement
    stubTrack(track)
    fireEvent.pointerMove(track, { clientX: 7, clientY: 150 }) // no session → ignored
    expect(onCoverSetPosition).not.toHaveBeenCalled()
  })

  it('pointerup without a pointerdown (foreign release) sends nothing', () => {
    const onCoverSetPosition = vi.fn()
    const entities = [cover('cover.wohnzimmer_rollo', 'Wohnzimmer Rollo')]
    const { container } = render(
      <HomeDashboardView entities={entities} onCoverSetPosition={onCoverSetPosition} />,
    )
    const col = container.querySelector('[data-entity-id="cover.wohnzimmer_rollo"]') as HTMLElement
    const track = col.querySelector('.coverTrack[data-cover-track="true"]') as HTMLElement
    stubTrack(track)
    fireEvent.pointerUp(track, { clientX: 7, clientY: 200 }) // no session → ignored
    expect(onCoverSetPosition).not.toHaveBeenCalled()
  })
})

// issue #57 (T3 follow-up): a bare `//` comment line that sat INSIDE the scene
// slot's JSX element was parsed as JSXText and rendered above the icon on
// device. Pin the scene slot text so it carries only icon + label — never a
// leaked comment marker.
describe('HomeDashboardView scene slot markup (issue #57 T3 comment leak)', () => {
  it('renders no leaked bare // comment text inside any scene slot', () => {
    // one real scene → the row renders with 1 real + 2 placeholder slots
    const { container } = render(
      <HomeDashboardView entities={[scene('scene.abendstimmung', 'Abendstimmung')]} />,
    )
    const slots = Array.from(container.querySelectorAll('.sceneBtn'))
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      const text = (slot.textContent ?? '').trim()
      expect(text).not.toContain('issue #57')
      expect(text.startsWith('//')).toBe(false)
    }
    // the real slot's visible text is its label only
    const real = container.querySelector('[data-entity-id="scene.abendstimmung"]') as HTMLElement
    expect((real.textContent ?? '').trim()).toBe('Abendstimmung')
  })
})
