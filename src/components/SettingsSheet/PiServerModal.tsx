import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  checkMiraServer,
  getMiraServerState,
  useMiraServer,
} from '@/hooks/useMiraServer'
import {
  activePiProfile,
  defaultPiProfile,
  getSettings,
  updateActivePiProfileField,
  updateSettings,
  useSettings,
  type PiProfile,
} from '@/settings'
import {
  getPiSetupStatus,
  SETUP_PI_POLL_MS,
  SETUP_PI_UI_CAP_MS,
  startPiSetup,
  type SetupPiStatus,
} from '@/api/piServer'
import { fetchPiStatus, type PiConn, type PiStatus } from '@/api/piStatus'
import type { PiKeyboardField } from './PiKeyboardOverlay'
import styles from './PiServerModal.module.scss'

// epic10 task 4: the "Raspberry Pi" settings view — connection status, the
// ip / ssh credentials (persisted with the settings store), the capabilities
// test against the entered ip, and the daemon-side provisioning wizard with
// its status log.
// ticket10-5A: the view operates on the ACTIVE Pi profile (the single
// profile that the legacy config migrated into). The profile LIST (add /
// switch / delete) arrives with the follow-up worker 10-5C — until then
// there is exactly one profile in play, and on a fresh install the fields
// show the ticket defaults until the first write lazily creates profile 1.
interface Props {
  onClose: () => void
  // ticket10-2: tapping/focusing a credential field opens the on-screen
  // keyboard overlay (rendered by the App above this modal) for that field
  onOpenKeyboard: (field: PiKeyboardField) => void
}

// the values shown while no profile exists yet (display defaults — they are
// NOT persisted; the first write creates profile 1, see
// updateActivePiProfileField)
const EMPTY_PROFILE: PiProfile = defaultPiProfile()

// the status line of the ticket (model only known after a provisioning run
// reported it via /api/setup-pi/status)
function statusLineFor(mode: 'standalone' | 'lightweight' | 'compute', model: string | null): string {
  if (mode === 'standalone') return 'Getrennt (Standalone)'
  if (mode === 'compute') {
    return model ? `Verbunden (${model} - Compute Mode)` : 'Verbunden (Compute Mode)'
  }
  return model ? `Connected (${model} - Cache Only)` : 'Connected (Cache Only)'
}

// ticket10-3: the SSH key status line below the mode line — a key error
// always wins (clear message, no half state), otherwise the installed flag
// decides between key login and password login
function keyLineFor(installed: boolean, error: string | undefined): string {
  if (error) return `Key-Setup fehlgeschlagen: ${error}`
  if (installed) return 'SSH-Key installiert'
  return 'Passwort-Login erforderlich'
}

// ticket10-4: the age of the last reconnect attempt in whole seconds
// (RFC3339 UTC timestamp vs now, rounded; null = no usable timestamp —
// unparsable or future values are treated as missing, clock skew never
// renders negative)
function attemptAgeSeconds(rfc3339: string | undefined, now: number): number | null {
  if (!rfc3339) return null
  const t = Date.parse(rfc3339)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 1000))
}

// ticket10-4: the live SSH-session status line — the texts are exactly the
// ones from the ticket. The model/tier suffix is the last known-good
// provisioning result (remembered while connected, kept for
// connecting/disconnected); its format mirrors the mode line
// ("<model> - Compute Mode" / "<model> - Cache Only"). While connecting the
// line carries the attempt age instead (the ticket's format), no suffix.
function piLineFor(
  conn: PiConn,
  model: string | undefined,
  tier: string | undefined,
  ageSeconds: number | null,
): string {
  if (conn === 'connecting') {
    return ageSeconds === null
      ? 'Verbinde…'
      : `Verbinde… (letzter Versuch vor ${ageSeconds}s)`
  }
  const suffix = model
    ? tier === 'compute'
      ? `${model} - Compute Mode`
      : tier === 'lightweight'
        ? `${model} - Cache Only`
        : model
    : tier === 'compute'
      ? 'Compute Mode'
      : tier === 'lightweight'
        ? 'Cache Only'
        : ''
  const base = conn === 'connected' ? 'Verbunden' : 'Getrennt'
  return suffix ? `${base} (${suffix})` : base
}

type TestState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; ok: boolean; mode: 'standalone' | 'lightweight' | 'compute' }

type SetupState = {
  phase: 'idle' | 'starting' | 'running' | 'success' | 'failed'
  error?: string
  logTail: string[]
  model?: string
  tier?: string
}

const SETUP_IDLE: SetupState = { phase: 'idle', logTail: [] }

function PiServerModalImpl({ onClose, onOpenKeyboard }: Props) {
  // the settings store is the single source of truth — every keystroke is
  // persisted (localStorage + the daemon's settings blob) via
  // updateActivePiProfileField (ticket10-5A: writes go to the ACTIVE
  // profile)
  const settings = useSettings()
  const activeProfile = activePiProfile(settings)
  const profile = activeProfile ?? EMPTY_PROFILE
  const miraServer = useMiraServer()

  // model / tier the last provisioning run detected (null until known) —
  // feeds the mode line's model suffix (setup-status data source, ticket10-3)
  const [piInfo, setPiInfo] = useState<{ model?: string; tier?: string } | null>(null)
  // ticket10-3: SSH key status from the status endpoint (null until the
  // first successful status read — probe or live poll; a key error is the
  // daemon's clear failure message, empty/missing = no error)
  const [keyInfo, setKeyInfo] = useState<{ installed: boolean; error?: string } | null>(null)
  // ticket10-4: live SSH-session state from GET /api/pi/status (null until
  // the first successful read — old daemon (503) / offline keeps the line
  // hidden, same degradation as the key line and the model info). The age
  // of the last attempt is computed in the poll tick (NOT during render —
  // Date.now is impure) and refreshes with every 2 s tick
  const [piStatus, setPiStatus] = useState<{ status: PiStatus; ageSeconds: number | null } | null>(null)
  // ticket10-4: the "letzter guter Zustand" of the live session line — the
  // model/tier remembered while connected, kept for connecting/disconnected
  // (own cache, NOT piInfo: the mode line keeps its setup-status data
  // source, so the two lines do not mirror each other)
  const [piModel, setPiModel] = useState<{ model?: string; tier?: string } | null>(null)
  // ticket10-5A: persist the key result into the ACTIVE profile — the
  // daemon only holds the last run in memory, the per-profile keyInstalled
  // flag in the settings store is what the follow-up worker's profile list
  // shows per profile. No-op while no profile exists yet.
  const persistKeyInstalled = useCallback((installed: boolean) => {
    const cur = getSettings()
    const active = activePiProfile(cur)
    if (!active || active.keyInstalled === installed) return
    updateSettings({
      piProfiles: cur.piProfiles.map((p) =>
        p.id === active.id ? { ...p, keyInstalled: installed } : p,
      ),
    })
  }, [])
  // best-effort probe on open: a run that finished in a previous session
  // still has its model AND key state in the daemon's in-memory status —
  // this is what makes the key line visible in the idle state after a run
  // (the daemon installs the key at the end of the run, so the idle status
  // already reflects the outcome; no extra polling needed)
  useEffect(() => {
    let cancelled = false
    void getPiSetupStatus()
      .then((s) => {
        if (cancelled) return
        if (s.model || s.tier) setPiInfo({ model: s.model, tier: s.tier })
        setKeyInfo({ installed: s.keyInstalled, error: s.keyError })
        persistKeyInstalled(s.keyInstalled)
      })
      .catch(() => {
        // old daemon without the endpoints (503) or offline — no info
      })
    return () => {
      cancelled = true
    }
  }, [persistKeyInstalled])

  const [test, setTest] = useState<TestState>({ phase: 'idle' })
  const [setup, setSetup] = useState<SetupState>(SETUP_IDLE)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // ticket10-4: wall-time start of the active provisioning run (null =
  // idle) — the shared 2 s interval serves the run only while this is set
  const runStartedAtRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])
  // the shared interval must not outlive the view (unmount or closing the
  // modal)
  useEffect(() => stopPolling, [stopPolling])

  // ticket10-5A: every keystroke writes the ACTIVE profile (the first write
  // lazily creates profile 1 — see updateActivePiProfileField)
  const setField = (field: 'ip' | 'user' | 'password', value: string) => {
    updateActivePiProfileField(field, value)
  }

  // "Verbindung testen": pings the capabilities endpoint of the shown ip
  // (the active profile, or the ticket defaults while none exists yet).
  // checkMiraServer never throws (it degrades to standalone internally), so
  // the result is read from the shared state.
  const handleTest = async () => {
    if (test.phase === 'checking') return
    setTest({ phase: 'checking' })
    try {
      await checkMiraServer(profile.ip)
    } catch {
      // unreachable in theory — treat as a failed test
    }
    const mode = getMiraServerState().mode
    setTest({ phase: 'done', ok: mode !== 'standalone', mode })
  }

  // one tick of the shared 2 s rhythm (SETUP_PI_POLL_MS). Design decision
  // (ticket10-4B): ONE interval drives BOTH status feeds — the live Pi
  // session status (always) and the provisioning job status (only while a
  // run is active) — instead of a second, parallel poll; the request rate
  // on the local daemon stays bounded and the interval dies with the view.
  // A finished run only clears runStartedAtRef (the rhythm keeps serving
  // the session status until unmount). idle means the daemon reset
  // (e.g. restart) — keep watching until the wall-time cap.
  const pollTick = useCallback(async () => {
    // (1) ticket10-4: the live session status — part of every tick
    try {
      const s = await fetchPiStatus()
      // "letzter guter Zustand": remembered while connected, kept for
      // connecting / disconnected
      if (s.conn === 'connected' && (s.model || s.tier)) {
        setPiModel({ model: s.model, tier: s.tier })
      }
      setPiStatus({ status: s, ageSeconds: attemptAgeSeconds(s.lastAttemptAt, Date.now()) })
    } catch {
      // daemon unreachable for a moment — keep the last known state, the
      // next tick retries (no flicker, the line does not disappear)
    }
    // (2) the wizard job status — only while a run is active
    const startedAt = runStartedAtRef.current
    if (startedAt === null) return
    let status: SetupPiStatus
    try {
      status = await getPiSetupStatus()
    } catch {
      return // daemon unreachable for a moment — the next tick retries
    }
    if (Date.now() - startedAt > SETUP_PI_UI_CAP_MS) {
      runStartedAtRef.current = null
      setSetup({
        phase: 'failed',
        error: 'Setup took longer than 5 minutes — give up',
        logTail: status.logTail,
      })
      return
    }
    if (status.state === 'running') {
      setSetup((cur) => (cur.logTail === status.logTail ? cur : { ...cur, logTail: status.logTail }))
      return
    }
    if (status.state === 'success') {
      runStartedAtRef.current = null
      setSetup({
        phase: 'success',
        model: status.model,
        tier: status.tier,
        logTail: status.logTail,
      })
      if (status.model || status.tier) {
        setPiInfo({ model: status.model, tier: status.tier })
      }
      // the run just finished — the key outcome is part of this status
      setKeyInfo({ installed: status.keyInstalled, error: status.keyError })
      persistKeyInstalled(status.keyInstalled)
      return
    }
    if (status.state === 'failed') {
      runStartedAtRef.current = null
      setSetup({
        phase: 'failed',
        error: status.error ?? 'The setup failed',
        logTail: status.logTail,
      })
      // a failed run never installed a key — surface the key error if any
      setKeyInfo({ installed: status.keyInstalled, error: status.keyError })
      persistKeyInstalled(status.keyInstalled)
    }
  }, [persistKeyInstalled])

  // ticket10-4: immediate first read of the live session status + the
  // shared 2 s rhythm for the lifetime of the view (it also serves the
  // wizard job status while a run is active). The first read is scheduled
  // in a promise callback (the probe above does the same) — a plain call
  // in the effect body trips react-hooks/set-state-in-effect
  useEffect(() => {
    void Promise.resolve().then(() => {
      void pollTick()
    })
    pollRef.current = setInterval(() => {
      void pollTick()
    }, SETUP_PI_POLL_MS)
  }, [pollTick])

  // "Pi automatisch einrichten": POST the credentials to the local daemon;
  // the shared 2 s interval (already running since mount) then serves the
  // job status (capped at 5 min of wall time).
  // ticket10-5A: the wizard operates on the ACTIVE profile. On a fresh
  // install none exists yet — the setup run materializes profile 1 from the
  // shown (default) values, so the wizard keeps working before the profile
  // list UI arrives (design decision, follow-up worker 10-5C builds the
  // explicit add flow on top).
  const handleSetup = async () => {
    if (setup.phase === 'starting' || setup.phase === 'running') return
    setSetup({ phase: 'starting', logTail: [] })
    let stored = activePiProfile(getSettings())
    if (!stored) {
      stored = defaultPiProfile()
      updateSettings({ piProfiles: [stored], activePiId: stored.id })
    }
    try {
      await startPiSetup({
        ip: stored.ip,
        user: stored.user,
        password: stored.password,
      })
    } catch (err) {
      setSetup({
        phase: 'failed',
        error: err instanceof Error ? err.message : 'The setup could not be started',
        logTail: [],
      })
      return
    }
    setSetup({ phase: 'running', logTail: [] })
    runStartedAtRef.current = Date.now()
    void pollTick()
  }

  const statusLine = statusLineFor(miraServer.mode, piInfo?.model ?? null)
  const testBusy = test.phase === 'checking' || setup.phase === 'starting' || setup.phase === 'running'

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Raspberry Pi</span>
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
            className={`${styles.status} ${
              miraServer.mode === 'standalone' ? styles.statusOff : styles.statusOn
            }`}
          >
            {statusLine}
          </div>
          {/* ticket10-4: the live SSH-session status between the mode line
              and the key line (hidden until the first successful read —
              old daemon (503) / offline, same degradation as the key line) */}
          {piStatus !== null && (
            <div
              className={`${styles.piLine} ${
                piStatus.status.conn === 'connected' ? styles.piLineOn : styles.piLineMuted
              }`}
            >
              {piLineFor(
                piStatus.status.conn,
                piStatus.status.model ?? piModel?.model,
                piStatus.status.tier ?? piModel?.tier,
                piStatus.ageSeconds,
              )}
            </div>
          )}
          {/* ticket10-3: key status below the mode line (hidden until the
              first successful status read — old daemon / offline) */}
          {keyInfo !== null && (
            <div
              className={`${styles.keyLine} ${
                keyInfo.error
                  ? styles.keyLineError
                  : keyInfo.installed
                    ? styles.keyLineOk
                    : styles.keyLineWarn
              }`}
            >
              {keyLineFor(keyInfo.installed, keyInfo.error)}
            </div>
          )}
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>IP-Adresse</span>
          {/* ticket10-2: tapping/focusing a credential field opens the on-screen keyboard */}
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={profile.ip}
            onChange={(e) => setField('ip', e.target.value)}
            onFocus={() => onOpenKeyboard('ip')}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>SSH Benutzer</span>
          <input
            className={styles.input}
            type="text"
            value={profile.user}
            onChange={(e) => setField('user', e.target.value)}
            onFocus={() => onOpenKeyboard('user')}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>SSH Passwort</span>
          {/* security: stored in the plain settings store (localStorage +
              daemon blob) — open point, no encryption in this version */}
          <input
            className={styles.input}
            type="password"
            value={profile.password}
            onChange={(e) => setField('password', e.target.value)}
            onFocus={() => onOpenKeyboard('password')}
          />
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            disabled={testBusy}
            onClick={() => void handleTest()}
          >
            {test.phase === 'checking' ? 'Prüfe…' : 'Verbindung testen'}
          </button>
          {test.phase === 'done' && (
            <span className={test.ok ? styles.testOk : styles.testFail}>
              {test.ok
                ? test.mode === 'compute'
                  ? 'Test: Verbunden (Compute Mode)'
                  : 'Test: Verbunden (Cache Only)'
                : 'Test: Getrennt'}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={testBusy}
          onClick={() => void handleSetup()}
        >
          {setup.phase === 'starting'
            ? 'Starte Einrichtung…'
            : setup.phase === 'running'
              ? 'Einrichtung läuft…'
              : 'Pi automatisch einrichten'}
        </button>

        {setup.phase === 'failed' && setup.error && (
          <div className={styles.setupError}>{setup.error}</div>
        )}
        {setup.phase === 'success' && (
          <div className={styles.setupSuccess}>
            Erfolgreich eingerichtet
            {setup.model ? ` — ${setup.model}` : ''}
            {setup.tier ? ` (${setup.tier})` : ''}
          </div>
        )}
        {setup.logTail.length > 0 && (
          <pre className={styles.log} aria-label="Einrichtungs-Log">
            {setup.logTail.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}

export const PiServerModal = memo(PiServerModalImpl)
