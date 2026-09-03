import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const server = setupServer(
  http.get('*/observer/status', () => HttpResponse.json({ active: false, message: 'no session' })),
  http.get('*/auth/status', () =>
    HttpResponse.json({ required: false, url: null, loading: false }),
  ),
  http.get('*/bluetooth/pairing', () => HttpResponse.json({ pending: false })),
  http.get('*/bluetooth/known', () => HttpResponse.json([])),
  http.post('*/bluetooth/discover/*', () => HttpResponse.json({})),
  http.post('*/bluetooth/network/*', () => HttpResponse.json({})),
  // the settings store PUTs on a 400ms debounce; without these any test that lets a
  // timer run trips onUnhandledRequest: 'error' with a confusing failure
  http.get('*/settings', () => HttpResponse.json({ v: 1 })),
  http.put('*/settings', () => HttpResponse.json({ ok: true })),
  // Home Assistant (Epic 9) — default: light off, toggle turns it on
  // (the UI talks to the daemon's /ha-api/ CORS proxy, not to HA directly)
  // bug34: the main menu fetches every configured light — echo the entity id
  // back from the requested path so the mock behaves like the real proxy
  http.get('*/ha-api/states/light.*', ({ request }) => {
    const path = new URL(request.url).pathname
    const entityId = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    return HttpResponse.json({
      entity_id: entityId,
      state: 'off',
      attributes: {},
    })
  }),
  http.post('*/ha-api/services/light/toggle', async ({ request }) => {
    const body = (await request.json()) as { entity_id?: string }
    return HttpResponse.json([
      {
        entity_id: body.entity_id ?? 'light.3er_stehlampe_gold_esszimmer',
        state: 'on',
        attributes: {},
      },
    ])
  }),
  // bug46: light.turn_on (brightness_pct / color_temp_kelvin) — like the
  // toggle handler, echo the requested entity back so the mock behaves like
  // the generic /ha-api/ service proxy
  http.post('*/ha-api/services/light/turn_on', async ({ request }) => {
    const body = (await request.json()) as { entity_id?: string }
    return HttpResponse.json([
      {
        entity_id: body.entity_id ?? 'light.3er_stehlampe_gold_esszimmer',
        state: 'on',
        attributes: {},
      },
    ])
  }),
  // Epic 10: Pi helper-server capabilities (192.168.7.1:8080) — default is
  // unreachable, so the app runs in standalone mode unless a test opts in
  http.get('*/api/v1/capabilities', () => HttpResponse.error()),
  // Epic 10 task 4: the daemon's Pi provisioning endpoints — defaults mirror
  // the daemon's behavior (503 = handler not wired / old build; status is
  // idle). Tests opt in with server.use
  http.post('*/api/setup-pi', () => new HttpResponse(null, { status: 503 })),
  http.get('*/api/setup-pi/status', () => HttpResponse.json({ state: 'idle' })),
  // Epic 10 ticket10-4: the daemon's Pi auto-reconnect status — the default
  // mirrors an OLD daemon (503 = handler not wired) so the live session
  // status line stays hidden unless a test opts in (consistent with the
  // POST /api/setup-pi default)
  http.get('*/api/pi/status', () => new HttpResponse(null, { status: 503 })),
  // Epic 10 ticket10-5: the daemon's Pi profile deletion — the default
  // mirrors an OLD daemon (503 = handler not wired, ticket10-5B) so the
  // profile removal degrades to a store-only deletion unless a test opts in
  http.delete('*/api/pi/profile', () => new HttpResponse(null, { status: 503 })),
  // Epic 10 ticket10-6: the daemon's USB-tethering endpoints — the defaults
  // mirror an OLD daemon (503 = handler not wired, ticket10-6A) so the
  // tethering wizard degrades to a clear error unless a test opts in; the
  // status default is the idle shape (both ok-flags false, like the
  // daemon's fresh in-memory job)
  http.post('*/api/pi/tethering', () => new HttpResponse(null, { status: 503 })),
  http.get('*/api/pi/tethering/status', () =>
    HttpResponse.json({ state: 'idle', tethering_ok: false, internet_ok: false }),
  ),
)
