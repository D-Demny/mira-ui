// PERF-A/B (temp) — unit tests for the lowres-art url rewrite (debug/fps-bug58)
import { describe, expect, it } from 'vitest'
import { downsizeSpotifyUrl } from '../spotifyImage'

describe('downsizeSpotifyUrl (PERF-A/B lowres-art)', () => {
  it('rewrites a 640px i.scdn.co url to the 300px variant', () => {
    expect(downsizeSpotifyUrl('https://i.scdn.co/image/ab67616d00001e02deadbeef')).toBe(
      'https://i.scdn.co/image/ab67616d00003358deadbeef',
    )
  })

  it('leaves an already-300px url unchanged', () => {
    const url = 'https://i.scdn.co/image/ab67616d00003358cafebabe'
    expect(downsizeSpotifyUrl(url)).toBe(url)
  })

  it('leaves a 64px (other prefix) url unchanged', () => {
    const url = 'https://i.scdn.co/image/ab67616d0000b27c00c0ffee'
    expect(downsizeSpotifyUrl(url)).toBe(url)
  })

  it('leaves non-Spotify urls unchanged', () => {
    const url = 'https://example.com/cover.jpg'
    expect(downsizeSpotifyUrl(url)).toBe(url)
  })

  it('keeps anything after the image hash (query string, path tail) intact', () => {
    expect(
      downsizeSpotifyUrl('https://i.scdn.co/image/ab67616d00001e02deadbeef?extra=1'),
    ).toBe('https://i.scdn.co/image/ab67616d00003358deadbeef?extra=1')
  })
})
