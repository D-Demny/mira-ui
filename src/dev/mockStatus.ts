import type { ObserverStatusActive } from '@/api/types'

// mock playback state used by the dev screen switcher
export function makeMockStatus(): ObserverStatusActive {
  const env = import.meta.env
  const trackId = env.VITE_MOCK_TRACK_ID ?? ''
  return {
    active: true,
    device_id: 'dev-mock',
    device_name: 'Dev Mock',
    device_type: 'COMPUTER',
    track_id: trackId,
    track_uri: env.VITE_MOCK_TRACK_URI ?? '',
    track_name: env.VITE_MOCK_TRACK_NAME ?? '',
    track_artist: env.VITE_MOCK_TRACK_ARTIST ?? '',
    track_album: env.VITE_MOCK_TRACK_ALBUM ?? '',
    track_image: env.VITE_MOCK_TRACK_IMAGE ?? '',
    context_uri: env.VITE_MOCK_CONTEXT_URI ?? 'spotify:playlist:dev-mock',
    duration: Number(env.VITE_MOCK_DURATION ?? 200000),
    position: Number(env.VITE_MOCK_POSITION ?? 60000),
    is_playing: true,
    is_paused: false,
    shuffle: false,
    repeat_context: false,
    repeat_track: false,
    lyrics_url: trackId ? `/lyrics/${trackId}` : '',
    raw_metadata: null,
    received_at: Date.now(),
  }
}
