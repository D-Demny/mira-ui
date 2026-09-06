import { HOME_ENTITY_DOMAINS } from '@/api/homeassistant'
import type { HaEntityCatalogEntry } from '@/api/homeassistant'
import { useHomeEntityCatalog, useHomeEntitySelection } from '@/hooks/useHomeEntities'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { ENTITY_ICON_PATHS, entityDomainHue } from './homeEntityArt'
import styles from './HomeEntityPickerModal.module.scss'

// ticket 9.3 (Teil 2): the entity picker — the user manages which HA entities
// the Home carousel shows. Overlay in the HALightControlModal style: backdrop
// (click closes) + card (click stops propagation) + header + one
// useOverlayListFocus instance.
//
// Focus chain (itemCount = focusable items only, info lines do NOT count):
// [entity rows, grouped by domain in catalog order] + [retry row while the
// catalog is in error] + the two footer buttons 'Zurücksetzen' / 'Fertig'
// (always the last two items).

const SECTION_LABELS: Record<string, string> = {
  light: 'Lichter',
  switch: 'Schalter',
  fan: 'Lüfter',
  scene: 'Szenen',
  cover: 'Rollläden',
  input_boolean: 'Boolesche Werte',
  media_player: 'Mediaplayer',
}

// row state text: on/off badge, or the domain default for stateless domains
function rowMetaText(entry: HaEntityCatalogEntry): string {
  if (entry.active === true) return 'An'
  if (entry.active === false) return 'Aus'
  return entry.domain === 'scene' ? 'Szene' : '—'
}

// local (not exported) glyph — renders the domain's ENTITY_ICON_PATHS in the
// MenuIcon line style
function EntityGlyph({ domain, size = 18 }: { domain: string; size?: number }) {
  const paths = ENTITY_ICON_PATHS[domain] ?? ENTITY_ICON_PATHS.manage
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export interface HomeEntityPickerModalProps {
  onClose: () => void
}

export function HomeEntityPickerModal({ onClose }: HomeEntityPickerModalProps) {
  const catalog = useHomeEntityCatalog()
  const selection = useHomeEntitySelection()

  // groups in HOME_ENTITY_DOMAINS order (only non-empty groups render), rows
  // keep the catalog order inside a group; rowIndexById maps a row to its
  // position in the flat focus chain
  const rows: HaEntityCatalogEntry[] = []
  const groups: { domain: string; label: string; entries: HaEntityCatalogEntry[] }[] = []
  const rowIndexById = new Map<string, number>()
  for (const domain of HOME_ENTITY_DOMAINS) {
    const entries = catalog.entries.filter((entry) => entry.domain === domain)
    if (entries.length === 0) continue
    for (const entry of entries) {
      rowIndexById.set(entry.entityId, rows.length)
      rows.push(entry)
    }
    groups.push({ domain, label: SECTION_LABELS[domain] ?? domain, entries })
  }

  // render states (info lines are NOT focusable)
  // bug53: a failed (re)fetch with an already-loaded catalog keeps the list
  // visible (stale data retention) — the full error screen only appears when
  // there is NO data to show; a failure on top of loaded data renders a
  // non-blocking error note instead
  const showLoading = catalog.loading && catalog.entries.length === 0
  const showError = catalog.error !== null && !showLoading && catalog.entries.length === 0
  const showErrorNote = catalog.error !== null && catalog.entries.length > 0
  const showEmpty = !catalog.loading && catalog.entries.length === 0 && catalog.error === null
  const listVisible = !showLoading && !showError && !showEmpty

  // focus chain: [entity rows] + [retry row] + [Zurücksetzen, Fertig]
  const entityRowCount = listVisible ? rows.length : 0
  const retryIndex = showError ? entityRowCount : -1
  const resetIndex = entityRowCount + (showError ? 1 : 0)
  const doneIndex = resetIndex + 1
  const itemCount = doneIndex + 1

  // open on the first selected entity (0 when the list is not visible)
  let initialIndex = 0
  if (listVisible) {
    for (const entry of rows) {
      if (selection.isSelected(entry.entityId)) {
        initialIndex = rowIndexById.get(entry.entityId) ?? 0
        break
      }
    }
  }

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount,
    initialIndex,
    onConfirm: (index) => {
      if (listVisible) {
        const entry = rows[index]
        if (entry) {
          selection.toggle(entry.entityId)
          return
        }
      }
      if (showError && index === retryIndex) {
        catalog.refetch()
        return
      }
      if (index === resetIndex) {
        selection.reset()
        onClose()
        return
      }
      if (index === doneIndex) {
        onClose()
      }
    },
    onBack: () => onClose(),
  })

  const keydownConfirm = (run: () => void) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      run()
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-label="Entitäten wählen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Entitäten wählen</span>
            <span className={styles.count}>{selection.selectedIds.length} ausgewählt</span>
          </div>
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

        <div className={styles.list}>
          {showLoading ? <div className={styles.info}>Lade…</div> : null}
          {showError ? (
            <>
              <div className={styles.info}>Home Assistant nicht erreichbar</div>
              {/* bug53: the concrete reason (timeout vs 502 vs parse failure)
                  makes device diagnosis immediate instead of one label */}
              <div className={styles.errorDetail}>{catalog.error}</div>
              <div
                className={`${styles.row} ${focusedIndex === retryIndex ? styles.focused : ''}`}
                ref={focusedIndex === retryIndex ? setFocusRef : undefined}
                role="button"
                tabIndex={focusedIndex === retryIndex ? 0 : -1}
                onClick={() => {
                  tapItem(retryIndex)
                  catalog.refetch()
                }}
                onKeyDown={keydownConfirm(() => {
                  tapItem(retryIndex)
                  catalog.refetch()
                })}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>Erneut versuchen</span>
                </span>
              </div>
            </>
          ) : null}
          {showEmpty ? (
            <div className={styles.info}>Keine steuerbaren Entitäten gefunden</div>
          ) : null}
          {listVisible && showErrorNote ? (
            // bug53: non-blocking error note — the (stale) catalog stays
            // selectable, the note carries the concrete reason
            <div className={styles.errorNote}>
              Home Assistant nicht erreichbar: {catalog.error}
            </div>
          ) : null}
          {listVisible
            ? groups.map((group) => (
                <div key={group.domain} className={styles.section}>
                  <div className={styles.sectionHeader}>{group.label}</div>
                  {group.entries.map((entry) => {
                    const index = rowIndexById.get(entry.entityId) ?? 0
                    const focused = focusedIndex === index
                    const selected = selection.isSelected(entry.entityId)
                    const hue = entityDomainHue(entry.domain)
                    return (
                      <div
                        key={entry.entityId}
                        className={`${styles.row} ${focused ? styles.focused : ''}`}
                        ref={focused ? setFocusRef : undefined}
                        role="button"
                        tabIndex={focused ? 0 : -1}
                        aria-pressed={selected}
                        onClick={() => {
                          tapItem(index)
                          selection.toggle(entry.entityId)
                        }}
                        onKeyDown={keydownConfirm(() => {
                          tapItem(index)
                          selection.toggle(entry.entityId)
                        })}
                      >
                        <span
                          className={styles.iconTile}
                          style={{
                            background: `hsl(${hue}, 40%, 18%)`,
                            color: `hsl(${hue}, 55%, 62%)`,
                          }}
                        >
                          <EntityGlyph domain={entry.domain} />
                        </span>
                        <span className={styles.rowText}>
                          <span className={styles.rowTitle}>{entry.label}</span>
                          <span className={styles.rowMeta}>{rowMetaText(entry)}</span>
                        </span>
                        <span
                          className={`${styles.check} ${selected ? styles.checkSelected : ''}`}
                          aria-hidden
                        >
                          {selected ? (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={3}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 12.5l4.5 4.5L19 7.5" />
                            </svg>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))
            : null}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={`${styles.btnReset} ${focusedIndex === resetIndex ? styles.focused : ''}`}
            ref={focusedIndex === resetIndex ? setFocusRef : undefined}
            tabIndex={focusedIndex === resetIndex ? 0 : -1}
            disabled={!selection.isCustomized}
            onClick={() => {
              tapItem(resetIndex)
              selection.reset()
              onClose()
            }}
            onKeyDown={keydownConfirm(() => {
              tapItem(resetIndex)
              selection.reset()
              onClose()
            })}
          >
            Zurücksetzen
          </button>
          <button
            type="button"
            className={`${styles.btnDone} ${focusedIndex === doneIndex ? styles.focused : ''}`}
            ref={focusedIndex === doneIndex ? setFocusRef : undefined}
            tabIndex={focusedIndex === doneIndex ? 0 : -1}
            onClick={() => {
              tapItem(doneIndex)
              onClose()
            }}
            onKeyDown={keydownConfirm(() => {
              tapItem(doneIndex)
              onClose()
            })}
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  )
}
