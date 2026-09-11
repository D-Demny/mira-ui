import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'

// ticket 9.3: default catalog fixture — the 9 curated lights (friendly_names
// MUST stay in sync with the HOME_LIGHTS labels — the MainMenuView tests
// expect e.g. '3er Stehlampe Gold'), one entity per other controllable
// domain, plus a sensor that the catalog filter must drop.
// bug55: shaped like the REAL HA GET /api/states response — a JSON ARRAY of
// {entity_id, state, attributes} entries (NOT an entity_id-keyed map)
function homeEntityCatalogFixture(): Array<{
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}> {
  const body: Array<{
    entity_id: string
    state: string
    attributes: Record<string, unknown>
  }> = []
  for (const light of HOME_LIGHTS) {
    body.push({
      entity_id: light.entityId,
      state: 'off',
      attributes: { friendly_name: light.label, supported_color_modes: ['color_temp', 'xy'] },
    })
  }
  body.push({
    entity_id: 'switch.wasserpumpe',
    state: 'off',
    attributes: { friendly_name: 'Wasserpumpe' },
  })
  body.push({
    entity_id: 'scene.abendstimmung',
    state: 'none',
    attributes: { friendly_name: 'Abendstimmung' },
  })
  body.push({
    entity_id: 'fan.wohnzimmer',
    state: 'off',
    attributes: { friendly_name: 'Lüfter Wohnzimmer' },
  })
  body.push({
    entity_id: 'media_player.wohnzimmer',
    state: 'idle',
    attributes: { friendly_name: 'TV Wohnzimmer' },
  })
  body.push({
    entity_id: 'cover.garage',
    state: 'closed',
    attributes: { friendly_name: 'Garagentor' },
  })
  body.push({
    entity_id: 'input_boolean.nachtmodus',
    state: 'off',
    attributes: { friendly_name: 'Nachtmodus' },
  })
  // must be filtered out by the catalog (not a controllable domain)
  body.push({
    entity_id: 'sensor.temperatur_wohnzimmer',
    state: '21.5',
    attributes: { friendly_name: 'Temperatur Wohnzimmer' },
  })
  return body
}

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
  // bug56: light.turn_off (the 0 % slider commit) — echo the requested entity
  // back with state 'off'. Declared AFTER light/turn_on and BEFORE the generic
  // services catch-all below so it keeps first-match precedence (MSW takes the
  // first matching handler in registration order)
  http.post('*/ha-api/services/light/turn_off', async ({ request }) => {
    const body = (await request.json()) as { entity_id?: string }
    return HttpResponse.json([
      {
        entity_id: body.entity_id ?? 'light.3er_stehlampe_gold_esszimmer',
        state: 'off',
        attributes: {},
      },
    ])
  }),
  // ticket 9.3: the entity catalog (GET /states) — declared AFTER the specific
  // light.* handler above so that one keeps first-match precedence (MSW takes
  // the first matching handler)
  http.get('*/ha-api/states', () => HttpResponse.json(homeEntityCatalogFixture())),
  // ticket 9.3: generic service proxy catch-all — echoes the requested entity
  // back with state 'on', like the real /ha-api/ proxy. Declared AFTER the
  // specific light/toggle + light/turn_on handlers above so those keep
  // precedence (MSW first-match wins)
  http.post('*/ha-api/services/*', async ({ request }) => {
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
  // ticket 9.4: the daemon's HA login/test endpoints — the defaults mirror an
  // OLD daemon WITHOUT the endpoints (ticket 9.4 design §5 compat matrix:
  // new UI + old daemon): the Go mux answers the unknown POST paths with its
  // plain-text 404. The UI clients (src/api/haSettings.ts) map any non-JSON
  // body to the HaSettingsApiError code 'not_available' ("not available
  // (daemon outdated?)"), so the app degrades to a clear error line unless a
  // test opts in with server.use
  http.post('*/api/ha/login', () => new HttpResponse('404 page not found', { status: 404 })),
  http.post('*/api/ha/test', () => new HttpResponse('404 page not found', { status: 404 })),
)
