import { memo } from 'react'
import styles from './ReportDialog.module.scss'

interface Props {
  id: string
  onDismiss: () => void
}

function ReportDialogImpl({ id, onDismiss }: Props) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.card}>
        <div className={styles.title}>Report sent</div>
        <div className={styles.subtitle}>
          Quote this ID when asking for help. We keep the report for 30 days.
        </div>
        <div className={styles.reportId}>{id}</div>
        <button className={styles.dismiss} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

export const ReportDialog = memo(ReportDialogImpl)
