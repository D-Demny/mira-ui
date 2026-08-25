// bug45 option C: debug readout of every module-level menu cache. Lets a
// device session verify the actual bounds via the Debug screen instead of
// trusting the audit's estimates (caching_recommendation_report.md). Read-only
// by construction — each per-store getter only reads its module state.
import { __playlistsCacheStats } from './usePlaylists'
import { __recentCacheStats } from './useRecent'
import { __playlistTracksCacheStats } from './usePlaylistTracks'
import { __colorCacheStats } from './useColorExtract'
import { __homeLightStoreStats } from './useHomeLight'
import { __lyricsCacheStats } from './useLyrics'
import { __prefetchStats } from './usePrefetch'
import { WARMED_ART_MAX, warmedArtStats } from '@/components/MainMenuView/warmedArt'

export interface CacheStats {
  usePlaylists: { entries: number; items: number; approxBytes: number }
  useRecent: { entries: number; items: number; approxBytes: number }
  usePlaylistTracks: {
    maxEntries: number
    maxTracksPerEntry: number
    ttlMs: number
    entries: number
    tracks: number
    approxBytes: number
  }
  useColorExtract: { entries: number; maxEntries: number; approxBytes: number }
  useHomeLights: { entities: number }
  useLyrics: { entries: number; maxEntries: number; richsyncTried: number }
  usePrefetch: { entries: number; maxEntries: number; approxBytes: number }
  warmedArt: { entries: number; maxEntries: number; approxBytes: number }
}

export function __cacheStats(): CacheStats {
  return {
    usePlaylists: __playlistsCacheStats(),
    useRecent: __recentCacheStats(),
    usePlaylistTracks: __playlistTracksCacheStats(),
    useColorExtract: __colorCacheStats(),
    useHomeLights: __homeLightStoreStats(),
    useLyrics: __lyricsCacheStats(),
    usePrefetch: __prefetchStats(),
    warmedArt: { ...warmedArtStats(), maxEntries: WARMED_ART_MAX },
  }
}
