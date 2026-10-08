// issue #95: the idle dashboard. The old "Nothing playing" chrome is gone;
// issue #97: left ~34% = the compact device stack, right ~62% = the scenes
// configured in the entity picker (the SAME selection store as the Home
// dashboard), with a wide gap between the zones. With no scenes configured
// the scene zone must be absent ENTIRELY and the devices center instead.
import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { IdleScreen } from '../IdleScreen'
import { DevicePicker } from '@/components/DevicePicker'
import type { ConnectDevice } from '@/api/types'
import { __resetHomeEntityStores, SELECTION_LS_KEY } from '@/hooks/useHomeEntities'
import { HOME_LIGHTS } from '@/hooks/useHomeLight'

const DEVICES: ConnectDevice[] = [
  {
    id: 'dev-1',
    name: 'Office PC',
    type: 'source',
    volume: 80,
    volume_steps: 16,
    volume_disabled: false,
    is_active: true,
    is_offline: false,
    can_transfer: true,
  },
  {
    id: 'dev-2',
    name: 'Büro Speaker',
    type: 'sink',
    volume: 50,
    volume_steps: 16,
    volume_disabled: false,
    is_active: false,
    is_offline: false,
    can_transfer: true,
  },
]

describe('IdleScreen (issue #95 idle dashboard)', () => {
  beforeEach(() => {
    __resetHomeEntityStores()
    localStorage.clear()
  })

  it('shows the device stack without any scene zone when no scenes are configured', () => {
    const { container } = render(<IdleScreen connected devices={DEVICES} />)

    // old idle texts are gone (spec AC "texts removed")
    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing is playing/i)).not.toBeInTheDocument()

    // the default selection is HOME_LIGHTS — no scene in it, so no scene zone
    expect(screen.queryByText('Abendstimmung')).not.toBeInTheDocument()
    // issue #102: without scenes the "Beleuchtung" header is gone with the
    // zone, and the content layer is not in split layout
    expect(screen.queryByText('Beleuchtung')).not.toBeInTheDocument()
    const content = container.querySelector('[class*="content"]')!
    expect(content.className).not.toMatch(/split/)
    // the compact device stack is there instead, centered. issue #98: its
    // header now reads "Spotify abspielen" (mixed case, no CSS uppercasing)
    const header = screen.getByText('Spotify abspielen')
    expect(header).toBeInTheDocument()
  })

  it('hides offline / non-transferrable devices from being selectable', () => {
    render(<IdleScreen connected devices={DEVICES} />)
    expect(screen.getByText('Office PC')).toBeInTheDocument()
    expect(screen.getByText('Büro Speaker')).toBeInTheDocument()
  })

  it('respects defaultDeviceId (only the pinned device is listed)', () => {
    render(<IdleScreen connected devices={DEVICES} defaultDeviceId="dev-2" />)
    expect(screen.queryByText('Office PC')).not.toBeInTheDocument()
    expect(screen.getByText('Büro Speaker')).toBeInTheDocument()
  })

  it('renders a scene tile per configured scene and tapping it sends scene/turn_on', async () => {
    localStorage.setItem(
      SELECTION_LS_KEY,
      JSON.stringify([...HOME_LIGHTS.map((light) => light.entityId), 'scene.abendstimmung']),
    )
    const turnedOn: string[] = []
    server.use(
      http.get('*/ha-api/states/scene.abendstimmung', () =>
        HttpResponse.json({
          entity_id: 'scene.abendstimmung',
          state: 'none',
          attributes: { friendly_name: 'Abendstimmung' },
        }),
      ),
      http.post('*/ha-api/services/scene/turn_on', async ({ request }) => {
        const body = (await request.json()) as { entity_id?: string }
        turnedOn.push(body.entity_id ?? '')
        return HttpResponse.json([{ entity_id: body.entity_id, state: 'none', attributes: {} }])
      }),
    )

    render(<IdleScreen connected devices={DEVICES} />)

    const tile = await screen.findByText('Abendstimmung')
    expect(tile).toBeInTheDocument()

    fireEvent.click(tile)

    // the tap actuates through the shared entity store (scene/turn_on)
    await waitFor(() => {
      expect(turnedOn).toEqual(['scene.abendstimmung'])
    })
  })

  it('shows the reconnecting status only when disconnected', () => {
    const { rerender } = render(<IdleScreen connected devices={DEVICES} />)
    expect(screen.queryByText('Reconnecting...')).not.toBeInTheDocument()

    rerender(<IdleScreen connected={false} devices={DEVICES} />)
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument()
  })

  it('DevicePicker compact prop narrows the card (class applied)', () => {
    const { container } = render(<DevicePicker devices={DEVICES} compact />)
    // the compact modifier must reach the root card element
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/compact/)
  })

  it('issue #97: the device stack sits LEFT of (before) the scene grid in DOM order', async () => {
    localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(['scene.abendstimmung']))
    server.use(
      http.get('*/ha-api/states/scene.abendstimmung', () =>
        HttpResponse.json({
          entity_id: 'scene.abendstimmung',
          state: 'none',
          attributes: { friendly_name: 'Abendstimmung' },
        }),
      ),
    )

    const { container } = render(<IdleScreen connected devices={DEVICES} />)

    await screen.findByText('Abendstimmung')
    const deviceCol = container.querySelector('[class*="deviceCol"]')
    const sceneGrid = container.querySelector('[class*="sceneGrid"]')
    expect(deviceCol).toBeTruthy()
    expect(sceneGrid).toBeTruthy()
    // DOM order is left-to-right: the device column comes FIRST
    expect(
      sceneGrid!.compareDocumentPosition(deviceCol!) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  it('issue #102: the scene zone carries its "Beleuchtung" header above the tiles', async () => {
    localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(['scene.abendstimmung']))
    server.use(
      http.get('*/ha-api/states/scene.abendstimmung', () =>
        HttpResponse.json({
          entity_id: 'scene.abendstimmung',
          state: 'none',
          attributes: { friendly_name: 'Abendstimmung' },
        }),
      ),
    )

    const { container } = render(<IdleScreen connected devices={DEVICES} />)

    await screen.findByText('Abendstimmung')

    // the section header sits in the scene column, BEFORE the tile grid
    const sceneCol = container.querySelector('[class*="sceneCol"]')
    expect(sceneCol).toBeTruthy()
    const header = screen.getByText('Beleuchtung')
    expect(header.parentElement === sceneCol).toBe(true)
    const grid = container.querySelector('[class*="sceneGrid"]')!
    // header comes BEFORE the grid (from the grid's view it PRECEDES it)
    expect(grid.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // the content layer switches to the strict 1/3 / 2/3 split
    const content = container.querySelector('[class*="content"]')!
    expect(content.className).toMatch(/split/)
    // both zone headers exist side by side, exactly as written
    expect(screen.getByText('Spotify abspielen')).toBeInTheDocument()
  })

  it.each([
    [1, 'minmax(0, 1fr)', 'minmax(0, 1fr)'],
    [2, 'repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)'],
    [3, 'repeat(2, minmax(0, 1fr))', 'repeat(2, minmax(0, 1fr))'],
    [4, 'repeat(2, minmax(0, 1fr))', 'repeat(2, minmax(0, 1fr))'],
  ])(
    'issue #103: the scene grid template scales with the count (%i scenes)',
    async (count, cols, rows) => {
      const ids = ['scene.kino', 'scene.abendstimmung', 'scene.fokus', 'scene.nacht'].slice(
        0,
        count,
      )
      localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(ids))
      server.use(
        ...ids.map((id) =>
          http.get(`*/ha-api/states/${id}`, () =>
            HttpResponse.json({
              entity_id: id,
              state: 'none',
              attributes: { friendly_name: id.split('.').pop() },
            }),
          ),
        ),
      )

      const { container } = render(<IdleScreen connected devices={DEVICES} />)
      const firstId = ids[0].split('.').pop()!
      await screen.findByText(firstId.charAt(0).toUpperCase() + firstId.slice(1))

      const grid = container.querySelector('[class*="sceneGrid"]') as HTMLElement
      expect(grid.style.gridTemplateColumns).toBe(cols)
      expect(grid.style.gridTemplateRows).toBe(rows)
    },
  )

  it('issue #103: with three scenes the third tile spans the wide bottom row', async () => {
    const ids = ['scene.kino', 'scene.abendstimmung', 'scene.fokus']
    localStorage.setItem(SELECTION_LS_KEY, JSON.stringify(ids))
    server.use(
      ...ids.map((id) =>
        http.get(`*/ha-api/states/${id}`, () =>
          HttpResponse.json({
            entity_id: id,
            state: 'none',
            attributes: { friendly_name: id.split('.').pop() },
          }),
        ),
      ),
    )

    const { container } = render(<IdleScreen connected devices={DEVICES} />)
    await screen.findByText('Kino')

    const tiles = container.querySelectorAll('[class*="sceneTile"]')
    expect(tiles.length).toBe(3)
    expect((tiles[2] as HTMLElement).style.gridColumn).toBe('1 / -1')
    expect((tiles[0] as HTMLElement).style.gridColumn).toBe('')
  })

  it('issue #99: blurred art background when artUrl is given, plain gradient otherwise', () => {
    const { container, rerender } = render(
      <IdleScreen connected devices={DEVICES} artUrl="http://cdn/cover.jpg" />,
    )
    // exactly one layer carries the art as an inline background-image
    const artLayers = [...container.querySelectorAll('div')].filter((el) =>
      el.style.backgroundImage.includes('cover.jpg'),
    )
    expect(artLayers.length).toBe(1)

    // no known art → the plain ambient gradient stands in (no inline art at all)
    rerender(<IdleScreen connected devices={DEVICES} />)
    const withInlineBg = [...container.querySelectorAll('div')].filter(
      (el) => el.style.backgroundImage !== '',
    )
    expect(withInlineBg.length).toBe(0)
  })
})
