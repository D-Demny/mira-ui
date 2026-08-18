import styles from './HomeMenuView.module.scss'
import { useListFocus } from '@/hooks/useListFocus'
import { HOME_LIGHT_LABEL, useHomeLight } from '@/hooks/useHomeLight'

// temporary placeholder items until more Home Assistant entities are wired up
const PLACEHOLDER_ITEMS = [
  { id: 'switch-demo', label: 'Switch (placeholder)' },
  { id: 'scene-demo', label: 'Scene (placeholder)' },
]

interface Props {
  onNavigate?: (route: string) => void
}

function HomeMenuViewImpl({ onNavigate }: Props) {
  const { state, loading, error, toggle } = useHomeLight()

  // single focus list: the light first, then the placeholder entities
  const itemCount = 1 + PLACEHOLDER_ITEMS.length

  const { focusedIndex, handleWheel, tapItem, setFocusRef } = useListFocus({
    itemCount,
    onSelect: (index) => {
      if (index === 0) {
        void toggle()
        return
      }
      const item = PLACEHOLDER_ITEMS[index - 1]
      if (!item) return
      onNavigate?.(item.id)
    },
    allowTapSelect: true,
  })

  const lightFocused = focusedIndex === 0
  const badge = error ? 'Offline' : loading ? '…' : state === 'on' ? 'ON' : 'OFF'
  const badgeClass = error
    ? styles.badgeError
    : state === 'on' && !loading
      ? styles.badgeOn
      : ''

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Home</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Home Assistant</h2>
        <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
          <li
            className={`${styles.listItem} ${lightFocused ? styles.focused : ''}`}
            role="button"
            tabIndex={0}
            ref={lightFocused ? setFocusRef : undefined}
            onClick={() => tapItem(0)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                tapItem(0)
              }
            }}
          >
            <span className={styles.listItemText}>
              <span>{HOME_LIGHT_LABEL}</span>
              <span className={styles.meta}>Light</span>
            </span>
            <span className={`${styles.badge} ${badgeClass}`}>{badge}</span>
          </li>
          {PLACEHOLDER_ITEMS.map((item, i) => {
            const index = i + 1
            return (
              <li
                key={item.id}
                className={`${styles.listItem} ${index === focusedIndex ? styles.focused : ''}`}
                role="button"
                tabIndex={0}
                ref={index === focusedIndex ? setFocusRef : undefined}
                onClick={() => tapItem(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    tapItem(index)
                  }
                }}
              >
                <span className={styles.listItemText}>
                  <span>{item.label}</span>
                  <span className={styles.meta}>Coming soon</span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

export const HomeMenuView = HomeMenuViewImpl
