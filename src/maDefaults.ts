// issue #134: baked-in Music Assistant connection defaults.
//
// The MA token is 376 chars — entering it through the on-screen keyboard on
// the Car Thing is impractical, so the values are baked into the build and
// used as PRE-FILL for unconfigured installs (user decision 2026-10-20).
// They are NOT auto-saved: the fields simply open pre-filled, and the user's
// "Speichern" write is what lands them in the settings blob — exactly like
// typing them in would. A saved empty url (explicitly cleared) stays empty;
// only a truly unconfigured install (no `ma` key) falls back to these.
//
// SECURITY: same documented trade-off as the blob itself (plaintext at rest,
// this time also in the bundle) — the values are NEVER logged: no console.*
// call anywhere in the app carries them (the security test in
// MaSettingsModal.test.tsx asserts it for the full modal flow).
export const MA_URL_DEFAULT = 'http://10.10.1.104:8095'
export const MA_TOKEN_DEFAULT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3OFZxM1R0S0dmbV9SMnQ4V3JEdWNlQnJ2MU5YUElNM1VyNTFwWXJIUDVVIiwianRpIjoiR3ZPQnEwbzlMTW5Cb0RHRnA2S0wyeExWMHhGZmYzZ2wxcDY3TGdOOUowUSIsImlhdCI6MTc5MjQ5NjAzNCwiZXhwIjoxODI0MDMyMDM0LCJ1c2VybmFtZSI6ImRhbmllbCIsInJvbGUiOiJhZG1pbiIsInRva2VuX25hbWUiOiJNaXJhLXRoaW5nIiwiaXNfbG9uZ19saXZlZCI6dHJ1ZX0.SsgpZHr27s-m6VWXbbUDLm-0Gol4mdpEHJvk1dwNDQg'
