import { memo, useCallback, useEffect, useState } from 'react'
import {
  fetchPiStatus,
  PI_STATUS_POLL_MS,
  type PiRecovery,
  type PiStatus,
} from '@/api/piStatus'
import { useSettings, type PiProfile } from '@/settings'
import styles from './ConnectionChooser.module.scss'

// when no internet is present we show these options
// TODO: bluetooth descoverablilty should only be set when the bluetooth screen is shown
//
// ticket10-6C: the THIRD card "Setup USB Tethering" (USB-tethering onboarding
// for a freshly flashed RPi, ticket10-6) is shown ONLY when
//   (a) the Mira has no internet (the mount condition in App.tsx — this
//       component is rendered in the offline branch only), AND
//   (b) NO SSH key exists for ANY profile — the "already recognized"
//       pre-check of the ticket (constraint 1): a key + profile is the
//       recognition marker (ticket10-3/10-5), and a recognized RPi does not
//       get the onboarding, it gets the daemon's one-time reboot recovery
//       instead. Key state precedence is the ticket10-5C rule: the daemon's
//       live /api/pi/status `profiles[].key_installed` (device-side key
//       presence — ground truth) wins once it has been read and lists the
//       profile, otherwise the settings store's per-profile `keyInstalled`
//       flag decides. No profiles at all → no key → the card is shown
//       (fresh install = the ticket's ideal flow).
//   (c) the reboot recovery is IDLE: the `recovery` field of
//       /api/pi/status is omitted (or the daemon is too old, 503). While the
//       recovery is running (rebooting / waiting_after_reboot) the card is
//       REPLACED by a recovery status panel — the onboarding must not be
//       offered while the daemon is deliberately holding its breath for the
//       RPi boot (ticket constraint 3: no false conclusions, no
//       re-onboarding).
//
// 503 behavior (documented worker review): a failed status read (old daemon
// = 503, or the daemon unreachable for a moment) keeps the LAST KNOWN state
// (never read → null). Null means "recovery unknown = treat as IDLE" → the
// card is shown if the key check passes. The key check then falls back to
// the settings flags (the daemon precedence applies only to a status that
// was actually read). An old daemon therefore behaves exactly like the
// pre-10-6 chooser + store-only key detection.
//
// The component polls /api/pi/status on the shared 2 s rhythm
// (PI_STATUS_POLL_MS) for its whole (short-lived) lifetime; the interval
// dies with the unmount (the chooser disappears with the internet).

interface Props {
  onPickPc: () => void
  onPickBluetooth: () => void
  // ticket10-6C: opens the USB-tethering onboarding wizard
  onPickUsbTethering: () => void
}

function BluetoothIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.5 6.5l11 11-5.5 5.5V1l5.5 5.5-11 11" />
    </svg>
  )
}

function PcIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

// the classic USB trident — axis with arrow (top) and circle (bottom), one
// branch to a square. Decorative (aria-hidden like the other card icons)
function UsbIcon({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="20" x2="12" y2="6" />
      <path d="M8.5 8.5L12 4l3.5 4.5" />
      <circle cx="12" cy="20" r="1.8" />
      <line x1="12" y1="13" x2="17.5" y2="9.5" />
      <rect x="16" y="5.5" width="4" height="4" />
    </svg>
  )
}

// ticket10-6C: per-profile key state precedence (the ticket10-5C rule,
// documented in PiServerModal): the daemon's live profiles[] entry wins
// once the status was read and lists the profile, otherwise the settings
// flag. The chooser needs the "does ANY profile have a key" form.
function hasKeyFor(profile: PiProfile, status: PiStatus | null): boolean {
  if (status !== null) {
    const entry = status.profiles?.find((e) => e.id === profile.id)
    if (entry) return entry.keyInstalled
  }
  return profile.keyInstalled
}

// the age of the recovery start in whole seconds (RFC3339 UTC vs now,
// rounded, clamped ≥ 0 — clock skew never renders negative; null = no
// usable timestamp, the panel then shows the state without an age)
function recoveryAgeSeconds(rfc3339: string | undefined, now: number): number | null {
  if (!rfc3339) return null
  const t = Date.parse(rfc3339)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 1000))
}

// the recovery status panel texts (worker review, ticket10-6 spirit; the
// texts follow the 10-6B daemon contract): 'rebooting' = the daemon just
// rebooted the RPi and waits for it to come back (the Mira itself may
// reboot with it — same power); 'waiting_after_reboot' = after the (double)
// reboot the daemon waits patiently for the COMPLETE RPi boot (the RPi
// boots slower than the Mira — no false conclusions from early SSH
// failures, ticket constraint 3)
function recoveryTextFor(recovery: PiRecovery, ageSeconds: number | null): string {
  const base =
    recovery === 'rebooting'
      ? 'RPi wird neu gestartet — bitte warten…'
      : 'Warte auf RPi-Boot…'
  return ageSeconds === null ? base : `${base} (seit ${ageSeconds}s)`
}

function ConnectionChooserImpl({ onPickPc, onPickBluetooth, onPickUsbTethering }: Props) {
  const settings = useSettings()
  const profiles = settings.piProfiles
  // null = the status was never read (old daemon 503 / offline) — treated
  // as "recovery idle" + store-only key check (see the 503 note above)
  const [piStatus, setPiStatus] = useState<PiStatus | null>(null)
  // the recovery age, computed in the poll tick (NOT during render —
  // Date.now is impure, same pattern as the PiServerModal's attempt age)
  const [recoveryAge, setRecoveryAge] = useState<number | null>(null)

  const tick = useCallback(async () => {
    try {
      const s = await fetchPiStatus()
      setPiStatus(s)
      if (s.recovery) {
        setRecoveryAge(recoveryAgeSeconds(s.recoveryStartedAt, Date.now()))
      } else {
        setRecoveryAge(null)
      }
    } catch {
      // old daemon (503) or unreachable for a moment — keep the last known
      // state (no flicker; never read stays null = idle, see above)
    }
  }, [])

  // immediate first read + the 2 s rhythm for the component's lifetime
  useEffect(() => {
    void Promise.resolve().then(() => {
      void tick()
    })
    const id = setInterval(() => {
      void tick()
    }, PI_STATUS_POLL_MS)
    return () => clearInterval(id)
  }, [tick])

  // ticket10-6C: the display logic of the third card (see the header notes)
  const recovery: PiRecovery | undefined = piStatus?.recovery
  const hasAnyKey = profiles.some((p) => hasKeyFor(p, piStatus))
  const showTetheringCard = !hasAnyKey && recovery === undefined

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Choose a connection method</h1>

      <div className={`${styles.cards} ${showTetheringCard ? styles.cardsThree : ''}`}>
        <button type="button" className={styles.card} onClick={onPickPc} aria-label="Connect to PC">
          <span className={styles.iconWrap} aria-hidden>
            <PcIcon />
          </span>
          <span className={styles.cardLabel}>Connect to PC</span>
        </button>

        <button
          type="button"
          className={styles.card}
          onClick={onPickBluetooth}
          aria-label="Connect with Bluetooth"
        >
          <span className={styles.iconWrap} aria-hidden>
            <BluetoothIcon />
          </span>
          <span className={styles.cardLabel}>Connect with Bluetooth</span>
        </button>

        {showTetheringCard ? (
          <button
            type="button"
            className={styles.card}
            onClick={onPickUsbTethering}
            aria-label="Setup USB Tethering"
          >
            <span className={styles.iconWrap} aria-hidden>
              <UsbIcon />
            </span>
            <span className={styles.cardLabel}>Setup USB Tethering</span>
          </button>
        ) : recovery !== undefined ? (
          // the recovery replaces the onboarding card: the daemon rebooted
          // the RPi (or is waiting for its boot) and the onboarding must not
          // be offered in the meantime
          <div
            className={`${styles.card} ${styles.recoveryCard}`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.iconWrap} aria-hidden>
              <UsbIcon />
            </span>
            <span className={styles.recoveryText}>
              {recoveryTextFor(recovery, recoveryAge)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const ConnectionChooser = memo(ConnectionChooserImpl)
