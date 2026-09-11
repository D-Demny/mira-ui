import { HOME_ENTITY_DOMAINS, humanizeEntityLabel } from '@/api/homeassistant'
import type { HaEntityCatalogEntry } from '@/api/homeassistant'
import { useHomeEntityCatalog, useHomeEntitySelection } from '@/hooks/useHomeEntities'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { ENTITY_ICON_PATHS, entityDomainHue } from './homeEntityArt'
import styles from './HomeEntityPickerModal.module.scss'

// ticket 9.3 (Teil 2) + ticket 9.5: the entity picker — the user manages which
// HA entities the Home carousel shows AND their order (the selection order IS
// the carousel order). Overlay in the HALightControlModal style: backdrop
// (click closes) + card (click stops propagation) + header + one
// useOverlayListFocus instance.
//
// Focus chain (flat index list, itemCount = focusable items only, info lines
// do NOT count): [entity rows, grouped by domain in catalog order] + [retry
// row while the catalog is in error] + [the 'Reihenfolge' section's enabled
// move buttons, per selected entity: up (if not first), down (if not last)] +
// the two footer buttons 'Zurücksetzen' / 'Fertig' (always the last two
// items). Boundary-clamped moves are no-ops, so their buttons never enter the
// chain.

type FocusItem =
  | { kind: 'entity'; rowIndex: number }
  | { kind: 'retry' }
  | { kind: 'move'; entityId: string; dir: 'up' | 'down' }
  | { kind: 'reset' }
  | { kind: 'done' }

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

// the domain always comes from the entity id prefix — works even while the
// catalog has not loaded yet (the reorder section renders in that case too,
// so its rows cannot rely on catalog entries)
function domainPrefixOf(entityId: string): string {
  const dot = entityId.indexOf('.')
  return dot === -1 ? '' : entityId.slice(0, dot)
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

// small ▲ / ▼ glyph for the move buttons
function MoveGlyph({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === 'up' ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

  // ticket 9.5: the reorder section's data — the CURRENT selection in order
  // (independent of the catalog state: even with a broken catalog the stored
  // selection stays reorderable). Labels fall back to the humanized id when
  // the catalog does not (yet) know the entity.
  const labelById = new Map<string, string>()
  for (const entry of catalog.entries) labelById.set(entry.entityId, entry.label)
  const selectedIds = selection.selectedIds
  const orderRows = selectedIds.map((entityId, i) => ({
    entityId,
    domain: domainPrefixOf(entityId),
    label: labelById.get(entityId) ?? humanizeEntityLabel(entityId),
    canMoveUp: i > 0,
    canMoveDown: i < selectedIds.length - 1,
  }))

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

  // focus chain (visual order): entity rows, retry, move buttons (only the
  // enabled ones — a clamped boundary move is a no-op), footer buttons
  const focusItems: FocusItem[] = []
  if (listVisible) {
    for (let i = 0; i < rows.length; i += 1) focusItems.push({ kind: 'entity', rowIndex: i })
  }
  const retryIndex = showError ? focusItems.length : -1
  if (showError) focusItems.push({ kind: 'retry' })
  // move buttons per selected entity, reading order: [up, down] per row
  const moveFocusIndex = new Map<string, number>()
  for (const row of orderRows) {
    for (const dir of ['up', 'down'] as const) {
      if (dir === 'up' && !row.canMoveUp) continue
      if (dir === 'down' && !row.canMoveDown) continue
      moveFocusIndex.set(row.entityId + ':' + dir, focusItems.length)
      focusItems.push({ kind: 'move', entityId: row.entityId, dir })
    }
  }
  const resetIndex = focusItems.length
  focusItems.push({ kind: 'reset' })
  const doneIndex = focusItems.length
  focusItems.push({ kind: 'done' })
  const itemCount = focusItems.length

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
      const item = focusItems[index]
      if (!item) return
      switch (item.kind) {
        case 'entity': {
          const entry = rows[item.rowIndex]
          if (entry) selection.toggle(entry.entityId)
          return
        }
        case 'retry':
          catalog.refetch()
          return
        case 'move':
          selection.move(item.entityId, item.dir)
          return
        case 'reset':
          selection.reset()
          onClose()
          return
        case 'done':
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
          {/* ticket 9.5: the selection order IS the Home carousel order — an
              explicit reorder section (single-selection lists have nothing to
              sort, so it only renders with two or more selected entities) */}
          {orderRows.length > 1 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>Reihenfolge</div>
              {orderRows.map((row, i) => {
                const hue = entityDomainHue(row.domain)
                return (
                  <div key={row.entityId} className={styles.orderRow}>
                    <span className={styles.orderIndex}>{i + 1}</span>
                    <span
                      className={styles.iconTile}
                      style={{
                        background: `hsl(${hue}, 40%, 18%)`,
                        color: `hsl(${hue}, 55%, 62%)`,
                      }}
                    >
                      <EntityGlyph domain={row.domain} size={16} />
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{row.label}</span>
                    </span>
                    {(['up', 'down'] as const).map((dir) => {
                      const enabled = dir === 'up' ? row.canMoveUp : row.canMoveDown
                      const focusIdx = moveFocusIndex.get(row.entityId + ':' + dir) ?? -1
                      const focused = focusIdx !== -1 && focusedIndex === focusIdx
                      return (
                        <button
                          key={dir}
                          type="button"
                          className={`${styles.moveBtn} ${focused ? styles.moveBtnFocused : ''}`}
                          ref={focused ? setFocusRef : undefined}
                          role="button"
                          tabIndex={focused ? 0 : -1}
                          aria-label={`${row.label} ${dir === 'up' ? 'nach oben' : 'nach unten'} verschieben`}
                          disabled={!enabled}
                          onClick={() => {
                            if (!enabled) return
                            tapItem(focusIdx)
                            selection.move(row.entityId, dir)
                          }}
                          onKeyDown={keydownConfirm(() => {
                            if (!enabled) return
                            tapItem(focusIdx)
                            selection.move(row.entityId, dir)
                          })}
                        >
                          <MoveGlyph dir={dir} />
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : null}
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
