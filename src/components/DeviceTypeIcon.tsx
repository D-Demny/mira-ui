import { memo } from 'react'

// issue #92: shared per-type icon for Connect devices, used by the inline
// device list (DevicePicker) and the "Ausgabegeräte" modal (OutputPicker).
// issue #109: the old `generic` glyph was a bare rounded rectangle — it read
// as an unrefined checkbox box next to the device name. Unknown types
// (mostly speakers, e.g. WiiM) now get a proper speaker cabinet with a
// tweeter and a woofer instead.
const ICON_PATHS = {
  phone:
    'M5 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zm3-1a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM13.25 16.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  pc: 'M0 21a1 1 0 0 1 1-1h22a1 1 0 1 1 0 2H1a1 1 0 0 1-1-1M3 5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm3-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z',
  // issue #109: speaker cabinet (the old `generic` rectangle outline) plus a
  // small tweeter circle and a larger woofer circle inside it — under the
  // evenodd fill rule the circles render solid inside the hollow cabinet
  speaker:
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM12 7.75a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 1 1 0-3.5zM12 12.55a3.05 3.05 0 1 1 0 6.1 3.05 3.05 0 1 1 0-6.1z',
} as const

function deviceIconKey(type: string): keyof typeof ICON_PATHS {
  switch (type) {
    case 'SMARTPHONE':
    case 'TABLET':
      return 'phone'
    case 'COMPUTER':
    case 'CHROMEBOOK':
      return 'pc'
    default:
      return 'speaker'
  }
}

export interface DeviceTypeIconProps {
  type: string
  size?: number
}

function DeviceTypeIconImpl({ type, size = 22 }: DeviceTypeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden
    >
      <path d={ICON_PATHS[deviceIconKey(type)]} />
    </svg>
  )
}

export const DeviceTypeIcon = memo(DeviceTypeIconImpl)
