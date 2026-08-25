import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsList } from '../SettingsList'
import type { SettingsRow } from '../SettingsList'

// bug36: the 'Default Device' (open-link) row must be as tall as the slider
// rows. The height fix lives in SettingsList.module.scss (.row min-height),
// which jsdom does not render — so these tests pin the row DOM structure
// (unchanged by the fix) plus the shared min-height in the stylesheet itself
const rows: SettingsRow[] = [
  { id: 'set-default-device', title: 'Default Device', value: 'None', kind: 'open-link' },
  {
    id: 'set-display',
    title: 'Display Size',
    value: '100%',
    kind: 'slider',
    slider: {
      ariaLabel: 'Display size',
      value: 100,
      min: 50,
      max: 115,
      step: 5,
      format: (v) => `${v}%`,
    },
  },
  {
    id: 'set-brightness',
    title: 'Brightness',
    value: 'Auto',
    kind: 'slider',
    autoToggle: true,
    autoOn: true,
    slider: {
      ariaLabel: 'Brightness',
      value: 5,
      min: 1,
      max: 10,
      step: 1,
      format: (v) => `${v * 10}%`,
    },
  },
]

function renderList() {
  render(
    <SettingsList
      rows={rows}
      focusedIndex={0}
      onRowTap={() => {}}
      onSliderChange={() => {}}
      onToggleAuto={() => {}}
    />,
  )
  // direct children of the list are exactly the rows (no wrapper layers)
  const list = screen.getByLabelText('Einstellungen')
  return Array.from(list.children)
}

describe('bug36: settings row height & structure', () => {
  it('renders every row in the shared row container (slider and plain rows alike)', () => {
    const rowEls = renderList()
    expect(rowEls).toHaveLength(3)
    for (const el of rowEls) {
      expect(el.className).toContain('row')
    }
    // the focused row stays the only interactive one
    expect(rowEls[0]).toHaveAttribute('role', 'button')
    expect(rowEls[0].className).toContain('rowFocused')
    expect(rowEls[1]).not.toHaveAttribute('role', 'button')
    expect(rowEls[2]).not.toHaveAttribute('role', 'button')
  })

  it('keeps the row structure: slider rows hold a NotchedSlider, plain rows do not', () => {
    const [defaultRow, displayRow, brightnessRow] = renderList()

    // open-link row: chevron icon slot, title + value, no slider
    expect(defaultRow.querySelector('.chevron')).not.toBeNull()
    expect(defaultRow.querySelector('[role="slider"]')).toBeNull()
    expect(defaultRow.textContent).toContain('Default Device')
    expect(defaultRow.textContent).toContain('None')

    // slider row: chevron slot + NotchedSlider below the head
    expect(displayRow.querySelector('.chevron')).not.toBeNull()
    const slider = displayRow.querySelector('[role="slider"]')
    expect(slider).not.toBeNull()
    expect(slider).toHaveAttribute('aria-valuenow', '100')

    // brightness row: auto chip instead of a chevron, plus its slider
    expect(brightnessRow.querySelector('.chevron')).toBeNull()
    expect(brightnessRow.querySelector('[role="switch"]')).not.toBeNull()
    expect(brightnessRow.querySelector('[role="slider"]')).not.toBeNull()
  })

  it('pins the shared row min-height in the stylesheet', () => {
    // read from disk: vitest's CSS pipeline (css.modules in vitest.config.ts)
    // intercepts .scss files before ?raw, so a raw import yields no source
    const scss = readFileSync(
      'src/components/MainMenuView/SettingsList.module.scss',
      'utf8',
    )
    const rowRule = scss.match(/\.row \{([^}]*)\}/)
    expect(rowRule).not.toBeNull()
    // measured slider row: padding 12×2 + title line (16px × 1.4) + rowMain
    // gap 8 + NotchedSlider 40 = 94.4px, rounded to the 4px grid
    expect(rowRule![1]).toContain('min-height: 96px;')
  })
})
