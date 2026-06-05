import styles from './TopBanner.module.scss'

export type BannerVariant = 'info' | 'success' | 'warning' | 'error'

interface Props {
  visible: boolean
  message: string
  variant?: BannerVariant
}

// inteded to be reusable for future stuff like reconnecting and etc
export function TopBanner({ visible, message }: Props) {
  return (
    <div
      className={`${styles.banner} ${visible ? styles.visible : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <span className={styles.message}>{message}</span>
    </div>
  )
}
