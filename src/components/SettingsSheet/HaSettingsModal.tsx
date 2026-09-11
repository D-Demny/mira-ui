import { memo, useCallback, useEffect, useState } from 'react'
import { HaSettingsApiError, haLogin } from '@/api/haSettings'
import { getSettings, updateSettings, type HaSettingsValue } from '@/settings'
import { useHaStatus } from '@/hooks/useHaStatus'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { HaKeyboardOverlay, type HaKeyboardField } from './HaKeyboardOverlay'
import styles from './HaSettingsModal.module.scss'

// ticket 9.4: the "Home Assistant" settings view — 1:1 the PiServerModal
// structure (backdrop > fixed card shell > .content scroll container,
// Bug10-1/Bug51): the status line (useHaStatus), the three credential
// fields (URL/IP:Port / Username / Passwort, dial focus chain + on-screen
// keyboard) and the two action buttons ("Verbindung testen" = probe only,
// never persists; "Speichern" = transactional save, optionally preceded by
// the daemon's WS login that mints the fresh 10-year token).
//
// DRAFT MODEL (differs from the Pi modal on purpose): the fields are
// modal-local draft state, NOT store-backed. The Pi fields persist on every
// keystroke; here only "Speichern" may write the settings store (the test
// button must not change the daemon's HA config, ticket 9.4 design §3).
//
// SAVE RULE (documented): on "Speichern"
//   1. when username AND password are set AND (no token is stored yet, OR
//      the stored token is not from a login, OR the stored credentials
//      differ from the entered ones) → the daemon's WS login runs
//      (haLogin) and mints a fresh 10-year long-lived token →
//      tokenSource: 'login'
//   2. otherwise the stored token + tokenSource are kept as-is (a valid
//      login token needs no re-login; an empty token stays empty with
//      tokenSource 'default')
// A login failure saves NOTHING (no store write) and shows the concrete
// error class instead (Bug53 .errorDetail pattern).
//
// KEYBOARD: a dedicated HaKeyboardOverlay instance (own HaKeyboardField
// union + label map) rendered INSIDE the modal's backdrop — its focus entry
// lands on top of the modal's entry, so Back closes the keyboard first and
// the modal second (the Bug10-2 hierarchy). The PiKeyboardField union is
// not extended: the Pi keyboard is coupled to the piProfiles store writes,
// while the HA keyboard edits the modal's draft via value/onChange props.
//
// SECURITY (ticket 9.4 hard constraint): the username, password and token
// are never logged (no console.* with credential values anywhere in this
// file) and never surface in the error lines (haErrorDetail emits only the
// error class + the host part of the URL).

interface Props {
  onClose: () => void
}

// the focus list in visual order (the dial chain): the three credential
// fields, then the action buttons — ONE useOverlayListFocus entry routes
// wheel/Enter/Back over the whole list (bug31 pattern, 1:1 PiServerModal)
type FocusItem =
  | { kind: 'field'; field: HaKeyboardField }
  | { kind: 'test' }
  | { kind: 'save' }

const FOCUS_ITEMS: FocusItem[] = [
  { kind: 'field', field: 'url' },
  { kind: 'field', field: 'username' },
  { kind: 'field', field: 'password' },
  { kind: 'test' },
  { kind: 'save' },
]

const IDX_URL = 0
const IDX_USERNAME = 1
const IDX_PASSWORD = 2
const IDX_TEST = 3
const IDX_SAVE = 4

// 'http://10.10.1.104:8123' → '10.10.1.104:8123' — the status/error lines
// name the host only (a URL with a trailing path would only add noise)
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Bug53: the concrete error line per failure class (no generic "Error").
// `detail` is either the typed HaSettingsApiError.code (save flow) or the
// error message the status hook recorded for a failed probe (the message
// always carries the class string — see errorFrom in haSettings.ts). Only
// the class + the host are rendered — never a credential value.
function haErrorDetail(detail: string, host: string): string {
  if (detail.includes('invalid_credentials')) return 'Benutzername oder Passwort falsch'
  if (detail.includes('mfa')) return '2FA aktiv — Access Token manuell eingeben (Phase 2)'
  if (detail.includes('unreachable')) {
    return host !== '' ? `Nicht erreichbar (Timeout für ${host})` : 'Nicht erreichbar'
  }
  // 'not available' = the HaSettingsApiError MESSAGE wording for the
  // 'not_available' code (non-JSON body = the daemon predates the endpoints)
  if (detail.includes('not_available') || detail.includes('not available')) {
    return 'HA-Login nicht verfügbar (Daemon veraltet?)'
  }
  if (detail.includes('timeout')) return 'Zeitüberschreitung — Daemon antwortet nicht'
  if (detail.includes('network')) return 'Daemon nicht erreichbar (Netzwerkfehler)'
  if (detail.includes('bad_request')) return 'Ungültige URL'
  return detail
}

interface DraftState {
  url: string
  username: string
  password: string
}

function HaSettingsModalImpl({ onClose }: Props) {
  const st = useHaStatus()
  // stable (useCallback in the hook) — the mount-only effect below depends
  // on them only
  const { probe, refetchEntities } = st

  // the draft — initialized from the saved ha config (the settings store is
  // the only source of pre-fill values; see the DRAFT MODEL above)
  const [draft, setDraft] = useState<DraftState>(() => {
    const ha = getSettings().ha
    return { url: ha.url, username: ha.username, password: ha.password }
  })
  const [keyboardField, setKeyboardField] = useState<HaKeyboardField | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // the URL value shown in the field AND used by test/save/probe (task 7):
  // the entered draft value, falling back to the daemon's build-time
  // default URL (the POST /api/ha/test response's defaults.url — the only
  // way the UI learns it) while the config is still 'default' and a probe
  // has delivered it
  const urlValue =
    draft.url !== ''
      ? draft.url
      : st.base === 'default' && st.defaultUrl !== null
        ? st.defaultUrl
        : ''

  // the stored token (the probe uses it when present — the draft has no
  // token field, manual tokens are phase 2)
  const savedToken = getSettings().ha.token

  // probe on open (ticket: the connection status is established "beim
  // Modal-Open + nach Aktionen" — no ambient polling): the saved url with
  // the stored token. An empty url is not probed (the daemon answers 400
  // for it — there is simply nothing to probe yet).
  useEffect(() => {
    const ha = getSettings().ha
    if (ha.url !== '') {
      probe(ha.url, ha.token !== '' ? ha.token : undefined)
    }
  }, [probe])

  // "Verbindung testen": PROBE ONLY (design §3) — the daemon's
  // POST /api/ha/test with the current URL value and the stored token (when
  // present). No store write, no login; the result updates the status line
  // via the hook.
  const handleTest = useCallback(() => {
    setSaveError(null)
    const url = urlValue.trim()
    if (url === '') return
    probe(url, savedToken !== '' ? savedToken : undefined)
  }, [probe, savedToken, urlValue])

  // "Speichern": transactional (see the SAVE RULE in the file header). A
  // login failure writes NOTHING to the store and surfaces the concrete
  // error class instead.
  const handleSave = async () => {
    if (saving || st.probing) return
    const url = urlValue.trim()
    if (url === '') return
    const cur = getSettings().ha
    // re-login only when the stored token is not already a valid login
    // result for exactly these credentials (the simple rule, documented
    // above): token missing, or not from a login, or credentials changed
    // since the last login
    const needsLogin =
      draft.username !== '' &&
      draft.password !== '' &&
      (cur.token === '' ||
        cur.tokenSource !== 'login' ||
        cur.username !== draft.username ||
        cur.password !== draft.password)
    setSaving(true)
    setSaveError(null)
    try {
      let token = cur.token
      let tokenSource: HaSettingsValue['tokenSource'] = cur.tokenSource
      if (needsLogin) {
        const res = await haLogin({ url, username: draft.username, password: draft.password })
        token = res.token
        tokenSource = 'login'
      }
      // the single store write — the whole ha object (token + source
      // included), never a partial
      updateSettings({
        ha: {
          url,
          username: draft.username,
          password: draft.password,
          token,
          tokenSource,
        },
      })
      // re-sync after the action (ticket: "nach Aktionen"): probe the
      // freshly saved values (status line → "Konfiguriert — verbunden, N
      // Entitäten") and force a fresh entity catalog fetch (the 60 s-TTL
      // cache may still hold the pre-save state)
      probe(url, token !== '' ? token : undefined)
      refetchEntities()
    } catch (err) {
      // SECURITY: only the error class (+ host) is rendered — never the
      // credentials (the HaSettingsApiError message itself carries no
      // credential value, see haSettings.ts)
      const host = hostOf(url)
      setSaveError(
        err instanceof HaSettingsApiError
          ? haErrorDetail(err.code, host)
          : err instanceof Error
            ? err.message
            : 'Speichern fehlgeschlagen',
      )
    } finally {
      setSaving(false)
    }
  }

  // the dial confirm action (1:1 the PiServerModal handleFocusItem):
  // fields open the on-screen keyboard for exactly that field, the buttons
  // run their action
  const handleFocusItem = (index: number) => {
    const item = FOCUS_ITEMS[index]
    if (!item) return
    if (item.kind === 'field') {
      setKeyboardField(item.field)
      setSaveError(null)
    } else if (item.kind === 'test') {
      handleTest()
    } else {
      void handleSave()
    }
  }

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: FOCUS_ITEMS.length,
    initialIndex: 0,
    onConfirm: handleFocusItem,
    onBack: onClose,
  })

  // the status line (design §3) — the hook's 5-state status decides (a
  // successful probe result wins over the base status, useHaStatus
  // contract); while the probe is in flight the loading line shows
  let statusLine: string
  let statusOn = false
  if (st.probing) {
    statusLine = 'Prüfe Verbindung…'
  } else if (st.connection === 'authenticated') {
    statusLine = `Konfiguriert — verbunden, ${st.entityCount} Entitäten`
    statusOn = true
  } else if (st.connection === 'reachable-unauth') {
    statusLine = 'Konfiguriert — nicht authentifiziert (401)'
  } else if (st.connection === 'unreachable') {
    statusLine = st.probedUrl !== '' ? `Nicht erreichbar (${hostOf(st.probedUrl)})` : 'Nicht erreichbar'
  } else if (st.base === 'configured') {
    statusLine = 'Konfiguriert'
  } else {
    // 'default' without a probe result: the daemon's build-time defaults
    // apply — the default URL is shown once a probe has delivered it
    statusLine =
      st.defaultUrl !== null ? `Nicht konfiguriert (Default: ${st.defaultUrl})` : 'Nicht konfiguriert'
  }

  const busy = st.probing || saving

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Bug10-1: the card above is the fixed shell; this block is the
            vertical scroll container (overflow-y: auto) — the header, the
            credential fields and the buttons all live in normal document
            flow inside it, so the blocks can never render on top of each
            other when the content exceeds the 800x480 display height */}
        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <span className={styles.title}>Home Assistant</span>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Close"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div
              className={`${styles.status} ${statusOn ? styles.statusOn : styles.statusOff}`}
            >
              {statusLine}
            </div>
          </div>

          {/* the probe error (a failed probe — daemon timeout, bad request,
              old daemon) — the concrete reason, Bug53 pattern */}
          {st.probeError !== null && (
            <div className={styles.errorDetail}>
              {haErrorDetail(st.probeError, hostOf(st.probedUrl))}
            </div>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>URL/IP:Port</span>
            {/* tapping/focusing the field opens the on-screen keyboard;
                Bug10-2: the field is part of the dial focus chain — the
                .focused class highlights it, the hook's setFocusRef scrolls
                it into the .content scroll container */}
            <input
              className={`${styles.input} ${focusedIndex === IDX_URL ? styles.focused : ''}`}
              type="text"
              value={urlValue}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              onClick={() => tapItem(IDX_URL)}
              onFocus={() => setKeyboardField('url')}
              ref={focusedIndex === IDX_URL ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_URL ? 0 : -1}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Username</span>
            <input
              className={`${styles.input} ${focusedIndex === IDX_USERNAME ? styles.focused : ''}`}
              type="text"
              value={draft.username}
              onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              onClick={() => tapItem(IDX_USERNAME)}
              onFocus={() => setKeyboardField('username')}
              ref={focusedIndex === IDX_USERNAME ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_USERNAME ? 0 : -1}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Passwort</span>
            {/* the password is masked (type="password" + the keyboard's
                '•' preview); it is stored in plain text with the settings
                blob (documented trade-off, same as PiProfile.password) and
                is NEVER logged */}
            <input
              className={`${styles.input} ${focusedIndex === IDX_PASSWORD ? styles.focused : ''}`}
              type="password"
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              onClick={() => tapItem(IDX_PASSWORD)}
              onFocus={() => setKeyboardField('password')}
              ref={focusedIndex === IDX_PASSWORD ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_PASSWORD ? 0 : -1}
            />
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${focusedIndex === IDX_TEST ? styles.focused : ''}`}
              ref={focusedIndex === IDX_TEST ? setFocusRef : undefined}
              tabIndex={focusedIndex === IDX_TEST ? 0 : -1}
              disabled={busy || urlValue.trim() === ''}
              onClick={() => {
                tapItem(IDX_TEST)
                handleTest()
              }}
            >
              Verbindung testen
            </button>
          </div>

          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${
              focusedIndex === IDX_SAVE ? styles.focused : ''
            }`}
            ref={focusedIndex === IDX_SAVE ? setFocusRef : undefined}
            tabIndex={focusedIndex === IDX_SAVE ? 0 : -1}
            disabled={busy || urlValue.trim() === ''}
            onClick={() => {
              tapItem(IDX_SAVE)
              void handleSave()
            }}
          >
            {saving ? 'Speichere…' : 'Speichern'}
          </button>

          {/* the login/save error — the concrete failure reason (no store
              write happened on failure, see handleSave) */}
          {saveError !== null && <div className={styles.errorDetail}>{saveError}</div>}
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

export const HaSettingsModal = memo(HaSettingsModalImpl)
