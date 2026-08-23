import styles from './HomeMenuView.module.scss'
import { useListFocus } from '@/hooks/useListFocus'
import { HOME_LIGHTS, useHomeLights } from '@/hooks/useHomeLight'

// temporary placeholder items until more Home Assistant entities are wired up
const PLACEHOLDER_ITEMS = [
  { id: 'switch-demo', label: 'Switch (placeholder)' },
  { id: 'scene-demo', label: 'Scene (placeholder)' },
]

interface Props {
  onNavigate?: (route: string) => void
}

function HomeMenuViewImpl({ onNavigate }: Props) {
  const lights = useHomeLights()

  // single focus list: the lights first, then the placeholder entities
  const itemCount = HOME_LIGHTS.length + PLACEHOLDER_ITEMS.length

  const { focusedIndex, handleWheel, tapItem, setFocusRef } = useListFocus({
    itemCount,
    onSelect: (index) => {
      if (index < HOME_LIGHTS.length) {
        lights[index].toggle()
        return
      }
      const item = PLACEHOLDER_ITEMS[index - HOME_LIGHTS.length]
      if (!item) return
      onNavigate?.(item.id)
    },
    allowTapSelect: true,
  })

  const badgeFor = (light: (typeof lights)[number]) =>
    light.error ? 'Offline' : light.loading ? '…' : light.state === 'on' ? 'ON' : 'OFF'
  const badgeClassFor = (light: (typeof lights)[number]) =>
    light.error ? styles.badgeError : light.state === 'on' && !light.loading ? styles.badgeOn : ''

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Home</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Home Assistant</h2>
        <ul className={styles.list} onWheel={handleWheel as unknown as React.WheelEventHandler}>
          {lights.map((light, i) => {
            const focused = i === focusedIndex
            return (
              <li
                key={light.entityId}
                className={`${styles.listItem} ${focused ? styles.focused : ''}`}
                role="button"
                tabIndex={0}
                ref={focused ? setFocusRef : undefined}
                onClick={() => tapItem(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    tapItem(i)
                  }
                }}
              >
                <span className={styles.listItemText}>
                  <span>{light.label}</span>
                  <span className={styles.meta}>{light.room}</span>
                </span>
                <span className={`${styles.badge} ${badgeClassFor(light)}`}>{badgeFor(light)}</span>
              </li>
            )
          })}
          {PLACEHOLDER_ITEMS.map((item, i) => {
            const index = i + HOME_LIGHTS.length
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
