import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HomeMenuView } from '../HomeMenuView'
import { server } from '@/__tests__/msw-server'
import { __resetHomeEntityStores } from '@/hooks/useHomeEntities'

describe('HomeMenuView', () => {
  beforeEach(() => {
    // ticket 9.3: the view now renders the user-selected entities (the
    // module-level selection/catalog/state stores) — reset them and the
    // persisted selection so every test starts from the default HOME_LIGHTS
    __resetHomeEntityStores()
    localStorage.clear()
  })

  it('renders all lights with their rooms and real-time status', async () => {
    render(<HomeMenuView />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
    expect(screen.getByText('Esstisch Hängelampe')).toBeInTheDocument()
    expect(screen.getByText('3er Deko')).toBeInTheDocument()
    expect(screen.getByText('Stehlampe Gold')).toBeInTheDocument()
    expect(screen.getAllByText('Esszimmer')).toHaveLength(3)
    expect(screen.getByText('Wohnzimmer')).toBeInTheDocument()
    expect(screen.getByText('Tischlampe')).toBeInTheDocument()
    expect(screen.getByText('Lampe 3er')).toBeInTheDocument()
    expect(screen.getByText('Treppenspot Treppe')).toBeInTheDocument()
    expect(screen.getByText('Treppenspot Mitte')).toBeInTheDocument()
    expect(screen.getByText('Treppenspot Tür')).toBeInTheDocument()
    expect(screen.getAllByText('Gaderobe')).toHaveLength(2)
    expect(screen.getAllByText('Flur Oben')).toHaveLength(3)
    await waitFor(() => expect(screen.getAllByText('OFF')).toHaveLength(9))
  })

  it('highlights the light by default', () => {
    render(<HomeMenuView />)
    const items = screen.getAllByRole('button')
    expect(items[0]).toHaveClass('focused')
    expect(items[1]).not.toHaveClass('focused')
  })

  it('moves focus down on a clockwise dial turn', () => {
    const { container } = render(<HomeMenuView />)
    const list = container.querySelector('ul') as HTMLElement
    fireEvent.wheel(list, { deltaX: -1 })
    const items = screen.getAllByRole('button')
    expect(items[1]).toHaveClass('focused')
    expect(items[0]).not.toHaveClass('focused')
  })

  it('toggles the light on tap and updates the badge', async () => {
    const toggled: string[] = []
    server.use(
      http.post('*/ha-api/services/light/toggle', async ({ request }) => {
        const body = (await request.json()) as { entity_id?: string }
        toggled.push(body.entity_id ?? '')
        return HttpResponse.json([
          { entity_id: body.entity_id, state: 'on', attributes: {} },
        ])
      }),
    )
    render(<HomeMenuView />)
    await waitFor(() => expect(screen.getAllByText('OFF')).toHaveLength(9))
    fireEvent.click(screen.getByText('3er Stehlampe Gold'))
    await waitFor(() => expect(screen.getByText('ON')).toBeInTheDocument())
    expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer'])
  })

  it('toggles each light independently', async () => {
    const toggled: string[] = []
    server.use(
      http.post('*/ha-api/services/light/toggle', async ({ request }) => {
        const body = (await request.json()) as { entity_id?: string }
        toggled.push(body.entity_id ?? '')
        return HttpResponse.json([
          { entity_id: body.entity_id, state: 'on', attributes: {} },
        ])
      }),
    )
    render(<HomeMenuView />)
    await waitFor(() => expect(screen.getAllByText('OFF')).toHaveLength(9))
    fireEvent.click(screen.getByText('Esstisch Hängelampe'))
    await waitFor(() => expect(screen.getByText('ON')).toBeInTheDocument())
    expect(toggled).toEqual(['light.esstisch_hangelampe_3er'])
    // the first light keeps its own state
    expect(screen.getAllByText('OFF')).toHaveLength(8)
  })

  it('shows an Offline badge when Home Assistant is unreachable', async () => {
    server.use(
      http.get(
        '*/ha-api/states/light.*',
        () => HttpResponse.json({ message: 'unauthorized' }, { status: 500 }),
      ),
    )
    render(<HomeMenuView />)
    await waitFor(() => expect(screen.getAllByText('Offline')).toHaveLength(9))
  })

  it('exposes every selected entity as an accessible button', () => {
    render(<HomeMenuView />)
    // ticket 9.3: the default selection is the nine HOME_LIGHTS — without the
    // picker callback there is no manage row (the old two placeholder rows are
    // gone, the list is the live selection)
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })

  // ticket 9.5: the picker opener moved out of this view (Einstellungen →
  // Home now) — the list is exactly the live selection, nothing appended
  it('renders no manage row / picker opener anymore (ticket 9.5)', () => {
    render(<HomeMenuView />)
    expect(screen.queryByText('Entitäten wählen')).not.toBeInTheDocument()
    expect(screen.queryByText('ausgewählt')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })
})
