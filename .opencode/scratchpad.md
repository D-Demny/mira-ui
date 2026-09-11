# Scratchpad — bug59b Push+Build+Device-Deploy+CDP-Verify (DONE)

## Ergebnis (11.09., alle Schritte sauber)
- [x] Push: origin/fix/bug59 9eb3eff → **f592940**
- [x] Build: `index-legacy-LVEEuKow.js` md5 **b0e05572c21d189775cfbb7b22a5d0c7** (= erwartet, deterministisch)
      + `polyfills-legacy-pGSbUGFB.js` md5 dacaddff31c452df4bd0c2e2dcc81cab
- [x] Deploy: Bind-Mount war aktiv (/dev/data → /etc/mira/ui); Content via 2-Hop-Tar-Pipe ersetzt
      (MIRA_IP 192.168.7.38, MOUNT NICHT neu, kein Reboot). md5 auf Device verifiziert.
- [x] CDP-Verify (Port 22220): exit 0 — Asset geladen, 0 JS-Fehler, 0 failed Network;
      nur 40× /lyrics/* 404 (environmental, nicht fatal).

## Nächster Schritt
Nichts offenes aus dieser Aufgabe — A/B-Manual-Test Bug59 + PR/Merge liegen beim User.

---

# Scratchpad — Worker #35: Bug59b Device-Verifikation (11.09.)

## Ziel
Bug59b (f592940) auf S905D2 verifizieren: Burst L (−10×35, F0→F35) + R (+10×35, F35→F0), 45ms-Zeitgitter, Flash-Checks (Arm/Settle) + Akzeptanz A + Restzustand.

## Zustand (Setup verifiziert 11.09.)
- [x] Git: fix/bug59 @ f592940, working tree clean (nur untracked .opencode/)
- [x] CDP-Tunnel 22220→Pi→Device: alive, Page http://localhost/, Titel "Mira"
- [x] Settings LS `mira.settings.v1`: sidebarBackground="blur" ✓; Kategorie Playlists aktiv (Row 2) ✓
- [x] UI: scrollLeft 0, F=0 "Liked Songs", blurCards 0, 17 Cards im Window → Start-Reset unnötig
- Skripte: /tmp/opencode/bug59b-run.js (v3 Sampler+MutationObserver), cdp-capture-run.js <dx> <out> (Console/Net-Capture)

## Lauf-Ergebnisse (werden nach JEDEM Lauf ergänzt)
- Run L: — (ausstehend)
- Rest L: —
- Run R: —
- Rest R: —
