export const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:3678'

export const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.host}/events`
  : 'ws://127.0.0.1:3678/events'

// Home Assistant (Epic 9) — local REST API, long-lived access token
export const HOME_ASSISTANT_URL = 'http://10.10.1.104:8123'
export const HOME_ASSISTANT_TOKEN =
  '[REDACTED-ROTATED-HA-TOKEN]'
