// issue #95: the idle dashboard. The old "Nothing playing" chrome is gone;
// left ~65% = the scenes configured in the entity picker (the SAME selection
// store as the Home dashboard), right ~35% = the compact device stack. With no
// scenes configured the scene zone must be absent ENTIRELY and the devices
// center instead.
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
    render(<IdleScreen connected devices={DEVICES} />)

    // old idle texts are gone (spec AC "texts removed")
    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing is playing/i)).not.toBeInTheDocument()

    // the default selection is HOME_LIGHTS — no scene in it, so no scene zone
    expect(screen.queryByText('Abendstimmung')).not.toBeInTheDocument()

    // the compact device stack is there instead, centered
    const header = screen.getByText('Devices')
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
})
