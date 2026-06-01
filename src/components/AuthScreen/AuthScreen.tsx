import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import styles from './AuthScreen.module.scss'

interface Props {
  url?: string // if undefined we render the loading placeholder
  hint?: string // shown beneath the loading state if it gets stuck
}

// strip the start of the url, we only need to perserve the spotify url and the pair code
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

function AuthScreenImpl({ url, hint }: Props) {
  const loading = !url
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.qrWrap}>
          {loading ? (
            <div className={styles.qrPlaceholder} role="status" aria-label="Fetching pairing code">
              <div className={styles.qrSpinner} aria-hidden />
            </div>
          ) : (
            <QRCodeSVG
              value={url}
              size={260}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              marginSize={2}
            />
          )}
        </div>
        <div className={styles.text}>
          <div className={styles.title}>Sign in to Spotify</div>
          <ol className={styles.steps}>
            <li>Scan the QR with your phone</li>
            <li>Sign in to your Spotify account</li>
            <li>This screen closes automatically</li>
          </ol>
          {loading ? null : (
            <div className={styles.fallback}>
              <div className={styles.fallbackLabel}>Or visit on any browser</div>
              <div className={styles.fallbackUrl}>{displayUrl(url)}</div>
            </div>
          )}
          <div className={styles.waiting}>
            <span className={styles.waitDot} aria-hidden />
            <span>{loading ? 'fetching pairing code...' : 'waiting for sign-in...'}</span>
          </div>
          {loading && hint ? <div className={styles.hint}>{hint}</div> : null}
        </div>
      </div>
    </div>
  )
}

export const AuthScreen = memo(AuthScreenImpl)
