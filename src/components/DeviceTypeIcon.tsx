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
    'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM12 7.75a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 1 1 0-3.5zM12 12.55a3.05 3.05 0 1 1 0 6.1 3.05 3.05 0 1 1 0-6.1z',
  // issue #127: two speaker cabinets side by side for multi-room groups
  // (a Spotify "group" entry such as the "Alle" all-speakers group or a
  // two-device room group)
  multiSpeaker:
    'M4 4h5.2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 1h5.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7.8 8a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 1 1 2.4 0zM8.6 13.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM14.8 4h5.2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H14.8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 1h5.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H14.8a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM18.6 8a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 1 1 2.4 0zM19.4 13.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0z',
} as const

function deviceIconKey(type: string): keyof typeof ICON_PATHS {
  switch (type) {
    case 'SMARTPHONE':
    case 'TABLET':
      return 'phone'
    case 'COMPUTER':
    case 'CHROMEBOOK':
      return 'pc'
    // issue #127: multi-room groups (Web API type "group", e.g. the "Alle"
    // all-speakers group) get the double-speaker glyph
    case 'GROUP':
      return 'multiSpeaker'
    // issue #127: AVR covers the WiiM Amp / Pro Plus category — streamer-amps
    // each driving a speaker pair, so they render as regular speakers (also
    // the fall-through default below)
    case 'AVR':
      return 'speaker'
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
