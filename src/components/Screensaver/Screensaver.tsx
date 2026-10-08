import { memo, useEffect, useState } from 'react'
import styles from './Screensaver.module.scss'

// double press of the power button opens this screensaver w clock
// also auto opens from the idle after 20 s (issue #96)

interface Props {
  artUrl?: string | null
  utcOffsetMin?: number | null
  onClose: () => void
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function displayNow(utcOffsetMin: number | null | undefined): Date {
  const d = new Date()
  if (typeof utcOffsetMin !== 'number') return d
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  return new Date(utcMs + utcOffsetMin * 60_000)
}

const POWER_KEY_CODE = 'KeyM'
const ART_FADE_MS = 900

function ScreensaverImpl({ artUrl, utcOffsetMin, onClose }: Props) {
  const [now, setNow] = useState(() => displayNow(utcOffsetMin))

  useEffect(() => {
    setNow(displayNow(utcOffsetMin))
    const id = window.setInterval(() => {
      setNow((prev) => {
        const d = displayNow(utcOffsetMin)
        return d.getMinutes() !== prev.getMinutes() || d.getHours() !== prev.getHours() ? d : prev
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [utcOffsetMin])

  const [shownArt, setShownArt] = useState<string | null>(artUrl ?? null)
  const [prevArt, setPrevArt] = useState<string | null>(null)
  useEffect(() => {
    const next = artUrl ?? null
    if (next === shownArt) return
    if (!next) {
      setShownArt(null)
      setPrevArt(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setPrevArt(shownArt)
      setShownArt(next)
    }
    img.src = next
    return () => {
      cancelled = true
    }
  }, [artUrl, shownArt])
  useEffect(() => {
    if (prevArt == null) return
    const t = window.setTimeout(() => setPrevArt(null), ART_FADE_MS)
    return () => window.clearTimeout(t)
  }, [prevArt])

  // swallow every input — issue #96: tap, any key AND dial scroll all wake the
  // screensaver immediately; capture-phase + preventDefault so the first wake
  // input is consumed and cannot trigger a button underneath
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === POWER_KEY_CODE) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === POWER_KEY_CODE) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onWheel = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    // explicit non-passive, so preventDefault is honored (Chrome makes
    // window-level wheel listeners passive by default); the object is passed
    // via a variable because this TS lib's EventListenerOptions type predates
    // the `passive` field
    const wheelOptions = { capture: true, passive: false }
    window.addEventListener('wheel', onWheel, wheelOptions)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('wheel', onWheel, wheelOptions)
    }
  }, [onClose])

  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
  const date = `${weekdays[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}.${months[now.getMonth()]}.${now.getFullYear()}`

  return (
    <div className={styles.container} onClick={onClose}>
      {prevArt ? (
        <div className={styles.art} style={{ backgroundImage: `url(${prevArt})` }} aria-hidden />
      ) : null}
      {shownArt ? (
        <div
          key={shownArt}
          className={`${styles.art} ${styles.artEnter}`}
          style={{ backgroundImage: `url(${shownArt})` }}
          aria-hidden
        />
      ) : (
        <div className={styles.plain} aria-hidden />
      )}
      <div className={styles.scrim} aria-hidden />
      <div className={styles.content}>
        <div className={styles.clock}>
          {pad2(now.getHours())}:{pad2(now.getMinutes())}
        </div>
        <div className={styles.date}>{date}</div>
      </div>
    </div>
  )
}

export const Screensaver = memo(ScreensaverImpl)
