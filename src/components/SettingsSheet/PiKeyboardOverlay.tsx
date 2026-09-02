import { useCallback, useState } from 'react'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import {
  activePiProfile,
  defaultPiProfile,
  getSettings,
  updateActivePiProfileField,
  useSettings,
  type PiProfile,
} from '@/settings'
import styles from './PiKeyboardOverlay.module.scss'

// ticket10-2: on-screen keyboard for the PiServerModal credential fields
// (ip / user / password) — the 800×480 CR69 display has no physical keyboard.
//
// Design decisions (marked "final in worker review" in the ticket):
// - Dial model: a flat linear walk over all 40 keys in reading order with wrap
//   at both ends. The device has a single dial axis (wheel deltaX), so the
//   ticket's row-based proposal (left/right inside a row, up/down between rows)
//   reduces to this: turning past a row end continues on the next row, and
//   past the last key wraps to the first.
// - Layout: 4 rows × 10 keys (≈68×64 px, well above the 36 px minimum): digits
//   + '.', the full alphabet behind an `Aa` case toggle (lowercase by default
//   — usernames), ⌫, ␣, and a separate `OK` (done) button below the grid
//   (touch-only; for the dial, Back already closes the keyboard). '-' and '_'
//   are out of scope (default user is 'root'; plain usernames are the norm).
// - Back hierarchy: the overlay pushes a ListFocusContext entry (bug31/bug46
//   pattern), so Back/Escape is consumed while it is open and only the
//   keyboard closes. The PiServerModal (which has no entry of its own) closes
//   on the NEXT Back via the App-level goBack.
// - Field routing: every key action reads the latest value from the settings
//   store (getSettings) and writes it back (updateSettings) — the same
//   pattern as PiServerModal's setField. No local value state, so the modal's
//   inputs behind the overlay stay in sync.
// - Masking: the preview renders one '•' per password character; the modal's
//   own input is type="password". No Show/Hide key (ticket: optional; the grid
//   is full and plaintext persistence is a documented open point anyway).
// - CR69: no flex `gap` in this module (Chrome 84+; Bug49 lesson) — all
//   spacing is margin-based via the flex-gap-x/flex-gap-y mixins.

export type PiKeyboardField = 'ip' | 'user' | 'password'

const FIELD_LABELS: Record<PiKeyboardField, string> = {
  ip: 'IP-Adresse',
  user: 'SSH Benutzer',
  password: 'SSH Passwort',
}

type KeyDef =
  | { kind: 'char'; char: string }
  | { kind: 'backspace' }
  | { kind: 'space' }
  | { kind: 'case' }

function charKey(c: string): KeyDef {
  return { kind: 'char', char: c }
}

// the 40 keys in reading order (= the dial order, see the layout decision
// above): digits + row Q–P + row A–L + ⌫ + row Z–M + . + Aa + ␣
const KEYS: KeyDef[] = [
  ...'1234567890'.split('').map(charKey),
  ...'qwertyuiop'.split('').map(charKey),
  ...'asdfghjkl'.split('').map(charKey),
  { kind: 'backspace' },
  ...'zxcvbnm'.split('').map(charKey),
  charKey('.'),
  { kind: 'case' },
  { kind: 'space' },
]

const ROW_SIZE = 10
const ROWS: KeyDef[][] = [0, 1, 2, 3].map((r) => KEYS.slice(r * ROW_SIZE, r * ROW_SIZE + ROW_SIZE))

const SPECIAL_LABELS: Record<'backspace' | 'space' | 'case', string> = {
  backspace: '⌫',
  space: '␣',
  case: 'Aa',
}

function isLetter(c: string): boolean {
  return c >= 'a' && c <= 'z'
}

function keyLabel(key: KeyDef, upper: boolean): string {
  if (key.kind === 'char') {
    return upper && isLetter(key.char) ? key.char.toUpperCase() : key.char
  }
  return SPECIAL_LABELS[key.kind]
}

export interface PiKeyboardOverlayProps {
  field: PiKeyboardField
  onClose: () => void
}

// the value shown while no profile exists yet (display defaults — the first
// write lazily creates profile 1, ticket10-5A)
const EMPTY_PROFILE: PiProfile = defaultPiProfile()

export function PiKeyboardOverlay({ field, onClose }: PiKeyboardOverlayProps) {
  const settings = useSettings()
  // ticket10-5A: the keyboard edits the ACTIVE profile (the single profile
  // the legacy config migrated into); the profile list UI is follow-up work
  const value = (activePiProfile(settings) ?? EMPTY_PROFILE)[field]
  // session case toggle (lowercase default) — resets with every open (fresh mount)
  const [upper, setUpper] = useState(false)

  // always write the latest value into the store — the modal's own inputs
  // keep reading the same store, so a local copy would go stale on every
  // keystroke. ticket10-5A: writes go to the active profile (the first one
  // lazily creates profile 1)
  const setFieldValue = useCallback(
    (next: string) => {
      updateActivePiProfileField(field, next)
    },
    [field],
  )

  const activate = useCallback(
    (index: number) => {
      const key = KEYS[index]
      if (key.kind === 'case') {
        setUpper((v) => !v)
        return
      }
      const cur = activePiProfile(getSettings()) ?? EMPTY_PROFILE
      if (key.kind === 'backspace') {
        setFieldValue(cur[field].slice(0, -1))
        return
      }
      const ch =
        key.kind === 'char' ? (upper && isLetter(key.char) ? key.char.toUpperCase() : key.char) : ' '
      setFieldValue(cur[field] + ch)
    },
    [field, setFieldValue, upper],
  )

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: KEYS.length,
    initialIndex: 0,
    onConfirm: activate,
    // consumed by the hook (always returns true) — while the keyboard is open,
    // Back/Escape never reaches the App-level goBack (see the hierarchy note)
    onBack: onClose,
    onWheel: (dir, index) => {
      // flat walk with wrap (see the dial model decision above); the tick is
      // always consumed, there are no clamped boundaries to fall through
      tapItem((((index + dir) % KEYS.length) + KEYS.length) % KEYS.length)
      return true
    },
  })

  const preview = field === 'password' ? '•'.repeat(value.length) : value

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-label={FIELD_LABELS[field]}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.fieldName}>{FIELD_LABELS[field]}</span>
          <span className={styles.preview}>{value === '' ? '—' : preview}</span>
        </div>

        <div className={styles.grid}>
          {ROWS.map((row, r) => (
            <div className={styles.row} key={r}>
              {row.map((key, c) => {
                const index = r * ROW_SIZE + c
                const focused = focusedIndex === index
                return (
                  <button
                    key={index}
                    type="button"
                    className={`${styles.key} ${focused ? styles.focused : ''}`}
                    ref={focused ? setFocusRef : undefined}
                    tabIndex={focused ? 0 : -1}
                    onClick={() => {
                      tapItem(index)
                      activate(index)
                    }}
                  >
                    {keyLabel(key, upper)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <button type="button" className={styles.okBtn} onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  )
}
