// persistent UI view preference for lyric and album art view

const STORAGE_KEY = 'thing.view.v1'

export function loadShowLyrics(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

export function saveShowLyrics(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // ignore
  }
}
