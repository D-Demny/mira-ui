import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MaSettingsModal } from '../MaSettingsModal'
import * as settingsModule from '@/settings'
import { __resetSettings, getSettings, updateSettings } from '@/settings'
import { ListFocusContext } from '@/navigation/listFocusContext'

// issue #134: the "Wiedergabequelle" (playback source) settings modal — the
// two-option source selector (Spotify Connect / Music Assistant), the MA
// url/token fields (visible only in the MA draft) with the SHARED
// HaKeyboardOverlay, and the single "Speichern" button (the SAME store save
// path as the HA section — no network round-trip, no error line).
//
// Test isolation: the settings store is reset in beforeEach; there are no MSW
// handlers specific to this modal (its save never hits the daemon).

function tokenInput(): HTMLInputElement {
  // the label text 'Token' also matches the open keyboard dialog's name while
  // it is up — scope to the input element (same pattern as the HA tests)
  return screen.getAllByLabelText('Token').find((el) => el.tagName === 'INPUT') as HTMLInputElement
}

// the observable for "EIN Store-Write": the settings store exposes exactly
// one write path (updateSettings, settings.ts), so a spy on it captures
// every store write and its patch (same pattern as the HA modal tests)
function captureStoreWrites() {
  const patches: unknown[] = []
  const original = settingsModule.updateSettings.bind(settingsModule)
  vi.spyOn(settingsModule, 'updateSettings').mockImplementation(
    (patch: Parameters<typeof settingsModule.updateSettings>[0]) => {
      patches.push(patch)
      original(patch)
    },
  )
  return patches
}

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
})

afterEach(() => {
  vi.restoreAllMocks()
  ListFocusContext.setActive(null)
})

describe('MaSettingsModal: defaults (fresh install)', () => {
  it('shows spotify pressed, no url/token fields and the off status line', () => {
    render(<MaSettingsModal onClose={() => {}} />)
    expect(screen.getByText('Wiedergabequelle')).toBeInTheDocument()
    expect(screen.getByText('Nicht konfiguriert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // the url/token fields are hidden while spotify is selected in the draft
    expect(screen.queryByRole('textbox', { name: 'URL/IP:Port' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Token')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('switching to Music Assistant reveals the url + token fields (draft only, no store write)', () => {
    const storeWrites = captureStoreWrites()
    render(<MaSettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Music Assistant' }))
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toBeInTheDocument()
    expect(tokenInput()).toHaveValue('')
    // switching sources never persists (the draft model — only Speichern
    // may write the store)
    expect(storeWrites).toHaveLength(0)
    expect(getSettings().playbackSource).toBe('spotify')
  })
})

describe('MaSettingsModal: prefill from the saved ma config', () => {
  it('pre-fills url + token, shows the on status line and MA pressed', () => {
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: 'tok-123' } })
    render(<MaSettingsModal onClose={() => {}} />)
    expect(screen.getByText('Konfiguriert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // the user may have typed a bare host:port — the field shows it verbatim,
    // the daemon normalizes (MaSettingsValue in settings.ts)
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue('http://10.0.0.9:8097')
    expect(tokenInput()).toHaveValue('tok-123')
  })
})

describe('MaSettingsModal: Speichern (same save path as the HA section)', () => {
  it('saves playbackSource ma + trimmed url / verbatim token in ONE store write', () => {
    const storeWrites = captureStoreWrites()
    render(<MaSettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Music Assistant' }))
    // a bare host:port with stray spaces — the url is trimmed on save, the
    // daemon does the scheme normalization; the token stays VERBATIM
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: '  10.0.0.9:8097  ' },
    })
    fireEvent.change(tokenInput(), { target: { value: 'tok  with  spaces' } })
    // typing never persists (the draft model)
    expect(storeWrites).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(storeWrites).toHaveLength(1)
    expect(storeWrites[0]).toEqual({
      playbackSource: 'ma',
      ma: { url: '10.0.0.9:8097', token: 'tok  with  spaces' },
    })
    expect(getSettings().playbackSource).toBe('ma')
    // the status line is derived from the SAVED settings — it flips right
    // after the store write (reactive via useSettings)
    expect(screen.getByText('Konfiguriert')).toBeInTheDocument()
  })

  it('a spotify save writes ONLY playbackSource (no ma key fabricated)', () => {
    const storeWrites = captureStoreWrites()
    render(<MaSettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(storeWrites).toHaveLength(1)
    expect(storeWrites[0]).toEqual({ playbackSource: 'spotify' })
    expect(getSettings().playbackSource).toBe('spotify')
    expect(getSettings().ma).toBeUndefined()
  })

  it('a spotify save never clobbers a pre-configured ma block', () => {
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: 'tok' } })
    const storeWrites = captureStoreWrites()
    render(<MaSettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }))
    // the fields collapse back out of the draft
    expect(screen.queryByRole('textbox', { name: 'URL/IP:Port' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(storeWrites).toHaveLength(1)
    expect(storeWrites[0]).toEqual({ playbackSource: 'spotify' })
    const s = getSettings()
    expect(s.playbackSource).toBe('spotify')
    // the configured MA credentials survive the source switch
    expect(s.ma).toEqual({ url: 'http://10.0.0.9:8097', token: 'tok' })
  })
})

describe('MaSettingsModal: dial focus chain (dynamic list)', () => {
  const wheel = (deltaX: number) => {
    act(() => {
      ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
  }

  it('spotify mode walks spotify → ma → save (clamped at the end)', () => {
    render(<MaSettingsModal onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
    wheel(-40) // clamped — the list has no further item
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
  })
  it('tapping a source option moves the dial focus to it (the chain collapses on shrink)', () => {
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: 'tok' } })
    render(<MaSettingsModal onClose={() => {}} />)
    wheel(-40)
    wheel(-40) // → the url field (index 2)
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveClass('focused')
    fireEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }))
    // tapItem moves the dial focus to the tapped option and the two field
    // items collapse out of the chain (6 → 4); the fields unmount with them
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveClass('focused')
    expect(screen.queryByRole('textbox', { name: 'URL/IP:Port' })).not.toBeInTheDocument()
    // and dialing forward now goes straight to Speichern (no field items)
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
  })

  it('ma mode walks spotify → ma → url → token → save (the field items expand the chain)', () => {
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: 'tok' } })
    render(<MaSettingsModal onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Spotify Connect' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Music Assistant' })).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveClass('focused')
    wheel(-40)
    expect(tokenInput()).toHaveClass('focused')
    wheel(-40)
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
    wheel(-40) // clamped at the end
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveClass('focused')
  })
})

describe('MaSettingsModal: on-screen keyboard (shared HaKeyboardOverlay)', () => {
  const wheel = (deltaX: number) => {
    act(() => {
      ListFocusContext.entry.onWheel({ deltaX, preventDefault: vi.fn() } as unknown as WheelEvent)
    })
  }

  const confirm = () => {
    act(() => {
      ListFocusContext.entry.onConfirm?.()
    })
  }

  const back = () => {
    let consumed: boolean | undefined
    act(() => {
      consumed = ListFocusContext.entry.onBack?.()
    })
    return consumed
  }

  it('focusing a field opens the keyboard for exactly that field', () => {
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: 'tok' } })
    render(<MaSettingsModal onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.focus(screen.getByRole('textbox', { name: 'URL/IP:Port' }))
    expect(screen.getByRole('dialog', { name: 'URL/IP:Port' })).toBeInTheDocument()

    // the open URL keyboard and the token input share label text while it is
    // up — close first, then focus the token field (the input element)
    back()
    fireEvent.focus(tokenInput())
    expect(screen.getByRole('dialog', { name: 'Token' })).toBeInTheDocument()
  })

  it('typing on the keyboard edits the DRAFT (never the store); Back closes it', () => {
    // prefill BEFORE installing the write spy — only the modal's own save may
    // be observed here (the draft model assertion counts writes after render)
    updateSettings({ playbackSource: 'ma', ma: { url: 'http://10.0.0.9:8097', token: '' } })
    const storeWrites = captureStoreWrites()
    render(<MaSettingsModal onClose={() => {}} />)
    wheel(-40) // → Music Assistant
    wheel(-40) // → the url field
    confirm()
    expect(screen.getByRole('dialog', { name: 'URL/IP:Port' })).toBeInTheDocument()
    confirm() // the first key ('1') is focused — typing it appends
    expect(screen.getByRole('textbox', { name: 'URL/IP:Port' })).toHaveValue(
      'http://10.0.0.9:80971',
    )
    // nothing is persisted while typing (the draft model)
    expect(storeWrites).toHaveLength(0)
    back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('MaSettingsModal: security (token never logged)', () => {
  it('no console.* call ever receives the token value across the whole flow', () => {
    const calls: unknown[][] = []
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        calls.push(args)
      })
    }
    updateSettings({
      playbackSource: 'ma',
      ma: { url: 'http://10.0.0.9:8097', token: 'secret-token-value' },
    })
    render(<MaSettingsModal onClose={() => {}} />)
    // exercise every path that could log: open + type in both fields, save,
    // switch the source and save again
    fireEvent.change(screen.getByRole('textbox', { name: 'URL/IP:Port' }), {
      target: { value: '  10.0.0.9:8097  ' },
    })
    fireEvent.change(tokenInput(), { target: { value: 'new-secret-token-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spotify Connect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(calls.flat().join('\n')).not.toContain('secret-token-value')
    expect(calls.flat().join('\n')).not.toContain('new-secret-token-value')
  })
})
