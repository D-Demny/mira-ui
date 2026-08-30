import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Lyrics } from '../Lyrics'
import { __resetLyricsCache } from '../../../hooks/useLyrics'
import { server } from '../../../__tests__/msw-server'
import { activeStatus } from '../../../__tests__/fixtures/observer'
import { applyUiScale, registerUiScaleTarget } from '../../../uiScale'

beforeEach(() => {
  __resetLyricsCache()
})

const TRACK_STATUS = {
  ...activeStatus,
  track_id: 'abc',
  duration: 60_000,
}

describe('lyrics rendered DOM', () => {
  it('renders one element per synced lyric line', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [
            { startTimeMs: '0', words: 'First line' },
            { startTimeMs: '5000', words: 'Second line' },
            { startTimeMs: '10000', words: 'Third line' },
            { startTimeMs: '15000', words: 'Fourth line' },
          ],
        }),
      ),
    )

    render(<Lyrics status={TRACK_STATUS} />)

    await waitFor(() => expect(screen.getByText('First line')).toBeInTheDocument())
    expect(screen.getByText('Second line')).toBeInTheDocument()
    expect(screen.getByText('Third line')).toBeInTheDocument()
    expect(screen.getByText('Fourth line')).toBeInTheDocument()
  })

  it('fires onSeek with the lines start time when a synced line is clicked', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [
            { startTimeMs: '0', words: 'L0' },
            { startTimeMs: '5000', words: 'L1' },
            { startTimeMs: '10000', words: 'L2' },
          ],
        }),
      ),
    )

    const onSeek = vi.fn()
    render(<Lyrics status={TRACK_STATUS} onSeek={onSeek} />)

    const line2 = await screen.findByText('L2')
    fireEvent.click(line2)

    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(10_000)
  })

  it('does not make synced lines clickable when seeking is disallowed', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [
            { startTimeMs: '0', words: 'L0' },
            { startTimeMs: '10000', words: 'L1' },
          ],
        }),
      ),
    )

    const onSeek = vi.fn()
    render(<Lyrics status={{ ...TRACK_STATUS, disallow_seek: true }} onSeek={onSeek} />)

    const line = await screen.findByText('L1')
    expect(line).not.toHaveAttribute('role', 'button')
    fireEvent.click(line)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('shows the unsynced pill when the daemon returns unsynced lyrics', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'UNSYNCED',
          lines: [
            { startTimeMs: '0', words: 'Whole song as one block' },
            { startTimeMs: '0', words: 'No per-line timing' },
          ],
        }),
      ),
    )

    render(<Lyrics status={TRACK_STATUS} />)

    const pill = await screen.findByLabelText('lyrics are not time-synced')
    expect(pill).toHaveTextContent(/unsynced/i)
  })

  it('does not make unsynced lines clickable (no perline timestamp to seek to)', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'UNSYNCED',
          lines: [{ startTimeMs: '0', words: 'Whole block' }],
        }),
      ),
    )

    const onSeek = vi.fn()
    render(<Lyrics status={TRACK_STATUS} onSeek={onSeek} />)

    const line = await screen.findByText('Whole block')
    expect(line).not.toHaveAttribute('role', 'button')
    fireEvent.click(line)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('marks the active line based on status.position', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [
            { startTimeMs: '0', words: 'L0' },
            { startTimeMs: '5000', words: 'L1' },
            { startTimeMs: '10000', words: 'L2' },
            { startTimeMs: '15000', words: 'L3' },
          ],
        }),
      ),
    )

    render(
      <Lyrics
        status={{
          ...TRACK_STATUS,
          position: 7_000,
          // pin received_at so elapsed = 0, position can't drift past line 1
          received_at: Date.now() + 10_000,
          is_playing: false,
          is_paused: true,
        }}
      />,
    )
    await waitFor(() => expect(screen.getByText('L1').className).toMatch(/lineActive/))

    expect(screen.getByText('L0').className).not.toMatch(/lineActive/)
    expect(screen.getByText('L2').className).not.toMatch(/lineActive/)
  })

  it('renders an Instrumental placeholder when the only line says so', async () => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [{ startTimeMs: '0', words: 'Instrumental' }],
        }),
      ),
    )

    render(<Lyrics status={TRACK_STATUS} />)

    await waitFor(() => expect(screen.getByText(/instrumental/i)).toBeInTheDocument())
    expect(screen.getByText(/♪/)).toBeInTheDocument()
  })

  it('shows "No lyrics available" on a 404 (no lyrics for this track)', async () => {
    server.use(http.get('*/lyrics/abc', () => new HttpResponse(null, { status: 404 })))

    render(<Lyrics status={TRACK_STATUS} />)

    expect(await screen.findByText(/no lyrics available/i)).toBeInTheDocument()
  })
})

// bug44_v2: the lyrics text counter-scales the player zoom so that it grows 1:1 with the
// display size up to 100% and stays capped at 100% above it
describe('lyrics text scaling with display size', () => {
  let target: HTMLDivElement

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    registerUiScaleTarget(target)
  })

  afterEach(() => {
    registerUiScaleTarget(null)
    target.remove()
    applyUiScale(100)
  })

  // the --lyrics-text-scale var is set on the .lyrics container; walk up from a line to
  // find it (the intermediate .list carries an inline transform but no custom properties)
  function lyricsContainer(el: HTMLElement): HTMLElement {
    let node: HTMLElement | null = el
    while (node && !node.style.getPropertyValue('--lyrics-text-scale')) {
      node = node.parentElement
    }
    return node as HTMLElement
  }

  it.each([
    [100, 1],
    [115, 0.87],
  ] as [number, number][])('counter-scales the text font at %i display size', (pct, expected) => {
    server.use(
      http.get('*/lyrics/abc', () =>
        HttpResponse.json({
          syncType: 'LINE_SYNCED',
          lines: [{ startTimeMs: '0', words: 'Only line' }],
        }),
      ),
    )

    applyUiScale(pct)
    render(<Lyrics status={TRACK_STATUS} />)

    const line = screen.findByText('Only line')
    return line.then((el) => {
      const raw = lyricsContainer(el).style.getPropertyValue('--lyrics-text-scale')
      expect(Number(raw)).toBeCloseTo(expected, 12)
    })
  })
})
