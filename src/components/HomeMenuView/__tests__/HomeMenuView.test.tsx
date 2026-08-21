import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HomeMenuView } from '../HomeMenuView'
import { server } from '@/__tests__/msw-server'
import { clearCache } from '@/hooks/usePlaylists'

describe('HomeMenuView', () => {
  beforeEach(() => {
    clearCache()
  })

  it('renders the light with its real-time status', async () => {
    render(<HomeMenuView />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('3er Stehlampe Gold')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('OFF')).toBeInTheDocument())
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
      http.post('*/api/services/light/toggle', async ({ request }) => {
        const body = (await request.json()) as { entity_id?: string }
        toggled.push(body.entity_id ?? '')
        return HttpResponse.json([
          { entity_id: body.entity_id, state: 'on', attributes: {} },
        ])
      }),
    )
    render(<HomeMenuView />)
    await waitFor(() => expect(screen.getByText('OFF')).toBeInTheDocument())
    fireEvent.click(screen.getByText('3er Stehlampe Gold'))
    await waitFor(() => expect(screen.getByText('ON')).toBeInTheDocument())
    expect(toggled).toEqual(['light.3er_stehlampe_gold_esszimmer'])
  })

  it('shows an Offline badge when Home Assistant is unreachable', async () => {
    server.use(
      http.get(
        '*/api/states/light.*',
        () => HttpResponse.json({ message: 'unauthorized' }, { status: 500 }),
      ),
    )
    render(<HomeMenuView />)
    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument())
  })

  it('exposes every home item as an accessible button', () => {
    render(<HomeMenuView />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
})
