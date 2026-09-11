import { useCallback, useRef, useState } from 'react'
import { haTest } from '@/api/haSettings'
import { useSettings } from '@/settings'
import type { HaSettingsValue } from '@/settings'
import { useHomeEntityCatalog } from '@/hooks/useHomeEntities'

// ticket 9.4: the HA connection status for the settings Row AND the modal.
//
// Two layers, deliberately separated:
//
// 1. BASE status (derived, NO fetch): `default` (no/empty ha config — the
//    daemon's build-time config.yml defaults apply) or `configured` (ha
//    config with a url AND a token). The settings Row shows this short
//    status directly (`haBaseStatus(useSettings().ha)`) — nothing is
//    fetched for the Row, not even the catalog.
//
// 2. CONNECTION status (on-demand, via the daemon's POST /api/ha/test):
//    `reachable-unauth` | `authenticated` | `unreachable`. It is ONLY
//    established by an explicit `probe(url, token?)` call — on modal open
//    and after test/save actions. NO ambient polling, no interval, no
//    second polling loop (the 5 s entity-state poll of useHomeEntities is
//    untouched and only runs while Home views are mounted).
//
// A probe result is the LAST probe, full stop: the hook deliberately does
// NOT auto-invalidate it when the saved config changes — the modal re-probes
// right after every action (ticket: "beim Modal-Open + nach Aktionen"), and
// the exposed `probedUrl` / `probedToken` let it detect a stale result (the
// probed values no longer match the current field values).
//
// The ENTITY COUNT reuses the existing 60 s-TTL catalog
// (useHomeEntityCatalog) — the probe stays light (ticket 9.4, offene
// Frage 5: the count stays with the UI catalog, not the endpoint).
//
// Test isolation: the hook holds no module-level state — component state
// only. Resetting the settings store (__resetSettings) and the catalog
// store (__resetHomeEntityStores) plus the automatic server.resetHandlers()
// is all a test needs.

// the derived, fetch-free base status (the settings Row uses this)
export type HaBaseStatus = 'default' | 'configured'

// the connection status from a successful on-demand probe
export type HaConnectionStatus = 'reachable-unauth' | 'authenticated' | 'unreachable'

// the combined 5-state status (ticket 9.4 task 6) — the last probe result
// wins (the modal probes the CURRENT field values, also while the saved
// config is still empty); without a probe the base status applies
// ('default' / 'configured')
export type HaStatus = HaBaseStatus | HaConnectionStatus

// ticket 9.4: the base status derivation. 'configured' requires BOTH a
// url and a token — the daemon proxy needs both, and a url without a token
// is still the "daemon defaults" path (the modal can offer the login flow
// for it). Pure function: the Row combines it with useSettings() and
// renders 'Default' / 'Konfiguriert' without any fetch.
export function haBaseStatus(ha: HaSettingsValue): HaBaseStatus {
  return ha.url !== '' && ha.token !== '' ? 'configured' : 'default'
}

interface ProbeState {
  // the values the stored result describes (the hook never auto-invalidates
  // — the consumer compares these against its current field values)
  url: string
  token: string
  // the last successful probe result (null = not probed yet / the last
  // probe FAILED — a failed probe clears it, the error carries the why)
  connection: HaConnectionStatus | null
  // the last probe error (null = none yet / the last probe succeeded).
  // Carries the HaSettingsApiError message (error class + status), never
  // any credential value
  probeError: string | null
  // the daemon's build-time default URL from the last successful probe
  // response (null until the first successful probe) — the modal pre-fills
  // the URL field with it (task 7)
  defaultUrl: string | null
}

const INITIAL_PROBE_STATE: ProbeState = {
  url: '',
  token: '',
  connection: null,
  probeError: null,
  defaultUrl: null,
}

export interface HaStatusState {
  // the fetch-free base status (Row-level)
  base: HaBaseStatus
  // the last successful probe result (null = not probed yet / last probe
  // failed). Describes the PROBED url/token, not necessarily the saved
  // config
  connection: HaConnectionStatus | null
  // true while the on-demand probe is in flight
  probing: boolean
  // the last probe error (null = none yet / the last probe succeeded).
  // Carries the HaSettingsApiError message (error class + status), never
  // any credential value
  probeError: string | null
  // the daemon's build-time default URL (null until the first successful
  // probe)
  defaultUrl: string | null
  // the values the last probe described ('' = not probed yet) — let the
  // modal detect a stale result after a save or a field edit
  probedUrl: string
  probedToken: string
  // the combined 5-state status for display (see HaStatus)
  status: HaStatus
  // entity count via the existing 60 s-TTL catalog (shared with the Home
  // views — a second poll never happens)
  entityCount: number
  entitiesLoading: boolean
  entitiesError: string | null
  // the ONLY way the connection status is established (modal open, after
  // test/save actions). Empty urls and overlapping calls are no-ops.
  probe: (url: string, token?: string) => void
  // force a fresh catalog fetch (fresh entity count)
  refetchEntities: () => void
}

export function useHaStatus(): HaStatusState {
  const settings = useSettings()
  const base = haBaseStatus(settings.ha)

  // the catalog is the shared, TTL-gated store (mount fetch + existing
  // consumers) — the hook only reads it, it never starts its own polling
  const catalog = useHomeEntityCatalog()

  const [probeState, setProbeState] = useState<ProbeState>(INITIAL_PROBE_STATE)
  const [probing, setProbing] = useState(false)
  const inFlight = useRef(false)

  const probe = useCallback((url: string, token?: string) => {
    const trimmed = url.trim()
    if (trimmed === '' || inFlight.current) return
    inFlight.current = true
    const tokenValue = token !== undefined && token !== '' ? token : ''
    setProbing(true)
    const body: { url: string; token?: string } = { url: trimmed }
    if (tokenValue !== '') body.token = tokenValue
    void haTest(body)
      .then((result) => {
        setProbeState({
          url: trimmed,
          token: tokenValue,
          connection: result.reachable
            ? result.authenticated
              ? 'authenticated'
              : 'reachable-unauth'
            : 'unreachable',
          probeError: null,
          defaultUrl: result.defaultUrl,
        })
      })
      .catch((err: unknown) => {
        // a failed probe clears the old connection (it no longer describes
        // reality) and records the error — the HaSettingsApiError message
        // carries the error class + status only, never a credential value
        setProbeState((prev) => ({
          url: trimmed,
          token: tokenValue,
          connection: null,
          probeError: err instanceof Error ? err.message : 'ha test failed',
          defaultUrl: prev.defaultUrl,
        }))
      })
      .finally(() => {
        inFlight.current = false
        setProbing(false)
      })
  }, [])

  return {
    base,
    connection: probeState.connection,
    probing,
    probeError: probeState.probeError,
    defaultUrl: probeState.defaultUrl,
    probedUrl: probeState.url,
    probedToken: probeState.token,
    // the probe result wins (it describes the probed values, which the
    // modal also uses while the saved config is still empty); without a
    // probe the base status applies
    status: probeState.connection ?? base,
    entityCount: catalog.entries.length,
    entitiesLoading: catalog.loading,
    entitiesError: catalog.error,
    probe,
    refetchEntities: catalog.refetch,
  }
}
