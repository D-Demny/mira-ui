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
  newPiProfile,
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
import { deletePiProfile } from '@/api/piProfile'
import { fetchPiStatus, type PiConn, type PiStatus } from '@/api/piStatus'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import type { PiKeyboardField } from './PiKeyboardOverlay'
import styles from './PiServerModal.module.scss'

// epic10 task 4: the "Raspberry Pi" settings view — connection status, the
// ip / ssh credentials (persisted with the settings store), the capabilities
// test against the entered ip, and the daemon-side provisioning wizard with
// its status log.
// ticket10-5C: the view now shows the PROFILE LIST (add / switch / delete)
// on top of the single-profile wizard: every row carries label, ip and the
// per-profile status (the live session state of the ACTIVE profile only —
// inactive profiles have no live session; the key state per profile), and
// the "aktiv" marker names the profile that decides the capabilities target
// (ticket10-5A). The credential fields below the list edit the ACTIVE
// profile (label / ip / user / password via the on-screen keyboard,
// ticket10-2); "Profil hinzufügen" creates the next profile (pi-N), makes it
// active, and the existing wizard button starts the provisioning for it
// (POST /api/setup-pi with profile_id, ticket10-5B contract). Deletion goes
// through a confirmation overlay and the daemon's
// DELETE /api/pi/profile (device key + the reachable Pi's authorized_keys).

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

// ticket10-5C: per-profile key state precedence (design decision,
// documented): the DAEMON's live /api/pi/status `profiles[].key_installed`
// (device-side key pair presence — the ground truth, re-read from the
// settings blob by the daemon on every tick) wins once the status has been
// read at least once (piStatus !== null) and lists the profile. Otherwise
// the SETTINGS flag (the UI's own record, persisted after the provisioning
// run) is shown. Old daemons (503) never fill piStatus → settings only.
function keyInstalledFor(profile: PiProfile, piStatus: { status: PiStatus } | null): boolean {
  if (piStatus !== null) {
    const entry = piStatus.status.profiles?.find((e) => e.id === profile.id)
    if (entry) return entry.keyInstalled
  }
  return profile.keyInstalled
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

// ticket10-5C: the dial-focus items of the view, in visual order — the
// profile rows first, then the action buttons. ONE useOverlayListFocus
// entry (bug31/bug46 pattern) routes wheel/Enter/Back over the whole list;
// Back closes the view (the delete confirmation and the keyboard push their
// own entries on top, so they close first — the ticket's back hierarchy).
type FocusItem =
  | { kind: 'profile'; id: string }
  | { kind: 'add' }
  | { kind: 'delete' }
  | { kind: 'test' }
  | { kind: 'setup' }

// ticket10-5C: the profile deletion confirmation — its own small overlay
// with its own ListFocusContext entry, so Back closes the dialog FIRST,
// then the profile list, then the menu. Focus starts on "Abbrechen" (the
// safe default); the destructive action needs an explicit dial press.
function DeleteConfirmDialog({
  label,
  ip,
  onConfirm,
  onCancel,
}: {
  label: string
  ip: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: 2,
    initialIndex: 0,
    onConfirm: (index) => {
      if (index === 1) onConfirm()
      else onCancel()
    },
    onBack: onCancel,
  })
  return (
    // the dialog is nested inside the modal's backdrop (single-root
    // component) — a click on the dimmed area must cancel the dialog and
    // NOT bubble to the modal's own backdrop (that would close both at
    // once), hence the explicit stopPropagation
    <div
      className={styles.confirmBackdrop}
      onClick={(e) => {
        e.stopPropagation()
        onCancel()
      }}
    >
      <div
        className={styles.confirmCard}
        role="dialog"
        aria-label="Profil entfernen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.confirmTitle}>Profil entfernen</div>
        <div className={styles.confirmText}>
          «{label}» ({ip}) wird entfernt — der SSH-Key wird vom Gerät und, wenn erreichbar, vom Pi
          gelöscht.
        </div>
        <div className={styles.confirmButtons}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGrow} ${
              focusedIndex === 0 ? styles.focused : ''
            }`}
            ref={focusedIndex === 0 ? setFocusRef : undefined}
            tabIndex={focusedIndex === 0 ? 0 : -1}
            onClick={() => {
              tapItem(0)
              onCancel()
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGrow} ${styles.btnDanger} ${
              focusedIndex === 1 ? styles.focused : ''
            }`}
            ref={focusedIndex === 1 ? setFocusRef : undefined}
            tabIndex={focusedIndex === 1 ? 0 : -1}
            onClick={() => {
              tapItem(1)
              onConfirm()
            }}
          >
            Entfernen
          </button>
        </div>
      </div>
    </div>
  )
}

function PiServerModalImpl({ onClose, onOpenKeyboard }: Props) {
  // the settings store is the single source of truth — every keystroke is
  // persisted (localStorage + the daemon's settings blob) via
  // updateActivePiProfileField (ticket10-5A: writes go to the ACTIVE
  // profile; ticket10-5C: the label joins the editable set)
  const settings = useSettings()
  const profiles = settings.piProfiles
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
  // Date.now is impure) and refreshes with every 2 s tick. ticket10-5: the
  // status now also carries the per-profile key existence (profiles) and
  // the bound profile id (profileId)
  const [piStatus, setPiStatus] = useState<{ status: PiStatus; ageSeconds: number | null } | null>(null)
  // ticket10-4: the "letzter guter Zustand" of the live session line — the
  // model/tier remembered while connected, kept for connecting/disconnected
  // (own cache, NOT piInfo: the mode line keeps its setup-status data
  // source, so the two lines do not mirror each other)
  const [piModel, setPiModel] = useState<{ model?: string; tier?: string } | null>(null)
  // ticket10-5C: the delete confirmation overlay (null = closed) + the
  // surfaced daemon cleanup error (best-effort, see handleDeleteProfile)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // ticket10-5A: persist the key result into the ACTIVE profile — the
  // daemon only holds the last run in memory, the per-profile keyInstalled
  // flag in the settings store is what the profile list shows per profile
  // (daemon status takes precedence once it is read, see keyInstalledFor)
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
  // already reflects the outcome; no extra polling needed).
  // ticket10-5C: the probe is DISPLAY-ONLY — it no longer persists
  // keyInstalled into the store. A fresh daemon (restart) has an empty
  // in-memory state (key_installed: false) even though the device-side key
  // file still exists; persisting that false would clobber the store's
  // record (the per-profile key flag the list falls back to). Only a
  // FINISHED RUN is a trustworthy key outcome — that is what
  // persistKeyInstalled is called for (pollTick's success/failed branches).
  useEffect(() => {
    let cancelled = false
    void getPiSetupStatus()
      .then((s) => {
        if (cancelled) return
        if (s.model || s.tier) setPiInfo({ model: s.model, tier: s.tier })
        setKeyInfo({ installed: s.keyInstalled, error: s.keyError })
      })
      .catch(() => {
        // old daemon without the endpoints (503) or offline — no info
      })
    return () => {
      cancelled = true
    }
  }, [])

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
  const setField = (field: 'label' | 'ip' | 'user' | 'password', value: string) => {
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
  // list UI exists. ticket10-5C: the POST carries the explicit profile_id
  // (the 10-5B contract) — the daemon would resolve a missing id to the
  // active profile from the blob anyway, the explicit id keeps the run
  // unambiguous (e.g. a stale active id on a hand-edited blob).
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
        profileId: stored.id,
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

  // ticket10-5C: "Profil hinzufügen" — create the next profile (id pi-N,
  // the gap-aware next number, label "Pi N", ticket-default ip) and make it
  // active IMMEDIATELY: the credential fields below (and the keyboard) now
  // edit it, and the existing wizard button starts the provisioning for it
  // (the POST carries its profile_id). The profile is stored from the first
  // field write onward and STAYS active after a successful run — the
  // retarget to the new ip happens with the activePiId write (ticket10-5A
  // subscription), nothing else to wire.
  const handleAddProfile = () => {
    const cur = getSettings()
    const fresh = newPiProfile(cur.piProfiles)
    setDeleteError(null)
    updateSettings({ piProfiles: [...cur.piProfiles, fresh], activePiId: fresh.id })
  }

  // ticket10-5C: "Profil entfernen" — the button operates on the ACTIVE
  // profile (the one being edited; any other profile becomes the active
  // one by a single tap on its row first). Opens the confirmation overlay.
  const requestDelete = () => {
    if (!activePiProfile(getSettings())) return
    setConfirmDelete(true)
  }

  // ticket10-5C: remove the ACTIVE profile (confirmed). Design decisions
  // (documented): (1) the daemon cleanup (device-side key pair + the
  // reachable Pi's authorized_keys) is BEST-EFFORT — the profile is removed
  // from the store even when the daemon is unreachable or too old (503);
  // an orphaned device key file is harmless (it is only ever used via the
  // settings blob), and a cleanup error is surfaced below the list. (2)
  // deleting the ACTIVE profile makes the FIRST remaining profile active;
  // deleting the LAST profile leaves the list empty and activePiId null →
  // the app goes standalone (useMiraServer stops polling, the fields show
  // the display defaults, the list shows "Kein Pi konfiguriert").
  const handleDeleteProfile = async () => {
    const target = activePiProfile(getSettings())
    setConfirmDelete(false)
    if (!target) return
    try {
      await deletePiProfile(target.id, {
        ip: target.ip,
        user: target.user,
        password: target.password,
      })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'profile removal failed')
    }
    const cur = getSettings()
    const remaining = cur.piProfiles.filter((p) => p.id !== target.id)
    updateSettings({
      piProfiles: remaining,
      activePiId:
        remaining.length === 0
          ? null
          : cur.activePiId === target.id
            ? remaining[0].id
            : cur.activePiId,
    })
  }

  // ticket10-5C: switch the active profile. The settings write alone drives
  // everything (ticket10-5A/10-5B contracts): useMiraServer retargets the
  // capabilities poll and the /img/ routes immediately on the settings
  // subscription; this modal re-renders from useSettings (rows, fields,
  // status lines); the daemon re-binds its SSH session to the new (id, ip,
  // user, key) target on its next config read.
  const handleSelectProfile = (id: string) => {
    const cur = getSettings()
    if (cur.activePiId === id) return
    setDeleteError(null)
    updateSettings({ activePiId: id })
  }

  // ticket10-5C: the focus list in visual order + the single dial entry
  const focusItems: FocusItem[] = [
    ...profiles.map((p): FocusItem => ({ kind: 'profile', id: p.id })),
    { kind: 'add' },
    { kind: 'delete' },
    { kind: 'test' },
    { kind: 'setup' },
  ]
  const handleFocusItem = (index: number) => {
    const item = focusItems[index]
    if (!item) return
    if (item.kind === 'profile') {
      handleSelectProfile(item.id)
    } else if (item.kind === 'add') {
      handleAddProfile()
    } else if (item.kind === 'delete') {
      requestDelete()
    } else if (item.kind === 'test') {
      void handleTest()
    } else {
      void handleSetup()
    }
  }
  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: focusItems.length,
    initialIndex: 0,
    onConfirm: handleFocusItem,
    onBack: onClose,
  })

  const idxAdd = profiles.length
  const idxDelete = profiles.length + 1
  const idxTest = profiles.length + 2
  const idxSetup = profiles.length + 3

  const statusLine = statusLineFor(miraServer.mode, piInfo?.model ?? null)
  const testBusy = test.phase === 'checking' || setup.phase === 'starting' || setup.phase === 'running'

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Bug10-1: the card above is the fixed shell; this block is the
            vertical scroll container (overflow-y: auto) — the header,
            profile list, credential fields and buttons all live in normal
            document flow inside it, so the blocks can never render at
            fixed offsets on top of each other when the content exceeds
            the display height (800x480 device). */}
        <div className={styles.content}>
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

        {/* ticket10-5C: the profile list — label + ip per row, the live
            session state of the ACTIVE profile only (inactive profiles
            have no live session), the per-profile key state (daemon status
            first, settings flag as fallback — keyInstalledFor), and the
            "aktiv" marker. Tap/confirm on a row switches the active
            profile; the row of the active profile is a no-op. */}
        <ul className={styles.profileList}>
          {profiles.length === 0 ? (
            <li className={styles.emptyHint}>Kein Pi konfiguriert</li>
          ) : (
            profiles.map((p, i) => {
              const isActive = activeProfile !== null && p.id === activeProfile.id
              // the live session state exists only for the ACTIVE profile
              // (and only once the daemon status has been read at least once)
              const conn: PiConn | null =
                isActive && piStatus !== null ? piStatus.status.conn : null
              const keyOk = keyInstalledFor(p, piStatus)
              return (
                <li
                  key={p.id}
                  role="button"
                  tabIndex={focusedIndex === i ? 0 : -1}
                  className={[
                    styles.profileRow,
                    focusedIndex === i ? styles.focused : '',
                    isActive ? styles.profileActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={focusedIndex === i ? setFocusRef : undefined}
                  onClick={() => {
                    tapItem(i)
                    handleSelectProfile(p.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectProfile(p.id)
                    }
                  }}
                >
                  <span className={styles.profileMain}>
                    <span className={styles.profileLabel}>{p.label}</span>
                    {isActive && <span className={styles.activeTag}>aktiv</span>}
                    <span className={styles.profileIp}>{p.ip}</span>
                  </span>
                  <span className={styles.profileStatus}>
                    {conn !== null && (
                      <span className={conn === 'connected' ? styles.connOn : styles.connOff}>
                        {conn === 'connected' ? 'Verbunden' : 'Getrennt'}
                      </span>
                    )}
                    <span className={keyOk ? styles.keyTagOk : styles.keyTagWarn}>
                      {keyOk ? 'SSH-Key installiert' : 'Passwort-Login erforderlich'}
                    </span>
                  </span>
                </li>
              )
            })
          )}
        </ul>
        {deleteError !== null && <div className={styles.setupError}>{deleteError}</div>}

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Profil-Name</span>
          {/* ticket10-2/10-5C: tapping/focusing a profile field opens the
              on-screen keyboard for the ACTIVE profile */}
          <input
            className={styles.input}
            type="text"
            value={profile.label}
            onChange={(e) => setField('label', e.target.value)}
            onFocus={() => onOpenKeyboard('label')}
          />
        </label>

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

        {/* ticket10-5C: the profile management actions (part of the same
            dial focus list as the rows above, in this visual order) */}
        <div className={styles.profileActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGrow} ${
              focusedIndex === idxAdd ? styles.focused : ''
            }`}
            ref={focusedIndex === idxAdd ? setFocusRef : undefined}
            tabIndex={focusedIndex === idxAdd ? 0 : -1}
            onClick={() => {
              tapItem(idxAdd)
              handleAddProfile()
            }}
          >
            Profil hinzufügen
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGrow} ${
              focusedIndex === idxDelete ? styles.focused : ''
            }`}
            ref={focusedIndex === idxDelete ? setFocusRef : undefined}
            tabIndex={focusedIndex === idxDelete ? 0 : -1}
            disabled={profiles.length === 0}
            onClick={() => {
              tapItem(idxDelete)
              requestDelete()
            }}
          >
            Profil entfernen
          </button>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${focusedIndex === idxTest ? styles.focused : ''}`}
            ref={focusedIndex === idxTest ? setFocusRef : undefined}
            tabIndex={focusedIndex === idxTest ? 0 : -1}
            disabled={testBusy}
            onClick={() => {
              tapItem(idxTest)
              void handleTest()
            }}
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
          className={`${styles.btn} ${styles.btnPrimary} ${
            focusedIndex === idxSetup ? styles.focused : ''
          }`}
          ref={focusedIndex === idxSetup ? setFocusRef : undefined}
          tabIndex={focusedIndex === idxSetup ? 0 : -1}
          disabled={testBusy}
          onClick={() => {
            tapItem(idxSetup)
            void handleSetup()
          }}
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

      {/* ticket10-5C: the deletion confirmation (its own focus entry —
          Back closes it first, then the profile list, then the menu) */}
      {confirmDelete && activeProfile !== null && (
        <DeleteConfirmDialog
          label={activeProfile.label}
          ip={activeProfile.ip}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void handleDeleteProfile()}
        />
      )}
    </div>
  )
}

export const PiServerModal = memo(PiServerModalImpl)
