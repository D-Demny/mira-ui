// bug8.2: the menu pre-decodes every cover once so a sidebar preview swap
// (full carousel remount) only pays layout/paint of already decoded bitmaps
// instead of fetch+decode per tick.
// bug45 option C: the set of warmed urls is FIFO-bounded (the last strictly
// unbounded structure in the menu) — evicted urls simply get re-pre-decoded
// on the next focus. It lives in a plain (non-component) module so
// MainMenuView.tsx keeps exporting components only (react-refresh) and the
// Debug screen can report its occupancy.
// issue50 F1: the warmed state is COMPLETION-AWARE — warmArt no longer marks
// a url at fire time. Each url is pending (fetch in flight), done (settled —
// the only urls that count as "warmed" for the band diff logic), or failed
// (re-warmable). In-flight band fetches are capped at MAX_WARM_INFLIGHT with
// a FIFO wait queue so the mounted cards' own <img> requests keep the
// remaining connection slots, and a failed fetch gets one bounded retry after
// RETRY_DELAY_MS. The Image lives inside this module: its ref stays in
// `pending` until settled (no early GC — the decoded bitmap must survive into
// Chromium's image cache), and plain onload/onerror + setTimeout keep it
// Chromium 69 safe.
// issue50 F4-B: on top of that a pending url SETTLES ON ITS OWN after
// WARM_SETTLE_TIMEOUT_MS — a Chromium-69 Image() can fire neither load nor
// error at all, and such a hung fetch would otherwise hold one of the
// MAX_WARM_INFLIGHT FIFO slots forever (wedge pump() behind it). The timeout
// settles the url as failed (re-warmable, no bounded retry — a later warmArt()
// re-arms it with a fresh budget) and releases its slot so the queue can
// advance. Plain setTimeout again: Chromium 69 safe.
export const WARMED_ART_MAX = 1000

// issue50 F1: at most this many band cover fetches in flight at once — the
// mounted cards' own <img> requests then keep the remaining connection slots
export const MAX_WARM_INFLIGHT = 3

// issue50 F4-B: a pending fetch that fires NEITHER load NOR error within this
// bound settles as failed (re-warmable) and releases its FIFO slot — on weak
// embedded Chromium builds an Image() can hang with no event at all, and one
// such hung fetch must not wedge the whole warm queue. Mirrors the
// REMOTE_ART_TIMEOUT_MS settle pattern in AlbumArt.ts.
export const WARM_SETTLE_TIMEOUT_MS = 8000

// issue50 F1: one bounded retry after a failed fetch (same rhythm as the
// card-img retry in AlbumArt) — a second failure settles the url as failed;
// it stays re-warmable, never hammered
const RETRY_DELAY_MS = 1500

// in flight: url -> Image (the ref is kept until settled — protects the
// listeners and the decoded bitmap from early GC)
const pending = new Map<string, HTMLImageElement>()
// waiting on the retry delay timer before re-arming — still "in flight" as
// far as warmArt is concerned (no parallel fetches for the same url)
const retrying = new Set<string>()
// urls that already spent their one bounded retry in the current request
const retried = new Set<string>()
// FIFO wait queue beyond MAX_WARM_INFLIGHT (+ its Set twin for O(1) checks)
const queue: string[] = []
const queued = new Set<string>()
// settled successfully — insertion order is the FIFO eviction order (bug45)
const done = new Set<string>()
// settled failed — re-warmable: a later warmArt() starts a fresh request with
// its own bounded retry
const failed = new Set<string>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
// issue50 F4-B: per-pending-url settle deadline (cleared on every settle path
// — success, failure, and __resetWarmedArt) so it can fire at most once
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function startFetch(url: string): void {
  const img = new Image()
  // match AlbumArt's fetch attributes so the browser reuses the same cache
  // entry (CORS images are cached separately)
  img.crossOrigin = 'anonymous'
  img.referrerPolicy = 'no-referrer'
  img.onload = () => settle(url, true)
  img.onerror = () => settle(url, false)
  pending.set(url, img)
  // issue50 F4-B: release this FIFO slot if load/error never fires at all —
  // a hung Image() must not hold a slot forever (plain setTimeout: CR69-safe)
  settleTimers.set(
    url,
    setTimeout(() => settleTimeout(url), WARM_SETTLE_TIMEOUT_MS),
  )
  img.src = url
}

// start the next queued urls while a slot is free (FIFO order)
function pump(): void {
  while (pending.size < MAX_WARM_INFLIGHT && queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) break
    queued.delete(next)
    // defensive: the url may have settled through another path meanwhile
    if (done.has(next) || pending.has(next) || retrying.has(next)) continue
    startFetch(next)
  }
}

// issue50 F4-B: the settle deadline fired without load or error in between —
// settle as failed and release the FIFO slot. A hung fetch gets NO bounded
// retry (the browser produced no signal at all); a later warmArt() re-arms it
// with a fresh retry budget, so it stays re-warmable, never hammered
function settleTimeout(url: string): void {
  const img = pending.get(url)
  settleTimers.delete(url) // defensive: the deadline already fired
  if (!img) return // stale deadline after __resetWarmedArt — no state to move
  pending.delete(url)
  img.onload = null
  img.onerror = null
  failed.add(url)
  retried.delete(url)
  pump()
}

function settle(url: string, ok: boolean): void {
  const img = pending.get(url)
  // issue50 F4-B: this url settles through THIS path — drop its deadline so a
  // fast onerror cannot arm a stray late timeout against the bounded retry
  // that follows
  const settleTimer = settleTimers.get(url)
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer)
    settleTimers.delete(url)
  }
  if (!img) return // stale event after __resetWarmedArt — no state to move
  pending.delete(url)
  img.onload = null
  img.onerror = null
  if (ok) {
    retried.delete(url)
    done.add(url)
    if (done.size > WARMED_ART_MAX) {
      // FIFO eviction (bug45 option C): the oldest settled url becomes
      // re-warmable again — same as before the state machine
      const oldest = done.keys().next().value
      if (oldest !== undefined) done.delete(oldest)
    }
  } else if (!retried.has(url)) {
    // one bounded retry after RETRY_DELAY_MS (issue50 F1): while the timer
    // runs the url is `retrying` so warmArt() cannot start a parallel fetch
    retried.add(url)
    retrying.add(url)
    const timer = setTimeout(() => {
      retryTimers.delete(url)
      retrying.delete(url)
      // re-enter through the same admission as every other request — the cap
      // applies to retries too; front of the queue, it was in flight before
      // the queued urls started waiting
      queue.unshift(url)
      queued.add(url)
      pump()
    }, RETRY_DELAY_MS)
    retryTimers.set(url, timer)
  } else {
    // second failure: settled failed — re-warmable via a later warmArt()
    failed.add(url)
    retried.delete(url)
  }
  pump()
}

// issue50 F1: returns true when a fresh warm request was accepted (the fetch
// starts now or waits in the FIFO queue). Done urls are never re-fetched;
// failed and evicted urls become re-warmable again.
export function warmArt(url: string): boolean {
  if (done.has(url) || pending.has(url) || retrying.has(url) || queued.has(url)) return false
  // a new request resets the retry budget — each warm gets at most one
  // bounded auto-retry, never more (no hammering of a dead CDN)
  retried.delete(url)
  if (pending.size < MAX_WARM_INFLIGHT) {
    startFetch(url)
  } else {
    queue.push(url)
    queued.add(url)
  }
  return true
}

export function hasWarmedArt(url: string): boolean {
  return done.has(url)
}

// debug readout (bug45): count + approximate size (url strings only, the
// decoded bitmaps live in Chromium's own image cache, not the JS heap)
export function warmedArtStats(): { entries: number; approxBytes: number } {
  let bytes = 0
  for (const url of done) bytes += url.length
  return { entries: done.size, approxBytes: bytes }
}

// test isolation helper — also drops the listeners of the in-flight Images so
// a stale onload from a previous session cannot move the fresh state
export function __resetWarmedArt(): void {
  for (const img of pending.values()) {
    img.onload = null
    img.onerror = null
  }
  for (const timer of retryTimers.values()) clearTimeout(timer)
  // issue50 F4-B: drop the settle deadlines too — a stale timeout must not
  // move the fresh state after a reset
  for (const timer of settleTimers.values()) clearTimeout(timer)
  pending.clear()
  retrying.clear()
  retried.clear()
  queue.length = 0
  queued.clear()
  done.clear()
  failed.clear()
  retryTimers.clear()
  settleTimers.clear()
}
