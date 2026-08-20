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
  }
}
