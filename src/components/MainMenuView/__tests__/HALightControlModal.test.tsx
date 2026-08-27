import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { HALightControlModal } from '../HALightControlModal'
import { server } from '@/__tests__/msw-server'
import { __resetHomeLightStore } from '@/hooks/useHomeLight'
import { ListFocusContext } from '@/navigation/listFocusContext'
import type { ListFocusEntry } from '@/navigation/listFocusContext'

// bug46: the dimmable HA light control popup — brightness slider + 4 kelvin
// presets, dial navigation via the list focus stack (bug31), optimistic HA
// writes with throttle / revert

const ENTITY = 'light.3er_stehlampe_gold_esszimmer'

// all 9 configured lights report these capabilities (measured live):
// supported_color_modes ["color_temp", "xy"], 2202–6535 K
const DIMMABLE_ATTRS = {
  supported_color_modes: ['color_temp', 'xy'],
  min_color_temp_kelvin: 2202,
  max_color_temp_kelvin: 6535,
}

function seedEntity(state: string, brightness: number | null) {
  server.use(
    http.get(`*/ha-api/states/${ENTITY}`, () =>
      HttpResponse.json({
        entity_id: ENTITY,
        state,
        attributes: {
          ...DIMMABLE_ATTRS,
          ...(brightness != null ? { brightness } : {}),
        },
      }),
    ),
  )
}

function makeCallsRecorder() {
  const calls: Record<string, unknown>[] = []
  server.use(
    http.post('*/ha-api/services/light/turn_on', async ({ request }) => {
      calls.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json([{ entity_id: ENTITY, state: 'on', attributes: {} }])
    }),
  )
  return calls
}

function wheel(deltaX: number) {
  act(() => {
    ListFocusContext.entry.onWheel({
      deltaX,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent)
  })
}

function confirmDial() {
  act(() => {
    ListFocusContext.entry.onConfirm?.()
  })
}

function pressBack() {
  act(() => {
    ListFocusContext.entry.onBack?.()
  })
}

function renderModal(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <HALightControlModal entityId={ENTITY} label="3er Stehlampe Gold" onClose={onClose} />,
    ),
  }
}

describe('HALightControlModal (bug46)', () => {
  beforeEach(() => {
    __resetHomeLightStore()
  })

  afterEach(() => {
    __resetHomeLightStore()
    ListFocusContext.setActive(null)
  })

  it('renders the header (entity name + current brightness), slider and 4 kelvin presets', async () => {
    seedEntity('on', 117) // → 46 %
    renderModal()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await screen.findByText('3er Stehlampe Gold')
    await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '46')
    for (const label of ['5600 K', '4500 K', '3500 K', '2200 K']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('shows an em-dash for the brightness of an off light', async () => {
    seedEntity('off', null)
    renderModal()

    await screen.findByText('3er Stehlampe Gold')
    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument())
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
  })

  it('registers a focus entry on the list focus stack while open (bug31)', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
    ListFocusContext.setActive(parent)
    seedEntity('off', null)
    renderModal()

    expect(ListFocusContext.entry).not.toBe(parent)
    expect(ListFocusContext.entry.active).toBe(true)
  })

  describe('dial navigation', () => {
    it('rotation on the slider adjusts brightness by 5 % steps (optimistic)', async () => {
      seedEntity('on', 117) // 46 %
      const { onClose } = renderModal()
      expect(onClose).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())

      wheel(-10) // clockwise = down = increase
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '51')
      expect(screen.getByText('51%')).toBeInTheDocument()

      wheel(-10)
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '56')

      wheel(10) // counter-clockwise = decrease
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '51')
    })

    it('clamps at 0 % and keeps the focus on the slider row', async () => {
      seedEntity('on', 5) // → 2 %
      const { container } = renderModal()
      await waitFor(() =>
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2'),
      )

      wheel(10) // 2 - 5 → clamped to 0
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
      wheel(10) // still at the lower bound
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
      // the slider row (item 0) is still the focused item
      const sliderRow = screen.getByRole('button', { name: 'Brightness' })
      expect(sliderRow).toHaveClass('focused')
      expect(container.querySelectorAll('.preset.focused')).toHaveLength(0)
    })

    it('at 100 % the next rotation lands on the first preset (bug25/35 boundary convention)', async () => {
      seedEntity('on', 255) // 100 %
      renderModal()
      await waitFor(() =>
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100'),
      )

      wheel(-10) // at the upper bound → focus moves to preset 1 (5600 K)
      expect(screen.getByRole('button', { name: '5600 K' })).toHaveClass('focused')

      wheel(-10)
      expect(screen.getByRole('button', { name: '4500 K' })).toHaveClass('focused')
      wheel(-10)
      expect(screen.getByRole('button', { name: '3500 K' })).toHaveClass('focused')
      wheel(-10)
      expect(screen.getByRole('button', { name: '2200 K' })).toHaveClass('focused')
      wheel(-10) // clamped at the last preset
      expect(screen.getByRole('button', { name: '2200 K' })).toHaveClass('focused')

      // back up the preset row until the slider row is focused again
      wheel(10)
      expect(screen.getByRole('button', { name: '3500 K' })).toHaveClass('focused')
      wheel(10)
      expect(screen.getByRole('button', { name: '4500 K' })).toHaveClass('focused')
      wheel(10)
      expect(screen.getByRole('button', { name: '5600 K' })).toHaveClass('focused')
      wheel(10)
      expect(screen.getByRole('button', { name: 'Brightness' })).toHaveClass('focused')
    })
  })

  describe('dial press (confirm)', () => {
    it('confirms a preset with exactly { entity_id, color_temp_kelvin }', async () => {
      const calls = makeCallsRecorder()
      seedEntity('on', 255)
      renderModal()
      await waitFor(() =>
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100'),
      )

      wheel(-10) // focus 5600 K
      confirmDial()

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ entity_id: ENTITY, color_temp_kelvin: 5600 })
      // the selection highlight follows the confirmed preset
      expect(screen.getByRole('button', { name: '5600 K' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('confirms the second preset with 4500 kelvin', async () => {
      const calls = makeCallsRecorder()
      seedEntity('on', 255)
      renderModal()
      await waitFor(() =>
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100'),
      )

      wheel(-10)
      wheel(-10) // focus 4500 K
      confirmDial()

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ entity_id: ENTITY, color_temp_kelvin: 4500 })
    })

    it('confirms the slider row with exactly { entity_id, brightness_pct }', async () => {
      const calls = makeCallsRecorder()
      seedEntity('on', 117) // 46 %
      renderModal()
      await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())

      confirmDial() // focus is on the slider row (item 0)

      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ entity_id: ENTITY, brightness_pct: 46 })
    })

    it('tapping a preset focuses it and sends its kelvin value', async () => {
      const calls = makeCallsRecorder()
      seedEntity('off', null)
      renderModal()
      await screen.findByText('3er Stehlampe Gold')

      fireEvent.click(screen.getByRole('button', { name: '3500 K' }))

      expect(screen.getByRole('button', { name: '3500 K' })).toHaveClass('focused')
      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ entity_id: ENTITY, color_temp_kelvin: 3500 })
    })
  })

  describe('optimistic writes', () => {
    it('throttles rapid rotations to one write and sends the final value on focus change', async () => {
      const calls = makeCallsRecorder()
      seedEntity('on', 117) // 46 %
      renderModal()
      await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())

      wheel(-10) // 51 → immediate (first write)
      wheel(-10) // 56 → pending (throttled)
      wheel(-10) // 61 → pending (throttled, supersedes 56)
      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]).toEqual({ entity_id: ENTITY, brightness_pct: 51 })

      // moving the focus off the slider row (tapping a preset) flushes the
      // final pending value
      fireEvent.click(screen.getByRole('button', { name: '4500 K' }))

      await waitFor(() => expect(calls).toHaveLength(3))
      expect(calls.some((c) => c.brightness_pct === 61)).toBe(true)
      expect(calls.some((c) => c.brightness_pct === 56)).toBe(false)
      expect(calls.some((c) => c.color_temp_kelvin === 4500)).toBe(true)
    })

    it('sends the final brightness write when the modal closes', async () => {
      const calls = makeCallsRecorder()
      const onClose = vi.fn()
      seedEntity('on', 117) // 46 %
      renderModal(onClose)
      await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())

      wheel(-10) // 51 → immediate
      wheel(-10) // 56 → pending
      pressBack()

      expect(onClose).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(calls).toHaveLength(2))
      expect(calls[1]).toEqual({ entity_id: ENTITY, brightness_pct: 56 })
    })

    it('reverts the display to the last accepted value and shows the error on a failed write', async () => {
      seedEntity('on', 117) // 46 %
      server.use(
        http.post('*/ha-api/services/light/turn_on', () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      )
      renderModal()
      await waitFor(() => expect(screen.getByText('46%')).toBeInTheDocument())

      wheel(-10) // 51 → write fails
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('home assistant 500'),
      )
      expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '46')

      // the next write succeeds → the display keeps the new value, error clears
      server.use(
        http.post('*/ha-api/services/light/turn_on', async ({ request }) =>
          HttpResponse.json([
            {
              entity_id: (await request.json() as { entity_id?: string }).entity_id ?? ENTITY,
              state: 'on',
              attributes: {},
            },
          ]),
        ),
      )
      // 250 ms throttle: wait out the previous write window
      await new Promise((r) => setTimeout(r, 300))
      wheel(-10) // 51 → succeeds
      await waitFor(() => expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '51'))
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      )
    })

    it('reverts a failed preset selection highlight', async () => {
      seedEntity('off', null)
      server.use(
        http.post('*/ha-api/services/light/turn_on', () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      )
      renderModal()
      await screen.findByText('3er Stehlampe Gold')

      fireEvent.click(screen.getByRole('button', { name: '2200 K' }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('home assistant 500'),
      )
      expect(screen.getByRole('button', { name: '2200 K' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })
  })

  it('back closes the modal and restores the parent focus entry', () => {
    const parent: ListFocusEntry = { onWheel: vi.fn(), onConfirm: null, onBack: vi.fn(), active: true }
    ListFocusContext.setActive(parent)
    const onClose = vi.fn()
    seedEntity('off', null)
    const { unmount } = renderModal(onClose)

    pressBack()

    expect(onClose).toHaveBeenCalledTimes(1)
    // the parent's (menu) entry is only back on top once the modal unmounts
    // (in the App the close callback unmounts it) — and its onBack is
    // never consumed by the modal's entry
    expect(parent.onBack).not.toHaveBeenCalled()
    unmount()
    expect(ListFocusContext.entry).toBe(parent)
  })

  it('the close button and the backdrop close the modal', async () => {
    const onClose = vi.fn()
    seedEntity('off', null)
    const first = renderModal(onClose)
    await screen.findByText('3er Stehlampe Gold')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()

    const onClose2 = vi.fn()
    const second = renderModal(onClose2)
    await screen.findByText('3er Stehlampe Gold')
    fireEvent.click(screen.getByRole('dialog')) // the card swallows its own clicks
    expect(onClose2).not.toHaveBeenCalled()
    // the backdrop is the element behind the card
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose2).toHaveBeenCalledTimes(1)
    second.unmount()
  })
})
