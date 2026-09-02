import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  checkMiraServer,
  getMiraServerState,
  useMiraServer,
} from '@/hooks/useMiraServer'
import { getSettings, updateSettings, useSettings } from '@/settings'
import {
  getPiSetupStatus,
  SETUP_PI_POLL_MS,
  SETUP_PI_UI_CAP_MS,
  startPiSetup,
  type SetupPiStatus,
} from '@/api/piServer'
import styles from './PiServerModal.module.scss'

// epic10 task 4: the "Raspberry Pi" settings view — connection status, the
// ip / ssh credentials (persisted with the settings store), the capabilities
// test against the entered ip, and the daemon-side provisioning wizard with
// its status log.
interface Props {
  onClose: () => void
}

// the status line of the ticket (model only known after a provisioning run
// reported it via /api/setup-pi/status)
function statusLineFor(mode: 'standalone' | 'lightweight' | 'compute', model: string | null): string {
  if (mode === 'standalone') return 'Getrennt (Standalone)'
  if (mode === 'compute') {
    return model ? `Verbunden (${model} - Compute Mode)` : 'Verbunden (Compute Mode)'
  }
  return model ? `Connected (${model} - Cache Only)` : 'Connected (Cache Only)'
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

function PiServerModalImpl({ onClose }: Props) {
  // the settings store is the single source of truth — every keystroke is
  // persisted (localStorage + the daemon's settings blob) via updateSettings
  const settings = useSettings()
  const { piServer } = settings
  const miraServer = useMiraServer()

  // model / tier the last provisioning run detected (null until known)
  const [piInfo, setPiInfo] = useState<{ model?: string; tier?: string } | null>(null)
  // best-effort probe on open: a run that finished in a previous session
  // still has its model in the daemon's in-memory status
  useEffect(() => {
    let cancelled = false
    void getPiSetupStatus()
      .then((s) => {
        if (!cancelled && (s.model || s.tier)) setPiInfo({ model: s.model, tier: s.tier })
      })
      .catch(() => {
        // old daemon without the endpoints (503) or offline — no model info
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [test, setTest] = useState<TestState>({ phase: 'idle' })
  const [setup, setSetup] = useState<SetupState>(SETUP_IDLE)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])
  // a wizard run must not outlive the view (unmount or closing the modal)
  useEffect(() => stopPolling, [stopPolling])

  const setField = (field: 'ip' | 'user' | 'password', value: string) => {
    const current = getSettings().piServer
    updateSettings({ piServer: { ...current, [field]: value } })
  }

  // "Verbindung testen": pings the capabilities endpoint of the ENTERED ip
  // (the background poll keeps using the default address — documented in
  // fetchMiraServerCapabilities). checkMiraServer never throws (it degrades
  // to standalone internally), so the result is read from the shared state.
  const handleTest = async () => {
    if (test.phase === 'checking') return
    setTest({ phase: 'checking' })
    try {
      await checkMiraServer(piServer.ip)
    } catch {
      // unreachable in theory — treat as a failed test
    }
    const mode = getMiraServerState().mode
    setTest({ phase: 'done', ok: mode !== 'standalone', mode })
  }

  // one status tick of the running wizard; resolves the run on success /
  // failed and stops watching. idle means the daemon reset (e.g. restart) —
  // keep watching until the wall-time cap.
  const pollTick = async (startedAt: number) => {
    let status: SetupPiStatus
    try {
      status = await getPiSetupStatus()
    } catch {
      return // daemon unreachable for a moment — the next tick retries
    }
    if (Date.now() - startedAt > SETUP_PI_UI_CAP_MS) {
      stopPolling()
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
      stopPolling()
      setSetup({
        phase: 'success',
        model: status.model,
        tier: status.tier,
        logTail: status.logTail,
      })
      if (status.model || status.tier) {
        setPiInfo({ model: status.model, tier: status.tier })
      }
      return
    }
    if (status.state === 'failed') {
      stopPolling()
      setSetup({
        phase: 'failed',
        error: status.error ?? 'The setup failed',
        logTail: status.logTail,
      })
    }
  }

  // "Pi automatisch einrichten": POST the credentials to the local daemon,
  // then poll the job status every 2s (capped at 5 min of wall time)
  const handleSetup = async () => {
    if (setup.phase === 'starting' || setup.phase === 'running') return
    stopPolling()
    setSetup({ phase: 'starting', logTail: [] })
    try {
      await startPiSetup({
        ip: piServer.ip,
        user: piServer.user,
        password: piServer.password,
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
    const startedAt = Date.now()
    void pollTick(startedAt)
    pollRef.current = setInterval(() => {
      void pollTick(startedAt)
    }, SETUP_PI_POLL_MS)
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
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>IP-Adresse</span>
          <input
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={piServer.ip}
            onChange={(e) => setField('ip', e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>SSH Benutzer</span>
          <input
            className={styles.input}
            type="text"
            value={piServer.user}
            onChange={(e) => setField('user', e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>SSH Passwort</span>
          {/* security: stored in the plain settings store (localStorage +
              daemon blob) — open point, no encryption in this version */}
          <input
            className={styles.input}
            type="password"
            value={piServer.password}
            onChange={(e) => setField('password', e.target.value)}
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
