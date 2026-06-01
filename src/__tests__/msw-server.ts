import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const server = setupServer(
  http.get('*/observer/status', () => HttpResponse.json({ active: false, message: 'no session' })),
  http.get('*/auth/status', () =>
    HttpResponse.json({ required: false, url: null, loading: false }),
  ),
  http.get('*/bluetooth/pairing', () => HttpResponse.json({ pending: false })),
  http.post('*/bluetooth/discover/*', () => HttpResponse.json({})),
  http.post('*/bluetooth/network/*', () => HttpResponse.json({})),
)
