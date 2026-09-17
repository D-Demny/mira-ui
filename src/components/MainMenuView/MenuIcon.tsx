import type { MenuIconName } from './mockData'

interface MenuIconProps {
  name: MenuIconName
  size?: number
}

export function MenuIcon({ name, size = 24 }: MenuIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'playlists':
      return (
        <svg {...common}>
          <path d="M4 6h12" />
          <path d="M4 11h12" />
          <path d="M4 16h7" />
          <path d="M15 14.5v6l5-3z" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'recent':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
        </svg>
      )
    // issue #57 (T3): home-dashboard scene tiles — same stroke conventions as
    // the set above (24x24 viewBox, strokeWidth 2, round caps/joins, no fills)
    case 'bulb':
      return (
        <svg {...common}>
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </svg>
      )
    case 'candle':
      return (
        <svg {...common}>
          <path d="M12 3c1.9 1.7 2.8 3.1 2.8 4.5a2.8 2.8 0 0 1-5.6 0C9.2 6.1 10.1 4.7 12 3z" />
          <path d="M12 10.5v1.5" />
          <rect x="8" y="12.5" width="8" height="8.5" rx="1.5" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )
    // issue #57 (T4): home-dashboard light tiles — same stroke conventions as
    // the set above (24x24 viewBox, strokeWidth 2, round caps/joins, no fills)
    case 'pendant':
      return (
        <svg {...common}>
          {/* hanging lamp: ceiling line + cord + shade trapezoid + bulb dot */}
          <path d="M6 3h12" />
          <path d="M12 3v7" />
          <path d="M8 10h8l2.5 6h-13L8 10" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      )
    case 'lamp':
      return (
        <svg {...common}>
          {/* floor lamp: shade trapezoid + stem + base */}
          <path d="M9 3h6l1.5 6h-9L9 3" />
          <path d="M12 9v10" />
          <path d="M8 19.5h8" />
        </svg>
      )
    case 'spot':
      return (
        <svg {...common}>
          {/* ceiling downlight: ceiling line + can cup + downward light rays */}
          <path d="M7 4h10" />
          <path d="M9 4v3l1.5 2h3L15 7V4" />
          <path d="M12 10.5v3.5" />
          <path d="M8 10l-1.5 3" />
          <path d="M16 10l1.5 3" />
        </svg>
      )
    // issue #57 (T5): home-dashboard cover columns — same stroke conventions
    // as the set above (24x24 viewBox, strokeWidth 2, round caps/joins, no
    // fills). Roller blind: outer frame + three horizontal slats.
    case 'blinds':
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
          <path d="M4 9h16" />
          <path d="M4 13.5h16" />
          <path d="M4 18h16" />
        </svg>
      )
  }
}
