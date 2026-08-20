// static mock data for the Nocturne main menu layout (ticket 8.4a)
// replaced by real API endpoints in a later epic part

export type MenuIconName = 'home' | 'play' | 'playlists' | 'recent' | 'settings'

export type MenuCardKind = 'media' | 'action'

export interface MenuCard {
  id: string
  title: string
  subtitle: string
  art?: string
  // 'media' cards start playback, 'action' cards trigger a local service call,
  // cards without a kind are inert placeholders
  kind?: MenuCardKind
  uri?: string
  actionId?: string
}

export interface MenuCategory {
  id: string
  label: string
  icon: MenuIconName
  // gradient glow colors for the category background (mockups 1-3)
  accent: { a: string; b: string }
  cards: MenuCard[]
}

// self-contained gradient art (data URI) so the mock needs no network access
function art(from: string, to: string, accent: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="200" height="200" fill="url(#g)"/>` +
    `<circle cx="152" cy="48" r="72" fill="${accent}" opacity="0.35"/>` +
    `<circle cx="40" cy="170" r="56" fill="${accent}" opacity="0.22"/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    accent: { a: 'rgba(224, 51, 142, 0.55)', b: 'rgba(245, 166, 35, 0.45)' },
    cards: [
      { id: 'home-1', title: 'Guten Morgen', subtitle: 'Home Routine', art: art('#f5a623', '#e0533d', '#ffe08a') },
      { id: 'home-2', title: 'Kaffeezeit', subtitle: 'Home Routine', art: art('#8e5a3a', '#4a2c1d', '#d9a066') },
      { id: 'home-3', title: 'Abendstimmung', subtitle: 'Home Routine', art: art('#5b3a8e', '#2a1d4a', '#b58ae0') },
      { id: 'home-4', title: 'Gute Nacht', subtitle: 'Home Routine', art: art('#20304f', '#101828', '#5b7fb5') },
    ],
  },
  {
    id: 'now-playing',
    label: 'Läuft gerade',
    icon: 'play',
    accent: { a: 'rgba(84, 58, 182, 0.6)', b: 'rgba(224, 51, 142, 0.4)' },
    cards: [
      { id: 'np-1', title: 'Siamese Dream', subtitle: 'The Smashing Pumpkins', art: art('#e06a3f', '#8e2f6e', '#f5c04a') },
      { id: 'np-2', title: 'The Difference', subtitle: 'Flume, Tom Misch', art: art('#e0338e', '#f5a623', '#3ad1c0') },
      { id: 'np-3', title: 'Midnight City', subtitle: 'M83', art: art('#3a2f8e', '#1d1450', '#8a6ae0') },
      { id: 'np-4', title: 'Heat Waves', subtitle: 'Glass Animals', art: art('#0f8e7a', '#0a3d3a', '#4ae0c0') },
    ],
  },
  {
    id: 'playlists',
    label: 'Playlists',
    icon: 'playlists',
    accent: { a: 'rgba(29, 47, 110, 0.7)', b: 'rgba(58, 106, 224, 0.45)' },
    cards: [
      { id: 'pl-1', title: 'Road Trip', subtitle: 'Mira Mix', art: art('#f5c04a', '#e0533d', '#fff0c0') },
      { id: 'pl-2', title: 'Workout', subtitle: 'Mira Mix', art: art('#e0335b', '#6e1d3a', '#f58a9e') },
      { id: 'pl-3', title: 'Focus', subtitle: 'Mira Mix', art: art('#3a6ae0', '#1d2f6e', '#8ab5f5') },
      { id: 'pl-4', title: 'Party', subtitle: 'Mira Mix', art: art('#8e2fe0', '#3a146e', '#c08af5') },
    ],
  },
  {
    id: 'recent',
    label: 'Zuletzt',
    icon: 'recent',
    accent: { a: 'rgba(91, 58, 142, 0.6)', b: 'rgba(224, 51, 142, 0.35)' },
    cards: [
      { id: 'rc-1', title: 'Siamese Dream', subtitle: 'The Smashing Pumpkins', art: art('#e06a3f', '#8e2f6e', '#f5c04a') },
      { id: 'rc-2', title: 'The Difference', subtitle: 'Flume, Tom Misch', art: art('#e0338e', '#f5a623', '#3ad1c0') },
      { id: 'rc-3', title: 'Blinding Lights', subtitle: 'The Weeknd', art: art('#e0335b', '#3a146e', '#f58af5') },
      { id: 'rc-4', title: 'As It Was', subtitle: 'Harry Styles', art: art('#f5a623', '#8e2f2f', '#ffe08a') },
    ],
  },
  {
    id: 'settings',
    label: 'Einstellungen',
    icon: 'settings',
    accent: { a: 'rgba(15, 61, 58, 0.7)', b: 'rgba(15, 142, 122, 0.4)' },
    cards: [
      { id: 'set-1', title: 'Bluetooth', subtitle: 'Geräte & Pairing' },
      { id: 'set-2', title: 'WLAN', subtitle: 'Netzwerk' },
      { id: 'set-3', title: 'Display', subtitle: 'Helligkeit & Timeout' },
      { id: 'set-4', title: 'Sprache', subtitle: 'Deutsch' },
    ],
  },
]
