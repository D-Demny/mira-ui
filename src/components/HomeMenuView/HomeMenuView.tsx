import styles from './HomeMenuView.module.scss'
import { useListFocus } from '@/hooks/useListFocus'

// temporary placeholder items while the Home Assistant integration is wired up
const PLACEHOLDER_ITEMS = [
  { id: 'light-demo', label: 'Light (placeholder)' },
  { id: 'switch-demo', label: 'Switch (placeholder)' },
  { id: 'scene-demo', label: 'Scene (placeholder)' },
]

interface Props {
  onNavigate?: (route: string) => void
}

function HomeMenuViewImpl({ onNavigate }: Props) {
  const { focusedIndex, handleWheel, tapItem, setFocusRef } = useListFocus({
    itemCount: PLACEHOLDER_ITEMS.length,
    onSelect: (index) => {
      const item = PLACEHOLDER_ITEMS[index]
      if (!item) return
      onNavigate?.(item.id)
    },
    allowTapSelect: true,
  })

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Home</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Home Assistant</h2>
        <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
          {PLACEHOLDER_ITEMS.map((item, index) => (
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
          ))}
        </ul>
      </section>
    </div>
  )
}

export const HomeMenuView = HomeMenuViewImpl
