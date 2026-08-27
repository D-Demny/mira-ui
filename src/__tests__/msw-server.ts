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
)
