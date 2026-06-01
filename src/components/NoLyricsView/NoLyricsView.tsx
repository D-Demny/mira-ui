import { memo } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { TrackInfo } from '@/components/TrackInfo'
import type { ObserverStatusActive } from '@/api/types'
import styles from './NoLyricsView.module.scss'

interface Props {
  status: ObserverStatusActive
}

function NoLyricsViewImpl({ status }: Props) {
  return (
    <div className={styles.wrap}>
      <div className={styles.kenburns}>
        <AlbumArt src={status.track_image} size={220} />
      </div>
      <div className={styles.text}>
        <TrackInfo trackName={status.track_name} artist={status.track_artist} large />
      </div>
    </div>
  )
}

export const NoLyricsView = memo(NoLyricsViewImpl)
