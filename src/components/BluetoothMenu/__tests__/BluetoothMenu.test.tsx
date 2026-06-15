import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'

const busState = vi.hoisted(() => ({
  eventListeners: [] as Array<(evt: { type: string; data: unknown }) => void>,
}))

vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (evt: { type: string; data: unknown }) => void) => {
    busState.eventListeners.push(fn)
    return () => {
      const i = busState.eventListeners.indexOf(fn)
      if (i >= 0) busState.eventListeners.splice(i, 1)
    }
  },
}))

import { BluetoothMenu } from '../BluetoothMenu'

const KNOWN = [
  {
    address: 'AA:BB:CC:DD:EE:FF',
    name: 'Samsung',
    starred: true,
    last_connected: '2026-06-12T00:00:00Z',
    connected: true,
    network: true,
  },
  {
    address: '11:22:33:44:55:66',
    name: 'Old Pixel',
    starred: false,
    last_connected: '2026-06-01T00:00:00Z',
    connected: false,
    network: false,
  },
]

// a PC: paired + connected, but not providing internet
const KNOWN_WITH_PC = [
  ...KNOWN,
  {
    address: '77:88:99:AA:BB:CC',
    name: 'Desktop PC',
    starred: false,
    last_connected: '2026-06-12T01:00:00Z',
    connected: true,
    network: false,
  },
]

function mockKnown(devices: typeof KNOWN | [] = KNOWN) {
  server.use(http.get('*/bluetooth/known', () => HttpResponse.json(devices)))
}

function firePaired(address: string, name: string) {
  for (const fn of busState.eventListeners) {
    fn({ type: 'bluetooth/paired', data: { device: { address, name, alias: name } } })
  }
}

describe('BluetoothMenu', () => {
  it('renders known devices with connection state and priority star', async () => {
    mockKnown()
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Samsung')).toBeInTheDocument())
    expect(screen.getByText('Old Pixel')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Tap to connect')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove priority')).toBeInTheDocument()
    expect(screen.getByLabelText('Make priority')).toBeInTheDocument()
  })

  it('shows the empty state when nothing is paired', async () => {
    mockKnown([])
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('No phones paired yet.')).toBeInTheDocument())
  })

  it('stars an unstarred device via POST .../star', async () => {
    mockKnown()
    let starred = ''
    server.use(
      http.post('*/bluetooth/known/:addr/star', ({ params }) => {
        starred = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Old Pixel')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Make priority'))
    await waitFor(() => expect(starred).toBe('11:22:33:44:55:66'))
  })

  it('unstars a starred device via POST .../unstar', async () => {
    mockKnown()
    let unstarred = ''
    server.use(
      http.post('*/bluetooth/known/:addr/unstar', ({ params }) => {
        unstarred = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Samsung')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Remove priority'))
    await waitFor(() => expect(unstarred).toBe('AA:BB:CC:DD:EE:FF'))
  })

  it('forget requires two taps: first arms, second POSTs', async () => {
    mockKnown()
    let forgotten = ''
    server.use(
      http.post('*/bluetooth/known/:addr/forget', ({ params }) => {
        forgotten = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Old Pixel')).toBeInTheDocument())
    const removeButtons = screen.getAllByLabelText('Remove device')
    fireEvent.click(removeButtons[1])
    expect(forgotten).toBe('')
    expect(screen.getByText('Remove?')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Tap again to remove'))
    await waitFor(() => expect(forgotten).toBe('11:22:33:44:55:66'))
  })

  it('blocks forgetting the only device while offline (no fallback)', async () => {
    const ONLY = [
      {
        address: 'AA:BB:CC:DD:EE:FF',
        name: 'Samsung',
        starred: true,
        last_connected: '2026-06-12T00:00:00Z',
        connected: false,
        network: false,
      },
    ]
    mockKnown(ONLY as typeof KNOWN)
    let forgotten = ''
    server.use(
      http.post('*/bluetooth/known/:addr/forget', ({ params }) => {
        forgotten = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={false} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Samsung')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Remove device'))
    // guard fires before arming: no confirm, no POST
    expect(screen.queryByText('Remove?')).toBeNull()
    expect(forgotten).toBe('')
  })

  it('tapping a disconnected device requests a connect', async () => {
    mockKnown()
    let paged = ''
    server.use(
      http.post('*/bluetooth/known/:addr/connect', ({ params }) => {
        paged = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Old Pixel')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Tap to connect'))
    await waitFor(() => expect(paged).toBe('11:22:33:44:55:66'))
  })

  it('shows connected-without-internet for a device not carrying the network, tappable to use', async () => {
    mockKnown(KNOWN_WITH_PC)
    let paged = ''
    server.use(
      http.post('*/bluetooth/known/:addr/connect', ({ params }) => {
        paged = String(params.addr)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Desktop PC')).toBeInTheDocument())
    // the PAN carrier reads Connected the PC reads no internet and is tappable
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Connected with no internet · tap to use'))
    await waitFor(() => expect(paged).toBe('77:88:99:AA:BB:CC'))
  })

  it('a successful pair ends pair mode and restores discoverability', async () => {
    mockKnown()
    const discoverCalls: string[] = []
    server.use(
      http.post('*/bluetooth/discover/:mode', ({ params }) => {
        discoverCalls.push(String(params.mode))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Pair new device')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Pair new device'))
    await waitFor(() => expect(discoverCalls).toContain('on'))
    expect(screen.getByText(/Discoverable as/)).toBeInTheDocument()

    firePaired('77:88:99:AA:BB:CC', 'Desktop PC')

    // the hint used to stay up forever after a successful pair
    await waitFor(() => expect(screen.queryByText(/Discoverable as/)).toBeNull())
    expect(screen.getByText('Pair new device')).toBeInTheDocument()
    await waitFor(() => expect(discoverCalls).toContain('off'))
  })

  it('pair-new-device turns discoverable on and shows the hint', async () => {
    mockKnown()
    let discoverable = ''
    server.use(
      http.post('*/bluetooth/discover/:mode', ({ params }) => {
        discoverable = String(params.mode)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Pair new device')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Pair new device'))
    await waitFor(() => expect(discoverable).toBe('on'))
    expect(await screen.findByText(/Discoverable as/)).toBeInTheDocument()
  })

  it('restores discoverable=off on unmount when online and pair mode was used', async () => {
    mockKnown()
    const calls: string[] = []
    server.use(
      http.post('*/bluetooth/discover/:mode', ({ params }) => {
        calls.push(String(params.mode))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { unmount } = render(<BluetoothMenu online={true} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Pair new device')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Pair new device'))
    await waitFor(() => expect(calls).toContain('on'))

    unmount()
    await waitFor(() => expect(calls).toContain('off'))
  })
})
