export const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:3678'

export const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.host}/events`
  : 'ws://127.0.0.1:3678/events'
