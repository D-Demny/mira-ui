import { useEffect, useRef, useState } from 'react'
import { domainLabel, humanizeEntityLabel } from '@/api/homeassistant'
import type { HaEntityCatalogEntry } from '@/api/homeassistant'
import { useHomeEntityCatalog, useHomeEntitySelection } from '@/hooks/useHomeEntities'
import { useOverlayListFocus } from '@/hooks/useOverlayListFocus'
import { ENTITY_ICON_PATHS, entityDomainHue } from './homeEntityArt'
import styles from './HomeEntityPickerModal.module.scss'

// ticket 9.3 (Teil 2) + ticket 9.5 + issue #37: the entity picker — the user
// manages which HA entities the Home carousel shows AND their order (the
// selection order IS the carousel order). Overlay in the HALightControlModal
// style: backdrop (click closes) + card (click stops propagation) + header +
// one useOverlayListFocus instance.
//
// issue #37: 2-level sub-menu (mirrors MainMenuView's settingsLevel). Level 1
// 'categories' = one card per domain, derived DYNAMICALLY from the catalog
// (every domain in GET /states gets a card — new domains appear without a code
// change; catalog order is known-first via task 2's sort). Confirming a card
// descends to level 2 'domain' = the entity rows of that one domain. The
// Back key at level 2 returns to level 1 restoring focus on the originating
// card.
//
// Focus chain (flat index list per level, itemCount = focusable items only,
// info lines do NOT count):
//   level 1: [domain cards] + [retry row while the catalog is in error] +
//     [the 'Reihenfolge' section's enabled move buttons, per selected entity:
//     up (if not first), down (if not last)] + footer 'Zurücksetzen'/'Fertig'
//   level 2: [entity rows of the open domain] + [retry row] + footer (the
//     reorder section is only rendered at level 1)
// Boundary-clamped moves are no-ops, so their buttons never enter the chain.

type FocusItem =
  | { kind: 'card'; cardIndex: number }
  | { kind: 'entity'; rowIndex: number }
  | { kind: 'retry' }
  | { kind: 'move'; entityId: string; dir: 'up' | 'down' }
  | { kind: 'reset' }
  | { kind: 'done' }

// issue #37: the picker's two sub-menu levels (the component mounts fresh per
// open — App renders it conditionally — so the level always starts at
// 'categories')
type PickerLevel = { kind: 'categories' } | { kind: 'domain'; domain: string }

interface Category {
  domain: string
  label: string
  entries: HaEntityCatalogEntry[]
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

  // issue #37: sub-menu level — fresh mount per open (App renders the modal
  // conditionally), so 'categories' is always the initial level. The refs
  // below restore focus after a level switch: pendingFocusRef holds the index
  // to focus once the new level's item count is committed (tapItem must run
  // AFTER the re-render — useOverlayListFocus only reads initialIndex on
  // mount), originCardIndexRef remembers which card we descended from so
  // dial-back can return focus to it.
  const [level, setLevel] = useState<PickerLevel>({ kind: 'categories' })
  const pendingFocusRef = useRef<number | null>(null)
  const originCardIndexRef = useRef(0)

  // issue #37: categories are DERIVED from the catalog — every domain present
  // in GET /states gets a level-1 card (task 2 removed the whitelist). The
  // catalog order is known-first (HOME_ENTITY_DOMAINS priority, unknowns
  // alphabetical), so iterating entries in order yields the card order; a new
  // domain in the catalog appears as a card without any code change.
  const categories: Category[] = []
  const categoryByDomain = new Map<string, Category>()
  for (const entry of catalog.entries) {
    let category = categoryByDomain.get(entry.domain)
    if (!category) {
      category = { domain: entry.domain, label: domainLabel(entry.domain), entries: [] }
      categoryByDomain.set(entry.domain, category)
      categories.push(category)
    }
    category.entries.push(entry)
  }

  // how many selected entities belong to each domain (the card badge)
  const selectedCountByDomain = new Map<string, number>()
  for (const entityId of selection.selectedIds) {
    const domain = domainPrefixOf(entityId)
    selectedCountByDomain.set(domain, (selectedCountByDomain.get(domain) ?? 0) + 1)
  }

  // level 2: the entity rows of the single open domain (level 1 renders cards
  // instead of rows); rowIndexById maps a row to its position in the flat
  // focus chain. groups = the entity-row sections to render (level 2: exactly
  // one, level 1: none)
  const activeCategory =
    level.kind === 'domain' ? (categoryByDomain.get(level.domain) ?? null) : null
  const rows: HaEntityCatalogEntry[] = []
  const rowIndexById = new Map<string, number>()
  for (const entry of activeCategory?.entries ?? []) {
    rowIndexById.set(entry.entityId, rows.length)
    rows.push(entry)
  }
  const groups: Category[] = activeCategory ? [activeCategory] : []

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

  // focus chain per level (visual order): level 1 = domain cards + retry +
  // 'Reihenfolge' move buttons (only the enabled ones — a clamped boundary
  // move is a no-op) + footer; level 2 = the open domain's entity rows +
  // retry + footer (the reorder section is not rendered at level 2, so its
  // buttons are absent there)
  const focusItems: FocusItem[] = []
  if (listVisible && level.kind === 'categories') {
    for (let i = 0; i < categories.length; i += 1) focusItems.push({ kind: 'card', cardIndex: i })
  } else if (listVisible && level.kind === 'domain') {
    for (let i = 0; i < rows.length; i += 1) focusItems.push({ kind: 'entity', rowIndex: i })
  }
  const retryIndex = showError ? focusItems.length : -1
  if (showError) focusItems.push({ kind: 'retry' })
  const moveFocusIndex = new Map<string, number>()
  if (level.kind === 'categories') {
    for (const row of orderRows) {
      for (const dir of ['up', 'down'] as const) {
        if (dir === 'up' && !row.canMoveUp) continue
        if (dir === 'down' && !row.canMoveDown) continue
        moveFocusIndex.set(row.entityId + ':' + dir, focusItems.length)
        focusItems.push({ kind: 'move', entityId: row.entityId, dir })
      }
    }
  }
  const resetIndex = focusItems.length
  focusItems.push({ kind: 'reset' })
  const doneIndex = focusItems.length
  focusItems.push({ kind: 'done' })
  const itemCount = focusItems.length

  // the component mounts fresh per open, so there is exactly one initial
  // focus (0 = first card / first row); level switches restore focus via
  // pendingFocusRef below instead of a per-level initialIndex
  const initialIndex = 0

  // issue #37: level navigation — descending stores the originating card so
  // dial-back can restore focus on it; a retry always returns to level 1 (the
  // cards) with focus on the first card. Both park the desired focus in
  // pendingFocusRef, applied by the effect below AFTER the re-render (so
  // tapItem clamps against the NEW level's item count).
  const descendTo = (category: Category, cardIndex: number) => {
    originCardIndexRef.current = cardIndex
    pendingFocusRef.current = 0
    setLevel({ kind: 'domain', domain: category.domain })
  }

  const doRetry = () => {
    catalog.refetch()
    originCardIndexRef.current = 0
    pendingFocusRef.current = 0
    if (level.kind !== 'categories') setLevel({ kind: 'categories' })
  }

  const { focusedIndex, tapItem, setFocusRef } = useOverlayListFocus({
    itemCount,
    initialIndex,
    onConfirm: (index) => {
      const item = focusItems[index]
      if (!item) return
      switch (item.kind) {
        case 'card': {
          const category = categories[item.cardIndex]
          if (category) descendTo(category, item.cardIndex)
          return
        }
        case 'entity': {
          const entry = rows[item.rowIndex]
          if (entry) selection.toggle(entry.entityId)
          return
        }
        case 'retry':
          doRetry()
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
    onBack: () => {
      // issue #37: Back at level 2 returns to the cards, restoring focus on
      // the card we descended from; at level 1 it closes (as before)
      if (level.kind === 'domain') {
        pendingFocusRef.current = originCardIndexRef.current
        setLevel({ kind: 'categories' })
      } else {
        onClose()
      }
    },
  })

  // issue #37: apply a focus index parked for the PREVIOUS level switch —
  // runs after the re-render so useOverlayListFocus' itemCountRef already
  // reflects the new level (the hook's ref update is a layout effect, which
  // always commits before this passive effect)
  useEffect(() => {
    if (pendingFocusRef.current === null) return
    const index = pendingFocusRef.current
    pendingFocusRef.current = null
    tapItem(index)
  }, [level, tapItem])

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
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
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
                  doRetry()
                }}
                onKeyDown={keydownConfirm(() => {
                  tapItem(retryIndex)
                  doRetry()
                })}
              >
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>Erneut versuchen</span>
                </span>
              </div>
            </>
          ) : null}
          {showEmpty ? (
            // issue #37: the catalog now contains EVERY domain (no
            // 'controllable' filter), so the empty state is plain too
            <div className={styles.info}>Keine Entitäten gefunden</div>
          ) : null}
          {listVisible && showErrorNote ? (
            // bug53: non-blocking error note — the (stale) catalog stays
            // selectable, the note carries the concrete reason
            <div className={styles.errorNote}>Home Assistant nicht erreichbar: {catalog.error}</div>
          ) : null}
          {/* issue #37: level 1 — one card per domain, derived from the
              catalog (a new domain in GET /states gets a card without any
              code change; catalog order = known-first) */}
          {listVisible && level.kind === 'categories' ? (
            <div className={styles.categoryCards}>
              {categories.map((category, i) => {
                const focused = focusedIndex === i
                const hue = entityDomainHue(category.domain)
                const selectedCount = selectedCountByDomain.get(category.domain) ?? 0
                return (
                  <div
                    key={category.domain}
                    className={`${styles.categoryCard} ${focused ? styles.focused : ''}`}
                    ref={focused ? setFocusRef : undefined}
                    role="button"
                    tabIndex={focused ? 0 : -1}
                    onClick={() => {
                      tapItem(i)
                      descendTo(category, i)
                    }}
                    onKeyDown={keydownConfirm(() => {
                      tapItem(i)
                      descendTo(category, i)
                    })}
                  >
                    <span
                      className={styles.iconTile}
                      style={{
                        background: `hsl(${hue}, 40%, 18%)`,
                        color: `hsl(${hue}, 55%, 62%)`,
                      }}
                    >
                      <EntityGlyph domain={category.domain} />
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.categoryTitle}>{category.label}</span>
                      <span className={styles.rowMeta}>
                        {category.entries.length === 1
                          ? '1 Entität'
                          : `${category.entries.length} Entitäten`}
                        {selectedCount > 0 ? ` · ${selectedCount} ausgewählt` : ''}
                      </span>
                    </span>
                  </div>
                )
              })}
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
          {/* ticket 9.5 + issue #37: the selection order IS the Home carousel
              order — an explicit reorder section (single-selection lists have
              nothing to sort, so it only renders with two or more selected
              entities). Level 1 ONLY: at level 2 the rows of the open domain
              take the list area */}
          {level.kind === 'categories' && orderRows.length > 1 ? (
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
