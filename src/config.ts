export const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:3678'

export const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.host}/events`
  : 'ws://127.0.0.1:3678/events'

// Home Assistant (Epic 9) — via the daemon's /ha-api/ CORS proxy
// (HA itself refuses the UI origin; the daemon forwards + injects the token
// configured in mira-daemon config.yml)
export const HOME_ASSISTANT_URL = `${API_BASE}/ha-api`
