import styles from './HomeMenuView.module.scss'
import { useListFocus } from '@/hooks/useListFocus'
import { useHomeSelectedEntities, type HomeEntityView } from '@/hooks/useHomeEntities'

// ticket 9.3: the German domain label shown as row meta when the entity has
// no curated room (the HOME_LIGHTS lights do, everything else does not)
function domainLabelFor(domain: string): string {
  switch (domain) {
    case 'light':
      return 'Licht'
    case 'switch':
      return 'Schalter'
    case 'fan':
      return 'Lüfter'
    case 'scene':
      return 'Szene'
    case 'cover':
      return 'Rollladen'
    case 'input_boolean':
      return 'Boolescher Wert'
    case 'media_player':
      return 'Mediaplayer'
    default:
      return domain
  }
}

function badgeFor(view: HomeEntityView): string {
  if (view.error) return 'Offline'
  if (view.loading) return '…'
  if (view.active === true) return 'ON'
  if (view.active === false) return 'OFF'
  return '–'
}

interface Props {
  // ticket 9.3: opens the entity picker (the App-level overlay); when
  // provided, a manage row is appended to the focus list
  onOpenEntityPicker?: () => void
}

function HomeMenuViewImpl({ onOpenEntityPicker }: Props) {
  // bug57 v2: this view IS the home list — mounted = visible, so the 3s HA
  // poll is active for the whole lifetime of the view
  const entities = useHomeSelectedEntities(true)

  const hasManage = typeof onOpenEntityPicker === 'function'

  // single focus list: the selected entities, then (if the picker entry is
  // available) the manage row
  const itemCount = entities.length + (hasManage ? 1 : 0)

  const { focusedIndex, handleWheel, tapItem, setFocusRef } = useListFocus({
    itemCount,
    onSelect: (index) => {
      if (index < entities.length) {
        entities[index].actuate()
        return
      }
      onOpenEntityPicker?.()
    },
    allowTapSelect: true,
  })

  const badgeClassFor = (view: HomeEntityView) =>
    view.error ? styles.badgeError : view.active === true && !view.loading ? styles.badgeOn : ''

  // one row per focus-list item: entity rows carry a status badge, the
  // manage row does not (same li/role/ref/`.focused` structure as before)
  const renderRow = (index: number, key: string, label: string, meta: string, badge: string | null) => {
    const view = index < entities.length ? entities[index] : null
    const focused = index === focusedIndex
    return (
      <li
        key={key}
        className={`${styles.listItem} ${focused ? styles.focused : ''}`}
        role="button"
        tabIndex={0}
        ref={focused ? setFocusRef : undefined}
        onClick={() => tapItem(index)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            tapItem(index)
          }
        }}
      >
        <span className={styles.listItemText}>
          <span>{label}</span>
          <span className={styles.meta}>{meta}</span>
        </span>
        {badge !== null ? (
          <span
            className={`${styles.badge} ${view ? badgeClassFor(view) : ''}`}
          >
            {badge}
          </span>
        ) : null}
      </li>
    )
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Home</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Home Assistant</h2>
        <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
          {entities.map((view, i) =>
            renderRow(i, view.entityId, view.label, view.room ?? domainLabelFor(view.domain), badgeFor(view)),
          )}
          {hasManage
            ? renderRow(
                entities.length,
                'manage-entities',
                'Entitäten wählen',
                entities.length + ' ausgewählt',
                null,
              )
            : null}
        </ul>
      </section>
    </div>
  )
}

export const HomeMenuView = HomeMenuViewImpl
