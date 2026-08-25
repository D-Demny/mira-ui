import { useSyncExternalStore } from 'react'
import {
  getSettings,
  subscribeSettings,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from '@/settings'

// bug38: display size scales the now-playing screen only, not the whole app. #root stays
// a constant 800x480 (styles/_global.scss); the player view (App.tsx) renders its wrapper
// at a *logical* viewport size and zooms it back onto the physical panel. zoom reflows
// AND rasterizes at the final size, so text stays crisp at every notch
// (transform:scale stretched the finished raster). everything else - main menu, submenus,
// settings lists, overlay sheets - is laid out at a fixed 100% and never receives the
// counter-size or the zoom.
//
// scale > 1 => smaller logical viewport => bigger ui, less content on screen.
//
// the wrapper registers itself with registerUiScaleTarget (a ref callback in App.tsx),
// which couples the scale's *context* to its *target*: while the player view is mounted,
// getUiScale()/useUiScale() report the achieved zoom to the player-internal consumers
// (lyrics drag, progress scrub, marquee). when the player view is gone, they report 1,
// so the menus' drag math (NotchedSlider) can never see a zoom its own subtree doesn't
// have - even when it renders on top of a mounted, zoomed player.
//
// chrome 69 under zoom: rects are unzoomed layout px, pointer coords and wheel deltas
// device px divide the latter by the achieved scale before mixing with rects

const BASE_W = 800
const BASE_H = 480

// the album art is the only fixed-height block in the player column and it never
// shrinks, so it has to give way first when the logical viewport gets shorter.
//   stage row = h - (pad-y 24 + pad-bottom 28 + row gap 12 + bottom bar 132)
//   .left     = art + gap 12 + TrackInfo 62.8
const STAGE_RESERVED_H = 196
const ART_MAX = 200
const ART_MIN = 120
const ART_RESERVED_H = STAGE_RESERVED_H + 12 + 62.8

// the no-lyrics view instead centres the art in the stage row behind a 130% blurred
// glow, and its stock 220 is tuned so that glow just fits at 100%
const HERO_ART_MAX = 220
const HERO_GLOW_RATIO = 1.3

function stageHeight(pct: number): number {
  return logicalSize(pct).h - STAGE_RESERVED_H
}

// whole pixels keep layout off subpixels; zoom derives from the rounded width so the
// paint lands on exactly 800 wide, and h ceils so the bottom overshoots by <1px
// (clipped) instead of leaving a seam
export function logicalSize(pct: number): { w: number; h: number } {
  const s = pct / 100
  const w = Math.round(BASE_W / s)
  const z = BASE_W / w
  return { w, h: Math.ceil(BASE_H / z) }
}

export function artSizeFor(pct: number): number {
  const { h } = logicalSize(pct)
  return Math.max(ART_MIN, Math.min(ART_MAX, Math.floor(h - ART_RESERVED_H)))
}

// keeps the glow inside the stage row instead of bleeding behind the transport bar
export function heroArtSizeFor(pct: number): number {
  return Math.max(ART_MIN, Math.min(HERO_ART_MAX, Math.floor(stageHeight(pct) / HERO_GLOW_RATIO)))
}

let appliedPct = UI_SCALE_DEFAULT
let target: HTMLElement | null = null
const listeners = new Set<() => void>()

// coerce() only runs when settings are loaded; updateSettings is a raw spread, so a bad
// value can reach here at runtime. a NaN would render as "NaNpx" (silently dropped by
// CSSOM) and then poison every consumer of getUiScale, freezing the lyrics for good
function safePct(pct: number): number {
  if (!Number.isFinite(pct)) return UI_SCALE_DEFAULT
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, pct))
}

// the zoom the stored scale produces. not identical to pct/100 because the logical
// width above is rounded to whole pixels
function achievedZoom(): number {
  return BASE_W / logicalSize(appliedPct).w
}

export function applyUiScale(pct: number): void {
  appliedPct = safePct(pct)
  for (const l of listeners) l()
}

// ref callback for the now-playing wrapper in App.tsx. React passes the element on mount
// and null on unmount. the element renders its own width/height/zoom inline from
// usePlayerViewport, so there is nothing to write here; registering only flips the read
// context of getUiScale and friends
export function registerUiScaleTarget(el: HTMLElement | null): void {
  if (el === target) return
  target = el
  for (const l of listeners) l()
}

// the zoom actually applied to the player view. 1 while the player view is unmounted:
// the zoom is not applied anywhere then, and the only remaining consumers live in the
// fixed-100% menus
export function getUiScale(): number {
  return target ? achievedZoom() : 1
}

export function getUiScaleY(): number {
  return getUiScale()
}

// the achieved zoom that applies to a specific element: an element inside the registered
// target lives in the zoomed subtree, anything else (menus, overlay sheets) lives at
// 100% even when a zoomed player is mounted behind it
export function getUiScaleFor(el: Element | null): number {
  if (!el || !target) return 1
  let node: Element | null = el
  while (node) {
    if (node === target) return achievedZoom()
    node = node.parentElement
  }
  return 1
}

// the logical viewport + zoom the now-playing wrapper renders. rendered inline by the
// App, so the first painted frame of the player is already at the stored display size
// (no flash of unscaled ui) and a settings change re-renders the wrapper declaratively
export interface PlayerViewport {
  w: number
  h: number
  zoom: number
}
let viewportCache: PlayerViewport = { w: BASE_W, h: BASE_H, zoom: 1 }
function playerViewport(): PlayerViewport {
  const { w, h } = logicalSize(appliedPct)
  const zoom = BASE_W / w
  // useSyncExternalStore compares snapshots by reference: keep the object stable while
  // the value is unchanged so target mount/unmount doesn't re-render the wrapper
  if (viewportCache.w !== w || viewportCache.h !== h || viewportCache.zoom !== zoom) {
    viewportCache = { w, h, zoom }
  }
  return viewportCache
}

export function usePlayerViewport(): PlayerViewport {
  return useSyncExternalStore(subscribeUiScale, playerViewport)
}

// seeds the scale store and keeps it in sync. call before the first render: settings
// read localStorage synchronously at module init, so the store is seeded before anything
// renders
export function startUiScaleSync(): () => void {
  applyUiScale(getSettings().uiScalePct)
  return subscribeSettings(() => {
    const pct = getSettings().uiScalePct
    // the store emits on every patch. re-applying re-renders the player wrapper, which
    // invalidates layout for the whole player tree, so don't do it on every brightness
    // notch
    if (pct === appliedPct) return
    applyUiScale(pct)
  })
}

// hoisted so useSyncExternalStore doesn't resubscribe on every render of every consumer
function subscribeUiScale(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// separate from the settings store on purpose: components that only care about the
// scale shouldn't re-render when the brightness or lyric offset changes
export function useUiScale(): number {
  return useSyncExternalStore(subscribeUiScale, getUiScale)
}
