export interface ObserverStatusInactive {
  active: false
  message?: string
}

export interface QueueTrack {
  uri: string
  track_id: string
  name: string
  artist: string
  album: string
  image_url: string
}

export interface ObserverStatusActive {
  active: true
  device_id: string
  device_name: string
  device_type: string
  track_id: string
  track_uri: string
  track_name: string
  track_artist: string
  track_album: string
  track_image: string
  context_uri: string
  context_name: string
  duration: number
  position: number
  is_playing: boolean
  is_paused: boolean
  volume?: number
  volume_max?: number
  volume_disabled?: boolean
  volume_steps?: number
  shuffle: boolean
  repeat_context: boolean
  repeat_track: boolean
  disallow_prev?: boolean
  disallow_next?: boolean
  disallow_seek?: boolean
  prev_tracks?: QueueTrack[]
  next_tracks?: QueueTrack[]
  lyrics_url: string
  raw_metadata?: Record<string, string> | null
  received_at: number
}

export type ObserverStatus = ObserverStatusActive | ObserverStatusInactive

export interface LyricsLine {
  startTimeMs: string
  words: string
}

export type LyricsSyncType = 'LINE_SYNCED' | 'UNSYNCED'

export interface LyricsResult {
  syncType: LyricsSyncType
  lines: LyricsLine[]
}

export type ApiEventType =
  | 'observer_track_changed'
  | 'observer_state_changed'
  | 'playing'
  | 'paused'
  | 'not_playing'
  | 'seek'
  | 'metadata'
  | 'stopped'
  | 'bluetooth/pairing'
  | 'bluetooth/pairing/cancelled'
  | 'bluetooth/paired'
  | 'bluetooth/connect'
  | 'bluetooth/disconnect'
  | 'bluetooth/network/connect'
  | 'bluetooth/network/disconnect'
  | 'network_status'
  | string

export interface ApiEvent<T = unknown> {
  type: ApiEventType
  data: T
}

// must match daemon/bluetooth/types.go
export interface BluetoothDeviceInfo {
  address: string
  name: string
  alias: string
  class: string
  icon: string
  paired: boolean
  trusted: boolean
  blocked: boolean
  connected: boolean
  legacyPairing: boolean
  batteryPercentage?: number
}

export interface PairingStartedPayload {
  address: string
  pairingKey: string
}

export interface DevicePairedPayload {
  device: BluetoothDeviceInfo
}

export interface DeviceConnectedPayload {
  address: string
  device?: BluetoothDeviceInfo
}

export interface DeviceDisconnectedPayload {
  address: string
}

export interface NetworkConnectedPayload {
  address: string
}

export interface NetworkStatusPayload {
  status: 'online' | 'offline'
}

// PascalCase shape on the /events WS for observer events
export interface RemoteStateWire {
  DeviceId: string
  DeviceName: string
  DeviceType: string
  TrackUri: string
  TrackName: string
  TrackArtist: string
  TrackAlbum: string
  TrackImageUrl: string
  ContextUri: string
  ContextName: string
  Duration: number
  PositionAsOfTimestamp: number
  Timestamp: number
  IsPlaying: boolean
  IsPaused: boolean
  PlaybackSpeed: number
  Volume?: number
  VolumeDisabled?: boolean
  VolumeSteps?: number
  ShuffleContext: boolean
  RepeatContext: boolean
  RepeatTrack: boolean
  DisallowSkipPrev?: boolean
  DisallowSkipNext?: boolean
  DisallowSeek?: boolean
  PrevTracks?: QueueTrack[]
  NextTracks?: QueueTrack[]
  RawMetadata?: Record<string, string> | null
}
