import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/__tests__/msw-server'
import { DebugScreen } from '../DebugScreen'
import { seedColorCache, clearColorCache } from '@/hooks/useColorExtract'
import { warmArt, __resetWarmedArt } from '@/components/MainMenuView/warmedArt'
import type { DebugStatus } from '@/api/types'

const url1 = 'https://i.scdn.co/img/1'

const status: DebugStatus = {
  firmware_version: '1.2.3',
  daemon_version: '0.1.0',
  uptime_secs: 3600,
  daemon_uptime_secs: 3500,
  clock_time: '2026-08-25 12:00:00',
  clock_ok: true,
  ram_free_mb: 100,
  ram_total_mb: 512,
  disk_free_mb: 1000,
  temp_c: 45,
  load_1m: '0.5',
  ws_clients: 1,
  online: true,
  network_path: 'wlan',
  ip: '192.168.7.38',
  dns_servers: 1,
  usb_bounces: 0,
  internet_drops: 0,
  tether_health: '',
  spotify: 'signed in',
  bluetooth_device: '',
  phone_volume: 'connected',
  phone_volume_err: '',
  android_volume: 'off',
  voice_enabled: false,
  voice_ready: false,
  recent_problems: [],
  previous_problems: [],
}

describe('DebugScreen — bug45 option C cache readout', () => {
  it('shows the UI cache section with per-store occupancy', async () => {
    server.use(http.get('*/debug/status', () => HttpResponse.json(status)))

    // seed two caches so the readout has non-zero values to verify
    clearColorCache()
    __resetWarmedArt()
    seedColorCache(url1, [200, 100, 50])
    warmArt(url1)

    render(<DebugScreen open onClose={() => {}} onReport={() => {}} />)

    expect(await screen.findByText('UI cache (bug45)')).toBeInTheDocument()
    expect(screen.getByText('usePlaylists')).toBeInTheDocument()
    expect(screen.getByText('useRecent')).toBeInTheDocument()
    expect(screen.getByText('usePlaylistTracks')).toBeInTheDocument()
    expect(screen.getByText('useColorExtract')).toBeInTheDocument()
    expect(screen.getByText('useHomeLights')).toBeInTheDocument()
    expect(screen.getByText('useLyrics')).toBeInTheDocument()
    expect(screen.getByText('usePrefetch')).toBeInTheDocument()
    expect(screen.getByText('warmedArt')).toBeInTheDocument()

    // the bounds and the seeded values are visible: color cache 1/500 with
    // url length + 24 B overhead, warmed art 1/1000 with url length
    expect(screen.getByText(`${1}/${500} · ${url1.length + 24} B`)).toBeInTheDocument()
    expect(screen.getByText(`${1}/${1000} · ${url1.length} B`)).toBeInTheDocument()
    // the playlist-tracks cap line reports 0/32 on a fresh session
    expect(screen.getByText(/0\/32 · 0 tracks/)).toBeInTheDocument()
  })

  it('keeps the cache section visible when the daemon does not respond', async () => {
    server.use(http.get('*/debug/status', () => HttpResponse.json({}, { status: 500 })))

    render(<DebugScreen open onClose={() => {}} onReport={() => {}} />)

    expect(await screen.findByText('daemon not responding on :3678')).toBeInTheDocument()
    expect(screen.getByText('UI cache (bug45)')).toBeInTheDocument()
  })
})
