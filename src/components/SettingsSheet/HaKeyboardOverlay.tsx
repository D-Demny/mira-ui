import { useCallback, useState } from 'react'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import styles from './HaKeyboardOverlay.module.scss'

// ticket 9.4: on-screen keyboard for the HaSettingsModal credential fields
// (URL/IP:Port / Username / Passwort) — the 800×480 CR69 display has no
// physical keyboard.
//
// A DEDICATED overlay instance (not an extension of the PiKeyboardField
// union): the PiKeyboardOverlay is coupled to the settings store's
// piProfiles (it reads the active profile and writes
// updateActivePiProfileField on every key, ticket10-5A), while the HA modal
// edits DRAFT field values that are only persisted by the explicit
// "Speichern" button (transactional save — the "Verbindung testen" button
// must never touch the daemon's HA config, ticket 9.4 design §3). The
// keyboard therefore takes the value + a change callback as props instead
// of touching the store.
//
// The MECHANICS are 1:1 the PiKeyboardOverlay (ticket10-2): the same 4×10
// key grid with the flat dial walk (wrap at both ends — the single dial
// axis), the same focus entry pushed ON TOP of the modal's entry (Back
// closes the keyboard first, the modal second — Bug10-2 back hierarchy),
// the same dial highlight (pure CSS class on the focused key, no
// el.focus() per tick) and the same '•' masking for the password field.

export type HaKeyboardField = 'url' | 'username' | 'password'

const FIELD_LABELS: Record<HaKeyboardField, string> = {
  url: 'URL/IP:Port',
  username: 'Username',
  password: 'Passwort',
}

type KeyDef =
  { kind: 'char'; char: string } | { kind: 'backspace' } | { kind: 'space' } | { kind: 'case' }

function charKey(c: string): KeyDef {
  return { kind: 'char', char: c }
}

// the 40 keys in reading order (= the dial order, 1:1 the Pi keyboard):
// digits + row Q–P + row A–L + ⌫ + row Z–M + . + Aa + ␣
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

// issue #16: the backspace glyph U+232B ('⌫') is missing from the embedded
// CR69 font set, so the key rendered as an empty cell — use the plain arrow
// '←' (U+2190) instead and name the key explicitly for screen readers.
const SPECIAL_LABELS: Record<'backspace' | 'space' | 'case', string> = {
  backspace: '←',
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

export interface HaKeyboardOverlayProps {
  field: HaKeyboardField
  // the DRAFT value of the focused field (modal-local state — the keyboard
  // never writes the settings store, see the file header)
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function HaKeyboardOverlay({ field, value, onChange, onClose }: HaKeyboardOverlayProps) {
  // session case toggle (lowercase default — usernames and passwords) —
  // resets with every open (fresh mount), 1:1 the Pi keyboard
  const [upper, setUpper] = useState(false)

  const activate = useCallback(
    (index: number) => {
      const key = KEYS[index]
      if (key.kind === 'case') {
        setUpper((v) => !v)
        return
      }
      if (key.kind === 'backspace') {
        onChange(value.slice(0, -1))
        return
      }
      const ch =
        key.kind === 'char'
          ? upper && isLetter(key.char)
            ? key.char.toUpperCase()
            : key.char
          : ' '
      onChange(value + ch)
    },
    [onChange, upper, value],
  )

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount: KEYS.length,
    initialIndex: 0,
    onConfirm: activate,
    // consumed by the hook (always returns true) — while the keyboard is
    // open, Back/Escape never reaches the modal's entry (see the hierarchy
    // note in the file header)
    onBack: onClose,
    onWheel: (dir, index) => {
      // flat walk with wrap (1:1 the Pi keyboard); the tick is always
      // consumed, there are no clamped boundaries to fall through
      tapItem((((index + dir) % KEYS.length) + KEYS.length) % KEYS.length)
      return true
    },
  })

  const preview = field === 'password' ? '•'.repeat(value.length) : value

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        // the keyboard is nested inside the modal's backdrop (single-root
        // component) — a click on the dimmed area must close ONLY the
        // keyboard and not bubble to the modal's own backdrop (that would
        // close both at once; the PiServerModal ConfirmDialog pattern)
        e.stopPropagation()
        onClose()
      }}
    >
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
                    // issue #16: the '←' label is ambiguous for screen readers,
                    // so name the backspace key explicitly (no aria-label on
                    // the other keys — their glyph IS the accessible name)
                    aria-label={key.kind === 'backspace' ? 'Löschen' : undefined}
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
