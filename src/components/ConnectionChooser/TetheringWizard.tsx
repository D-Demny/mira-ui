import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getPiSetupStatus,
  SETUP_PI_FETCH_FAIL_LIMIT,
  SETUP_PI_POLL_MS,
  SETUP_PI_UI_CAP_MS,
  startPiSetup,
  type SetupPiStatus,
} from '@/api/piServer'
import {
  getPiTetheringStatus,
  startPiTethering,
  TETHERING_FETCH_FAIL_LIMIT,
  TETHERING_POLL_MS,
  TETHERING_UI_CAP_MS,
  type TetheringUplink,
} from '@/api/piTethering'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import {
  activePiProfile,
  getSettings,
  newPiProfile,
  updateSettings,
  useSettings,
} from '@/settings'
import type { PiKeyboardField } from '../SettingsSheet/PiKeyboardOverlay'
import styles from './TetheringWizard.module.scss'

// ticket10-6C: the USB-tethering onboarding wizard — the flow of the
// ticket's "Flow Specification" (new Mira, freshly flashed RPi, no
// internet):
//
//   (1) keyboard: SSH user        (ticket10-2, opens AUTOMATICALLY)
//   (2) keyboard: SSH password    (ticket10-2, opens automatically after
//                                   the user keyboard closed non-empty)
//   (3) automatic: POST /api/setup-pi with the profile credentials
//       (+ profile_id, ticket10-5B) + 2 s poll on /api/setup-pi/status
//       → short visual notification for 3 s whether the login worked
//   (4) on success the SSH key install + model detection ran INSIDE the
//       daemon run (ticket10-3): the key/model outcome of that run is
//       shown on the tethering screen, then AUTOMATICALLY
//   (5) automatic: POST /api/pi/tethering (+ profile_id) + 2 s poll on
//       /api/pi/tethering/status (ticket10-6A contract)
//   (6) final notification: success (incl. uplink info Ethernet/WLAN) or
//       failure (message + "Wiederholen")
//
// Design decisions (worker review, documented):
// - PROFILE: the wizard operates on the ACTIVE profile. On a fresh install
//   (no profiles — the exact case that shows the chooser card) it creates
//   the next profile (newPiProfile, ticket10-5C pattern) and makes it
//   active on mount. When profiles without a key already exist (a failed
//   earlier onboarding), the active one is REUSED (its ip may already be
//   right) — the card is only shown when NO profile has a key, so reusing
//   never clobbers a recognized Pi.
// - KEYBOARD HANDOFF: the keyboard overlay is rendered by the App (above
//   this view) and edits the active profile (ticket10-2). The wizard
//   auto-opens it on entering a step (ticket: selecting the card opens the
//   user keyboard directly) and advances on the open→CLOSED edge with a
//   non-empty value; an empty value keeps the step with a hint (explicit
//   "eingeben" button to re-open).
// - 3 s BANNER: an IN-WIZARD banner (not the global TopBanner — the
//   wizard is a full-screen guided flow and the banner is part of it),
//   shown for exactly 3 s (RESULT_BANNER_MS) after the setup run settled:
//   "SSH-Login erfolgreich" or "SSH-Login fehlgeschlagen" + error. After
//   the timer: success → the tethering step starts automatically;
//   failure → the failure screen (no half state: the profile is kept
//   exactly as stored — all flow state lives in the settings store).
// - RETRY PATHS: "Erneut versuchen" (login failure) restarts the flow at
//   the user step (credentials are editable again); "Wiederholen"
//   (tethering failure) re-runs ONLY the tethering step (the key + profile
//   are intact, the daemon script is re-run safe). Both are dial-reachable;
//   "Menü" always goes back to the connection chooser.
// - OLD DAEMON: 503 on /api/pi/tethering (pre-10-6A daemon) lands the
//   wizard on the final failure screen with the daemon's message + retry —
//   the user can go back to the menu; nothing is left half-configured.
// - FOCUS: ONE useOverlayListFocus entry (bug31/bug46 pattern) over the
//   current step's buttons; the keyboard pushes its own entry on top while
//   open, so Back closes the keyboard FIRST, then the wizard, then nothing
//   (the chooser has no entry — same as before ticket10-6C).
// - CR69: no flex `gap` in the styles (Bug49 lesson) — margin-based
//   spacing via the flex-gap-y/flex-gap-x mixins.

interface Props {
  // back to the connection chooser (hardware Back + the "Menü" button)
  onBack: () => void
  // opens the on-screen keyboard overlay for the active profile's field
  // (rendered by the App above this view)
  onOpenKeyboard: (field: PiKeyboardField) => void
  // the keyboard currently open (the App's piKeyboardField state) — the
  // wizard reads it to detect the open→closed hand-off edges
  keyboardField: PiKeyboardField | null
}

// the 3 s visual notification of the ticket's flow step 6
const RESULT_BANNER_MS = 3000

type Phase =
  | 'user' // (1) SSH user entry (keyboard auto-opened)
  | 'pass' // (2) SSH password entry (keyboard auto-opened)
  | 'setup-running' // (3) the setup-pi run is in flight (2 s poll)
  | 'setup-banner' // (6a) the 3 s login result banner
  | 'setup-failed' // (6b) login failed → menu / retry
  | 'tether-running' // (5) the tethering run is in flight (2 s poll)
  | 'tether-done' // (6) final notification (ok or failed)

type BannerKind = 'ok' | 'fail'

// the outcome of the setup run, kept for the key/model line of the
// tethering screen (ticket: key setup + model marker run inside the
// wizard, the status shows the key state / the model)
interface SetupOutcome {
  installed: boolean
  keyError?: string
  model?: string
  tier?: string
}

interface TetherResult {
  ok: boolean
  error?: string
  uplink?: TetheringUplink
  tetheringOk: boolean
  internetOk: boolean
}

// the uplink names for the final notification (ticket: "distinguishing
// whether the RPi is connected to the network via Ethernet or via WLAN")
function uplinkLabel(uplink: TetheringUplink | undefined): string {
  if (uplink === 'eth') return 'Ethernet'
  if (uplink === 'wlan') return 'WLAN'
  if (uplink === 'none') return 'kein Uplink'
  return 'unbekannt'
}

// the failure lines of the final tethering notification — built from the
// machine-readable RESULT fields (uplink / tethering_ok / internet_ok,
// ticket10-6A) because the daemon's raw error for a non-zero script exit
// is just "exit status 1"; the daemon message is appended when present
function tetherFailureLines(r: TetherResult): string[] {
  const lines: string[] = []
  if (r.uplink === 'none') lines.push('Kein Uplink am RPi (kein Ethernet, kein WLAN)')
  else if (!r.tetheringOk) lines.push('USB-Tethering konnte nicht eingerichtet werden')
  if (!r.internetOk) lines.push('Kein Internet über das USB-Tethering')
  if (r.error) lines.push(r.error)
  return lines.length > 0 ? lines : ['Tethering-Einrichtung fehlgeschlagen']
}

// the key/model line of the tethering screen (same texts as the
// PiServerModal's key line — one voice for the key state)
function setupOutcomeLine(o: SetupOutcome): string {
  if (o.keyError) return `Key-Setup fehlgeschlagen: ${o.keyError}`
  const key = o.installed ? 'SSH-Key installiert' : 'Passwort-Login erforderlich'
  if (o.model) {
    const tier = o.tier === 'compute' ? ' (Compute Mode)' : o.tier === 'lightweight' ? ' (Cache Only)' : ''
    return `${key} · ${o.model}${tier}`
  }
  return key
}

function TetheringWizardImpl({ onBack, onOpenKeyboard, keyboardField }: Props) {
  const settings = useSettings()
  const profile = activePiProfile(settings)
  const [phase, setPhase] = useState<Phase>('user')
  const [hint, setHint] = useState<string | null>(null)
  const [bannerKind, setBannerKind] = useState<BannerKind>('ok')
  const [setupLog, setSetupLog] = useState<string[]>([])
  const [setupError, setSetupError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null)
  const [tetherLog, setTetherLog] = useState<string[]>([])
  const [tetherUplink, setTetherUplink] = useState<TetheringUplink | undefined>(undefined)
  const [tetherResult, setTetherResult] = useState<TetherResult | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const setupStartedAtRef = useRef<number | null>(null)
  const tetherStartedAtRef = useRef<number | null>(null)
  // ticket10-7 G13: consecutive job-status fetch failures per running step
  // — a continuously unreachable daemon has lost its in-memory job, so the
  // run cannot finish; each run gives up after its FETCH_FAIL_LIMIT
  // (15 × 2 s = 30 s) instead of polling until the wall-time cap. The steps
  // stay decoupled (only one is ever active), hence one counter each
  const setupFetchFailsRef = useRef(0)
  const tetherFetchFailsRef = useRef(0)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the keyboard hand-off is EDGE-triggered (open→closed), not level
  // triggered: prevKb remembers the previous keyboardField, the opened*
  // refs keep the auto-open from re-firing on every render
  const prevKbRef = useRef<PiKeyboardField | null>(null)
  const openedUserRef = useRef(false)
  const openedPassRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])
  const clearBanner = useCallback(() => {
    if (bannerTimerRef.current !== null) {
      clearTimeout(bannerTimerRef.current)
      bannerTimerRef.current = null
    }
  }, [])
  // nothing may outlive the view (the wizard unmounts with the offline
  // screen — internet arrived, or the user went back to the chooser)
  useEffect(() => {
    return () => {
      stopPolling()
      clearBanner()
    }
  }, [stopPolling, clearBanner])

  // ticket10-6C: materialize a profile for the flow (design decision:
  // fresh install = the ticket's ideal flow → create the next profile and
  // make it active; existing key-less profiles → the active one is reused)
  useEffect(() => {
    const cur = getSettings()
    if (!activePiProfile(cur)) {
      const fresh = newPiProfile(cur.piProfiles)
      updateSettings({ piProfiles: [...cur.piProfiles, fresh], activePiId: fresh.id })
    }
  }, [])

  // one tick of the ACTIVE step's 2 s poll (the interval is (re)started by
  // startSetup / startTethering at the step's own rhythm — SETUP_PI_POLL_MS
  // and TETHERING_POLL_MS are both 2 s, but the steps stay decoupled so the
  // constants can diverge later). The step is passed explicitly: an interval
  // is only alive while its own step is active (stopPolling always precedes
  // leaving a running step), so the tick never sees a stale step
  const pollTick = useCallback(async (step: 'setup-running' | 'tether-running') => {
    if (step === 'setup-running') {
      // ticket10-7 G13: the wall-time cap is evaluated BEFORE the status
      // fetch (before: after it) — with a dead daemon the fetch fails every
      // tick and a cap behind it would never run (the run would show "läuft"
      // forever on top of one failing request per 2 s)
      const startedAt = setupStartedAtRef.current
      if (startedAt !== null && Date.now() - startedAt > SETUP_PI_UI_CAP_MS) {
        stopPolling()
        setSetupError('Setup took longer than 5 minutes — give up')
        setPhase('setup-failed')
        return
      }
      let status: SetupPiStatus
      try {
        status = await getPiSetupStatus()
      } catch {
        // ticket10-7 G13: a continuously unreachable daemon has lost its
        // in-memory job — give up after SETUP_PI_FETCH_FAIL_LIMIT consecutive
        // failures (15 × 2 s = 30 s) instead of polling until the cap. A
        // momentary blip never accumulates (a success resets the count)
        setupFetchFailsRef.current += 1
        if (setupFetchFailsRef.current >= SETUP_PI_FETCH_FAIL_LIMIT) {
          stopPolling()
          setSetupError('Daemon unreachable — the setup run cannot be tracked')
          setPhase('setup-failed')
        }
        return
      }
      setupFetchFailsRef.current = 0
      if (status.state === 'running') {
        setSetupLog((prev) => (prev === status.logTail ? prev : status.logTail))
        return
      }
      if (status.state === 'success') {
        stopPolling()
        setOutcome({
          installed: status.keyInstalled,
          keyError: status.keyError,
          model: status.model,
          tier: status.tier,
        })
        // the per-profile key record of the settings store (the profile
        // list and the chooser's card check read it — same persist as the
        // PiServerModal after a finished run)
        const cur = getSettings()
        const active = activePiProfile(cur)
        if (active && active.keyInstalled !== status.keyInstalled) {
          updateSettings({
            piProfiles: cur.piProfiles.map((pp) =>
              pp.id === active.id ? { ...pp, keyInstalled: status.keyInstalled } : pp,
            ),
          })
        }
        // the 3 s banner below owns the auto-advance to the tethering step
        setBannerKind('ok')
        setPhase('setup-banner')
        return
      }
      if (status.state === 'failed') {
        stopPolling()
        setOutcome({
          installed: status.keyInstalled,
          keyError: status.keyError,
          model: status.model,
          tier: status.tier,
        })
        setSetupError(status.error ?? 'The setup failed')
        setBannerKind('fail')
        setPhase('setup-banner')
      }
    } else {
      // ticket10-7 G13: the wall-time cap is evaluated BEFORE the status
      // fetch (before: after it) — with a dead daemon the fetch fails every
      // tick and a cap behind it would never run (the run would show "läuft"
      // forever on top of one failing request per 2 s). The cap path has no
      // fresh status: uplink stays undefined (the failure screen renders no
      // uplink line; only a detected 'none' uplink adds one) and both
      // achievement flags are false (the run's outcome is unknown)
      const startedAt = tetherStartedAtRef.current
      if (startedAt !== null && Date.now() - startedAt > TETHERING_UI_CAP_MS) {
        stopPolling()
        setTetherResult({ ok: false, error: 'Tethering took longer than 10 minutes — give up', uplink: undefined, tetheringOk: false, internetOk: false })
        setPhase('tether-done')
        return
      }
      let status
      try {
        status = await getPiTetheringStatus()
      } catch {
        // ticket10-7 G13: a continuously unreachable daemon has lost its
        // in-memory job — give up after TETHERING_FETCH_FAIL_LIMIT
        // consecutive failures (15 × 2 s = 30 s) instead of polling until
        // the cap. A momentary blip never accumulates (a success resets it)
        tetherFetchFailsRef.current += 1
        if (tetherFetchFailsRef.current >= TETHERING_FETCH_FAIL_LIMIT) {
          stopPolling()
          setTetherResult({ ok: false, error: 'Daemon unreachable — the tethering run cannot be tracked', uplink: undefined, tetheringOk: false, internetOk: false })
          setPhase('tether-done')
        }
        return
      }
      tetherFetchFailsRef.current = 0
      if (status.state === 'running') {
        setTetherLog((prev) => (prev === status.logTail ? prev : status.logTail))
        if (status.uplink) setTetherUplink(status.uplink)
        return
      }
      if (status.state === 'success' || status.state === 'failed') {
        stopPolling()
        if (status.state === 'success') {
          // the script exits 0 only when tethering AND internet are both ok
          setTetherResult({ ok: true, uplink: status.uplink, tetheringOk: status.tetheringOk, internetOk: status.internetOk })
        } else {
          setTetherResult({ ok: false, error: status.error, uplink: status.uplink, tetheringOk: status.tetheringOk, internetOk: status.internetOk })
        }
        setPhase('tether-done')
      }
    }
  }, [stopPolling])

  // (3) start the setup-pi run with the stored profile credentials
  const startSetup = useCallback(async () => {
    const p = activePiProfile(getSettings())
    if (!p) return
    setSetupLog([])
    setSetupError(null)
    setHint(null)
    setPhase('setup-running')
    try {
      await startPiSetup({
        ip: p.ip,
        user: p.user,
        password: p.password,
        // the explicit profile id (ticket10-5B contract) — the daemon
        // would resolve a missing id to the active profile anyway
        profileId: p.id,
      })
    } catch (err) {
      // the POST was rejected (400 validation / 409 busy / 500 / 503 old
      // daemon) — no run started, straight to the failure screen
      stopPolling()
      setSetupError(err instanceof Error ? err.message : 'Der Setup-Start ist fehlgeschlagen')
      setPhase('setup-failed')
      return
    }
    setupStartedAtRef.current = Date.now()
    // ticket10-7 G13: a fresh run gets a fresh failure budget (a give-up on
    // a previous run must not instantly fail this one)
    setupFetchFailsRef.current = 0
    pollRef.current = setInterval(() => {
      void pollTick('setup-running')
    }, SETUP_PI_POLL_MS)
    void pollTick('setup-running')
  }, [stopPolling, pollTick])

  // (5) start the tethering run (automatic after the success banner, or
  // the "Wiederholen" button on the failure screen)
  const startTethering = useCallback(async () => {
    const p = activePiProfile(getSettings())
    setTetherLog([])
    setTetherUplink(undefined)
    setTetherResult(null)
    setHint(null)
    setPhase('tether-running')
    try {
      await startPiTethering(p?.id)
    } catch (err) {
      // no run started (400 / 409 no-key / 500 script missing / 503 old
      // daemon) — the final screen carries the daemon's message + retry
      stopPolling()
      setTetherResult({ ok: false, error: err instanceof Error ? err.message : 'Tethering', tetheringOk: false, internetOk: false })
      setPhase('tether-done')
      return
    }
    tetherStartedAtRef.current = Date.now()
    // ticket10-7 G13: a fresh run gets a fresh failure budget (a give-up on
    // a previous run must not instantly fail this one)
    tetherFetchFailsRef.current = 0
    pollRef.current = setInterval(() => {
      void pollTick('tether-running')
    }, TETHERING_POLL_MS)
    void pollTick('tether-running')
  }, [stopPolling, pollTick])

  // the 3 s result banner of the ticket's flow step 6 — while the phase is
  // 'setup-banner' the timer runs here (the effect owns it, so an unmount
  // or a phase change always clears it): success → the tethering step starts
  // automatically, failure → the failure screen
  useEffect(() => {
    if (phase !== 'setup-banner') return
    bannerTimerRef.current = setTimeout(() => {
      bannerTimerRef.current = null
      if (bannerKind === 'ok') void startTethering()
      else setPhase('setup-failed')
    }, RESULT_BANNER_MS)
    return () => {
      if (bannerTimerRef.current !== null) {
        clearTimeout(bannerTimerRef.current)
        bannerTimerRef.current = null
      }
    }
  }, [phase, bannerKind, startTethering])

  // the dial buttons of the CURRENT step (the list is phase-dependent;
  // the waiting steps have none — the entry still routes Back to onBack);
  // memoized so the focus hook's dependencies stay stable per step
  const buttons = useMemo<{ id: 'menu' | 'enter-user' | 'enter-pass' | 'retry'; label: string }[]>(
    () =>
      phase === 'user'
        ? [{ id: 'enter-user', label: 'Benutzer eingeben' }]
        : phase === 'pass'
          ? [{ id: 'enter-pass', label: 'Passwort eingeben' }]
          : phase === 'setup-failed'
            ? [
                { id: 'menu', label: 'Menü' },
                { id: 'retry', label: 'Erneut versuchen' },
              ]
            : phase === 'tether-done'
              ? tetherResult?.ok
                ? [{ id: 'menu', label: 'Menü' }]
                : [
                    { id: 'menu', label: 'Menü' },
                    { id: 'retry', label: 'Wiederholen' },
                  ]
              : [],
    [phase, tetherResult],
  )

  const handleConfirm = useCallback(
    (index: number) => {
      const btn = buttons[index]
      if (!btn) return
      if (btn.id === 'menu') {
        onBack()
      } else if (btn.id === 'enter-user') {
        onOpenKeyboard('user')
      } else if (btn.id === 'enter-pass') {
        onOpenKeyboard('password')
      } else if (btn.id === 'retry') {
        if (phase === 'setup-failed') {
          // restart the whole flow at the user step (credentials editable
          // again; the stored profile is kept as-is — no half update)
          openedUserRef.current = false
          openedPassRef.current = false
          setOutcome(null)
          setHint(null)
          setPhase('user')
        } else if (phase === 'tether-done') {
          // re-run ONLY the tethering step (key + profile are intact)
          void startTethering()
        }
      }
    },
    [phase, buttons, onBack, onOpenKeyboard, startTethering],
  )

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: buttons.length,
    initialIndex: 0,
    onConfirm: handleConfirm,
    onBack,
  })

  // the auto-open of the keyboards (ticket: selecting the card opens the
  // user keyboard directly; the password keyboard follows after the user
  // step) — once per step entry (the opened* refs)
  useEffect(() => {
    if (phase === 'user' && keyboardField === null && !openedUserRef.current) {
      openedUserRef.current = true
      onOpenKeyboard('user')
    }
    if (phase === 'pass' && keyboardField === null && !openedPassRef.current) {
      openedPassRef.current = true
      onOpenKeyboard('password')
    }
  }, [phase, keyboardField, onOpenKeyboard])

  // the keyboard hand-off edges (open→closed): a non-empty value advances
  // the flow automatically (ticket: the script opens the SSH connection
  // automatically after the password), an empty one keeps the step. The
  // decision runs in a microtask, not the synchronous effect body (it reads
  // the store and mutates the phase state — the same Promise-deferral
  // pattern as the ConnectionChooser's first tick); the edge itself is
  // still detected synchronously so a fast close is never missed
  useEffect(() => {
    const prev = prevKbRef.current
    prevKbRef.current = keyboardField
    if (prev === null || keyboardField !== null) return
    const closed = prev
    void Promise.resolve().then(() => {
      if (closed === 'user' && phase === 'user') {
        const user = activePiProfile(getSettings())?.user
        if (user !== undefined && user.trim() !== '') {
          setHint(null)
          setPhase('pass')
        } else {
          setHint('Bitte zuerst den SSH-Benutzer eingeben.')
        }
      } else if (closed === 'password' && phase === 'pass') {
        const pass = activePiProfile(getSettings())?.password
        if (pass !== undefined && pass !== '') {
          setHint(null)
          void startSetup()
        } else {
          setHint('Bitte zuerst das SSH-Passwort eingeben.')
        }
      }
    })
  }, [keyboardField, phase, startSetup])

  const passwordPreview = profile?.password ? '•'.repeat(profile.password.length) : ''
  const stepLabel =
    phase === 'user'
      ? 'Schritt 1 von 4 · SSH-Benutzer'
      : phase === 'pass'
        ? 'Schritt 2 von 4 · SSH-Passwort'
        : phase === 'setup-running'
          ? 'Schritt 3 von 4 · Verbindung zum Pi'
          : phase === 'setup-banner'
            ? 'Schritt 3 von 4 · Verbindung zum Pi'
            : phase === 'setup-failed'
              ? 'Verbindung fehlgeschlagen'
              : phase === 'tether-running'
                ? 'Schritt 4 von 4 · USB-Tethering'
                : tetherResult?.ok
                  ? 'Fertig'
                  : 'Tethering fehlgeschlagen'

  const stepText =
    phase === 'user'
      ? 'Gib den SSH-Benutzer deines Raspberry Pi ein (z. B. „root“ oder „dietpi“).'
      : phase === 'pass'
        ? 'Gib das SSH-Passwort dieses Benutzers ein. Danach verbindet sich der Mira automatisch und installiert den SSH-Key.'
        : phase === 'setup-running'
          ? 'Der Mira öffnet die SSH-Verbindung und installiert den SSH-Key…'
          : phase === 'tether-running'
            ? 'Der Mira richtet das USB-Tethering am RPi ein und testet das Internet…'
            : phase === 'setup-failed'
              ? 'Prüfe Benutzer und Passwort und versuche es erneut.'
              : null

  return (
    <div className={styles.container}>
      <div className={styles.panel} role="dialog" aria-label="Setup USB Tethering">
        <div className={styles.stepLabel}>{stepLabel}</div>
        <h1 className={styles.title}>Setup USB Tethering</h1>

        {(phase === 'user' || phase === 'pass') && (
          <div className={styles.valueRow}>
            <span className={styles.valueKey}>
              {phase === 'user' ? 'Benutzer' : 'Passwort'}
            </span>
            <span className={styles.valueValue}>
              {phase === 'user'
                ? profile?.user || '—'
                : passwordPreview !== ''
                  ? passwordPreview
                  : '—'}
            </span>
          </div>
        )}

        {stepText && <p className={styles.hintText}>{stepText}</p>}
        {hint && <p className={styles.hintWarn}>{hint}</p>}

        {phase === 'setup-running' && (
          <div className={styles.waiting}>Verbinde…</div>
        )}

        {phase === 'setup-banner' && (
          <div
            className={bannerKind === 'ok' ? styles.bannerOk : styles.bannerFail}
            role="status"
          >
            {bannerKind === 'ok' ? 'SSH-Login erfolgreich' : 'SSH-Login fehlgeschlagen'}
            {bannerKind === 'fail' && setupError ? ` — ${setupError}` : ''}
          </div>
        )}

        {phase === 'setup-failed' && setupError && (
          <div className={styles.errorBox}>{setupError}</div>
        )}

        {phase === 'tether-running' && (
          <>
            <div className={styles.waiting}>
              Richte USB-Tethering ein…
              {tetherUplink ? ` (Uplink: ${uplinkLabel(tetherUplink)})` : ''}
            </div>
            {outcome && <div className={styles.outcomeLine}>{setupOutcomeLine(outcome)}</div>}
          </>
        )}

        {phase === 'tether-done' && tetherResult !== null && (
          tetherResult.ok ? (
            <div className={styles.doneOk}>
              Internet über USB-Tethering
              <span className={styles.uplinkLine}>RPi-Uplink: {uplinkLabel(tetherResult.uplink)}</span>
              <span className={styles.hintText}>
                Die Verbindung wird gleich umgeschaltet — das Menü schließt sich von selbst.
              </span>
            </div>
          ) : (
            <div className={styles.doneFail}>
              {tetherFailureLines(tetherResult).map((line) => (
                <div key={line} className={styles.errorBox}>
                  {line}
                </div>
              ))}
            </div>
          )
        )}

        {setupLog.length > 0 && (
          <pre className={styles.log} aria-label="Verbindungs-Log">
            {setupLog.join('\n')}
          </pre>
        )}
        {tetherLog.length > 0 && (
          <pre className={styles.log} aria-label="Tethering-Log">
            {tetherLog.join('\n')}
          </pre>
        )}

        <div className={styles.actions}>
          {buttons.map((btn, i) => (
            <button
              key={btn.id}
              type="button"
              className={`${styles.btn} ${
                btn.id === 'retry' ? styles.btnPrimary : ''
              } ${focusedIndex === i ? styles.focused : ''}`}
              ref={focusedIndex === i ? setFocusRef : undefined}
              tabIndex={focusedIndex === i ? 0 : -1}
              onClick={() => {
                tapItem(i)
                handleConfirm(i)
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const TetheringWizard = memo(TetheringWizardImpl)
