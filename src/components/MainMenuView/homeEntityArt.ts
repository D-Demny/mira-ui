// ticket 9.3 (Teil 2): deterministic SVG tiles for the Home carousel entity
// cards — same self-contained data-URI pattern as art() in mockData.ts (an
// AlbumArt <img src> renders them without network access).
//
// Pure module (no React): the string must be byte-identical for identical
// inputs so the card's memo/compare stays stable across renders.

// Line-icon path data per domain (24x24 viewBox, MenuIcon style: stroke,
// round caps/joins, fill none) + the 'manage' special key (carousel's
// picker entry). Unknown domains fall back to 'manage' in entityArt().
export const ENTITY_ICON_PATHS: Record<string, string[]> = {
  light: [
    'M12 3a5.5 5.5 0 0 1 3.9 9.4c-.8.75-1.4 1.6-1.55 2.6h-4.7c-.15-1-.75-1.85-1.55-2.6A5.5 5.5 0 0 1 12 3z',
    'M9.8 17.5h4.4',
    'M10.6 20.5h2.8',
  ],
  switch: [
    'M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z',
    'M12 14.5V8',
  ],
  fan: [
    'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    'M12 9.8C10.6 8 10.8 4.8 12 3C13.2 4.8 13.4 8 12 9.8z',
    'M13.9 13.1C16.16 12.79 18.84 14.56 19.79 16.5C17.64 16.64 14.76 15.21 13.9 13.1z',
    'M10.1 13.1C9.24 15.21 6.36 16.64 4.21 16.5C5.16 14.56 7.84 12.79 10.1 13.1z',
  ],
  scene: [
    'M12 3l2 6 6 3-6 3-2 6-2-6-6-3 6-3z',
    'M19 3.5v3',
    'M17.5 5h3',
  ],
  cover: [
    'M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z',
    'M5 8h14',
    'M5 12h14',
    'M5 16h14',
  ],
  input_boolean: [
    'M6.5 4h11a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4z',
    'M8.5 12.5l2.5 2.5 4.5-5.5',
  ],
  media_player: [
    'M5.5 3.5h13a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4.5 19V5a1.5 1.5 0 0 1 1.5-1.5z',
    'M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    'M12 7v.01',
  ],
  manage: [
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1',
  ],
}

// per-domain hue window for the tile gradient (Chromium 69: legacy
// comma-syntax hsl() only — no space syntax, no color-mix)
const HUE_WINDOWS: Record<string, [number, number]> = {
  light: [30, 50],
  switch: [160, 190],
  fan: [190, 210],
  scene: [260, 290],
  cover: [100, 130],
  input_boolean: [210, 240],
  media_player: [320, 350],
  manage: [20, 35],
}

const UNKNOWN_HUE = 200
const SATURATION = 68

// FNV-1a 32-bit — >>> 0 arithmetic only (deterministic across engines)
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// the domain's gradient hue (window midpoint) — the picker's icon tiles use
// it for a soft domain-tinted background
export function entityDomainHue(domain: string): number {
  const win = HUE_WINDOWS[domain]
  if (!win) return UNKNOWN_HUE
  return Math.round((win[0] + win[1]) / 2)
}

// 170x170 tile: diagonal domain-hue gradient + centered 64px white line icon.
// The seed (the entity id) deterministically offsets the hue within the
// domain window and nudges the lightness, so cards of the same domain look
// related but not identical. active: true = bright variant, false = dark,
// null = medium.
export function entityArt(domain: string, seed: string, active: boolean | null): string {
  const hash = fnv1a(seed)
  const win = HUE_WINDOWS[domain] ?? [UNKNOWN_HUE, UNKNOWN_HUE]
  const hue = Math.round(win[0] + ((hash % 1000) / 1000) * (win[1] - win[0]))
  const hue2 = (hue + 10) % 360
  const shift = ((hash >>> 8) % 7) - 3

  let lightTop: number
  let lightBottom: number
  if (active === true) {
    lightTop = 66
    lightBottom = 48
  } else if (active === false) {
    lightTop = 30
    lightBottom = 17
  } else {
    lightTop = 47
    lightBottom = 33
  }
  const clampedLight = (base: number): number => Math.max(5, Math.min(90, base + shift))
  const from = `hsl(${hue}, ${SATURATION}%, ${clampedLight(lightTop)}%)`
  const to = `hsl(${hue2}, ${SATURATION}%, ${clampedLight(lightBottom)}%)`

  const paths = ENTITY_ICON_PATHS[domain] ?? ENTITY_ICON_PATHS.manage
  const icon = paths.map((d) => `<path d="${d}"/>`).join('')

  // icon: 64px box centered on the 170px tile; stroke-width 0.75 in the 24
  // viewBox renders as exactly 2px at 64px (MenuIcon line weight)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="170" height="170">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="170" height="170" fill="url(#g)"/>` +
    `<svg x="53" y="53" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ffffff" ` +
    `stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round">` +
    icon +
    `</svg></svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
