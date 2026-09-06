import { describe, expect, it } from 'vitest'
import { ENTITY_ICON_PATHS, entityArt, entityDomainHue } from '../homeEntityArt'

// ticket 9.3 (Teil 2): deterministic SVG tile art for the Home carousel's
// entity cards — pure function, byte-stable for identical inputs

const DATA_URI_PREFIX = 'data:image/svg+xml;utf8,'

function decoded(art: string): string {
  expect(art.startsWith(DATA_URI_PREFIX)).toBe(true)
  return decodeURIComponent(art.slice(DATA_URI_PREFIX.length))
}

describe('homeEntityArt (ticket 9.3)', () => {
  it('is deterministic: identical inputs yield the identical string', () => {
    expect(entityArt('light', 'light.bade', true)).toBe(entityArt('light', 'light.bade', true))
    expect(entityArt('fan', 'seed-x', null)).toBe(entityArt('fan', 'seed-x', null))
    expect(entityArt('scene', 'scene.a', false)).toBe(entityArt('scene', 'scene.a', false))
    // different seed, same domain: still deterministic per input
    const a = entityArt('switch', 'switch.a', true)
    const b = entityArt('switch', 'switch.b', true)
    expect(entityArt('switch', 'switch.a', true)).toBe(a)
    expect(entityArt('switch', 'switch.b', true)).toBe(b)
  })

  it('returns a data-URI SVG string without NaN or empty output', () => {
    const art = entityArt('light', 'light.3er_stehlampe_gold_esszimmer', null)
    expect(art).toContain('data:image/svg+xml')
    expect(art.length).toBeGreaterThan(200)
    expect(art).not.toContain('NaN')
    const svg = decoded(art)
    expect(svg).toContain('<svg')
    expect(svg).toContain('hsl(')
    expect(svg).toContain('<path d="')
  })

  it('active true / false / null produce three distinct strings', () => {
    const on = entityArt('light', 'seed', true)
    const off = entityArt('light', 'seed', false)
    const unknown = entityArt('light', 'seed', null)
    expect(on).not.toBe(off)
    expect(on).not.toBe(unknown)
    expect(off).not.toBe(unknown)
  })

  it('all domains + manage + unknown produce valid data-URI strings', () => {
    for (const domain of [...Object.keys(ENTITY_ICON_PATHS), 'sensor', '']) {
      const art = entityArt(domain, 'seed', true)
      expect(art.startsWith(DATA_URI_PREFIX)).toBe(true)
      expect(art).not.toContain('NaN')
      const svg = decoded(art)
      expect(svg).toContain('width="170"')
      expect(svg).toContain('hsl(')
    }
  })

  it('seeds vary the tile inside the domain (different seeds, different tiles)', () => {
    // the FNV offset spans the domain hue window — with 1000 buckets a couple
    // of fixed seeds are guaranteed to land apart
    const tiles = new Set<string>()
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      tiles.add(entityArt('media_player', `media_player.${seed}`, null))
    }
    expect(tiles.size).toBeGreaterThan(1)
  })

  it('entityDomainHue reports the domain midpoint and 200 for unknown domains', () => {
    expect(entityDomainHue('light')).toBe(40)
    expect(entityDomainHue('switch')).toBe(175)
    expect(entityDomainHue('media_player')).toBe(335)
    expect(entityDomainHue('manage')).toBe(28) // (20+35)/2 = 27.5 → rounded
    expect(entityDomainHue('sensor')).toBe(200)
    expect(entityDomainHue('')).toBe(200)
  })
})
