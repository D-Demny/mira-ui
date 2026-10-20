import { memo, useState } from 'react'
import { getSettings, updateSettings, useSettings, type PlaybackSource } from '@/settings'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { HaKeyboardOverlay } from './HaKeyboardOverlay'
import { MA_TOKEN_DEFAULT, MA_URL_DEFAULT } from '@/maDefaults'
import styles from './MaSettingsModal.module.scss'

// issue #134: the "Wiedergabequelle" (playback source) settings view — 1:1
// the HaSettingsModal structure (backdrop > fixed card shell > .content
// scroll container, Bug10-1/Bug51): the status line, the two-option source
// selector, and — only while 'ma' is selected in the draft — the MA url/token
// fields (dial focus chain + on-screen keyboard), followed by "Speichern".
//
// DRAFT MODEL (same as the HA modal): the controls edit modal-local draft
// state, NOT the store. Only "Speichern" may write the settings store via
// updateSettings — the SAME save path the HA section uses (debounced PUT
// /settings of the opaque blob, see putSettings in settings.ts).
//
// SAVE RULE: one store write with { playbackSource } +, only while MA is
// selected, { ma: { url (trimmed), token (VERBATIM) } }. A spotify save must
// neither fabricate an empty `ma` key nor clobber previously configured MA
// credentials (the optional-key contract in settings.ts). An empty url is a
// valid saved state — it means "MA backend disabled" in the daemon — so the
// button is never gated on filled fields.
//
// KEYBOARD: a dedicated HaKeyboardOverlay instance rendered INSIDE the modal's
// backdrop, reusing the 'url' / 'token' fields ('URL/IP:Port' / 'Token' —
// both labels fit verbatim). Its focus entry lands on top of the modal's
// entry, so Back closes the keyboard first and the modal second (Bug10-2).
//
// SECURITY (issue #134 hard constraint): the MA token is stored in plain text
// with the settings blob (documented trade-off, same as HaSettingsValue.token
// and PiProfile.password) and is NEVER logged — no console.* with its value
// anywhere in this file, and there is nothing to leak: the save is a local
// store write (no network error path), and the daemon's 400s on /ma/* name
// no credential (see the client comment in api/client.ts).

interface Props {
  onClose: () => void
}

interface DraftState {
  source: PlaybackSource
  url: string
  token: string
}

// the focus list in VISUAL order (the dial chain): the two source options,
// then — only while 'ma' is selected in the draft — the url + token fields,
// and finally Speichern. The list is DYNAMIC: useOverlayListFocus clamps the
// focused index when the item count changes (its documented shrink behavior),
// so collapsing the two field items on a switch to spotify stays in range.
type FocusItem =
  | { kind: 'source'; source: PlaybackSource }
  // only the two fields this modal edits (a subset of HaKeyboardField — the
  // keyboard's 'username' / 'password' fields belong to the HA modal)
  | { kind: 'field'; field: 'url' | 'token' }
  | { kind: 'save' }

const IDX_SPOTIFY = 0
const IDX_MA = 1

function MaSettingsModalImpl({ onClose }: Props) {
  const settings = useSettings()
  // the draft — initialized ONCE from the saved settings (the store is the
  // only source of pre-fill values; same DRAFT MODEL as the HA modal). An
  // unconfigured install has no `ma` key at all → the fields open with the
  // baked-in defaults (src/maDefaults.ts, issue #134: the 376-char token is
  // not keyboard-typable); a saved empty value stays empty.
  const [draft, setDraft] = useState<DraftState>(() => {
    const s = getSettings()
    return {
      source: s.playbackSource,
      url: s.ma?.url ?? MA_URL_DEFAULT,
      token: s.ma?.token ?? MA_TOKEN_DEFAULT,
    }
  })
  const [keyboardField, setKeyboardField] = useState<'url' | 'token' | null>(null)

  // the dial chain (see the FocusItem note above): the two field items only
  // exist while 'ma' is selected in the draft — an explicitly typed array, so
  // the literals keep their literal types inside the ternary
  const fieldItems: Array<Extract<FocusItem, { kind: 'field' }>> =
    draft.source === 'ma'
      ? [
          { kind: 'field', field: 'url' },
          { kind: 'field', field: 'token' },
        ]
      : []
  const focusItems: FocusItem[] = [
    { kind: 'source', source: 'spotify' },
    { kind: 'source', source: 'ma' },
    ...fieldItems,
    { kind: 'save' },
  ]
  const idxUrl = draft.source === 'ma' ? 2 : -1
  const idxToken = draft.source === 'ma' ? 3 : -1
  const idxSave = focusItems.length - 1

  // "Speichern" (see SAVE RULE above): the single store write, through the
  // same save path as the HA section. No network round-trip, so nothing can
  // fail and no error line exists.
  const handleSave = () => {
    updateSettings({
      playbackSource: draft.source,
      ...(draft.source === 'ma' ? { ma: { url: draft.url.trim(), token: draft.token } } : {}),
    })
  }

  // the dial confirm action (1:1 the HaSettingsModal handleFocusItem): the
  // source buttons switch the draft's source (which collapses/expands the
  // field items), the fields open the on-screen keyboard, save persists
  const handleFocusItem = (index: number) => {
    const item = focusItems[index]
    if (!item) return
    if (item.kind === 'source') {
      setDraft((d) => ({ ...d, source: item.source }))
    } else if (item.kind === 'field') {
      setKeyboardField(item.field)
    } else {
      handleSave()
    }
  }

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: focusItems.length,
    initialIndex: 0,
    onConfirm: handleFocusItem,
    onBack: onClose,
  })

  // the status line — derived from the SAVED settings (like the HA modal's
  // row value), reactive via useSettings: a save flips it immediately
  const maConfigured = settings.ma?.url !== undefined && settings.ma.url.trim() !== ''
  const statusLine = maConfigured ? 'Konfiguriert' : 'Nicht konfiguriert'
  const statusOn = maConfigured

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Bug10-1: fixed card shell; this block is the vertical scroll
            container (the established SettingsList pattern) */}
        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <span className={styles.title}>Wiedergabequelle</span>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Close"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className={`${styles.status} ${statusOn ? styles.statusOn : styles.statusOff}`}>
              {statusLine}
            </div>
          </div>

          {/* the two-option source selector — Spotify Connect (the default,
              every blob predating issue #134) or Music Assistant */}
          <div className={styles.segmented}>
            <button
              type="button"
              aria-pressed={draft.source === 'spotify'}
              className={`${styles.segmentBtn} ${focusedIndex === IDX_SPOTIFY ? styles.focused : ''}`}
              ref={focusedIndex === IDX_SPOTIFY ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_SPOTIFY ? 0 : -1}
              onClick={() => {
                tapItem(IDX_SPOTIFY)
                setDraft((d) => ({ ...d, source: 'spotify' }))
              }}
            >
              Spotify Connect
            </button>
            <button
              type="button"
              aria-pressed={draft.source === 'ma'}
              className={`${styles.segmentBtn} ${
                draft.source === 'ma' ? styles.segmentOn : ''
              } ${focusedIndex === IDX_MA ? styles.focused : ''}`}
              ref={focusedIndex === IDX_MA ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_MA ? 0 : -1}
              onClick={() => {
                tapItem(IDX_MA)
                setDraft((d) => ({ ...d, source: 'ma' }))
              }}
            >
              Music Assistant
            </button>
          </div>

          {draft.source === 'ma' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>URL/IP:Port</span>
                {/* tapping/focusing the field opens the on-screen keyboard;
                    Bug10-2: the field is part of the dial focus chain. The
                    user may type a bare host:port — the daemon normalizes
                    (default scheme http, ws(s)→http(s), trailing slash), see
                    MaSettingsValue in settings.ts */}
                <input
                  className={`${styles.input} ${focusedIndex === idxUrl ? styles.focused : ''}`}
                  type="text"
                  value={draft.url}
                  onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                  onClick={() => tapItem(idxUrl)}
                  onFocus={() => setKeyboardField('url')}
                  ref={focusedIndex === idxUrl ? setFocusRef : undefined}
                  tabIndex={focusedIndex === idxUrl ? 0 : -1}
                />
              </label>

              <div className={styles.field}>
                <label>
                  <span className={styles.fieldLabel}>Token</span>
                  {/* SECURITY (issue #134): masked like a password, stored in
                      plain text with the blob (documented trade-off), and
                      NEVER logged — see the file header */}
                  <input
                    className={`${styles.input} ${focusedIndex === idxToken ? styles.focused : ''}`}
                    type="password"
                    value={draft.token}
                    onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
                    onClick={() => tapItem(idxToken)}
                    onFocus={() => setKeyboardField('token')}
                    ref={focusedIndex === idxToken ? setFocusRef : undefined}
                    tabIndex={focusedIndex === idxToken ? 0 : -1}
                  />
                </label>
                <span className={styles.fieldHint}>Zugangstoken der Music-Assistant-Instanz</span>
              </div>
            </>
          ) : null}

          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${
              focusedIndex === idxSave ? styles.focused : ''
            }`}
            ref={focusedIndex === idxSave ? setFocusRef : undefined}
            tabIndex={focusedIndex === idxSave ? 0 : -1}
            onClick={() => {
              tapItem(idxSave)
              handleSave()
            }}
          >
            Speichern
          </button>
        </div>
      </div>

      {/* the on-screen keyboard for the focused field — its own focus entry
          on top of the modal's (Back closes the keyboard first, then the
          modal; the modal's dial focus stays on the field in the meantime,
          Bug10-2 hierarchy) */}
      {keyboardField !== null && (
        <HaKeyboardOverlay
          field={keyboardField}
          value={draft[keyboardField]}
          onChange={(v) => setDraft((d) => ({ ...d, [keyboardField]: v }))}
          onClose={() => setKeyboardField(null)}
        />
      )}
    </div>
  )
}

export const MaSettingsModal = memo(MaSettingsModalImpl)
