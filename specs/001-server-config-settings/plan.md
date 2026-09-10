# Plan: Admin-only server-config settings button

> **Spec:** `specs/001-server-config-settings/spec.md` · **Ticket:** TK-29 · **Date:** 2026-09-08

## Summary

The config modal, its DOM (`#server-config-dialog`), its validation layer
(`services/api.ts`) and its tests already exist — only the *trigger* is wrong. Move
the trigger: point the main-page **Servidor** button (`#btn-server`) at the server
screen, and add an **admin-only gear button** in the server-screen header that opens
the existing modal. No modal behaviour changes.

## Constitution check

- **I. Server is one deliberate step away:** restored — `#btn-server` now opens the
  server screen instead of a dialog over the viewer. ✅
- **II. No new dependency:** none added. ✅
- **III. Desktop parity:** change is in `web/src` + `index.html` + `styles.css` +
  i18n; re-vendored via `make sync-web`. ✅
- **IV. i18n parity:** one key added to both locale files. ✅
- **V. Accessibility:** icon `<button>` with an accessible name + focus ring; SVG
  `aria-hidden`; normal tab stop. ✅
- **VI. Security / role gating:** visibility gated by `isAdmin()`; no new API surface.
  ✅
- **VII. Tests:** existing modal tests unaffected; no `main.ts` test to update. ✅

No principle is violated; no ADR required.

## Existing code to reuse

- `src/server-screen/server-config-modal.ts` — `openServerConfigModal(opener?)`
  already opens/pre-fills the modal; `initServerConfigModal()` wires it. Reuse as-is.
- `src/server-screen/server-screen.ts` — `openServerScreen("buscar", opener)` is the
  canonical way to enter the server interface; `renderForSession()` is the single
  place role-gated visibility is computed (`isAdmin()` already imported).
- `src/shared/dom.ts` — `$()` for the click wiring in `main.ts`.
- `src/i18n/i18n.ts` — `data-i18n-attr` applies `aria-label`/`title` from a key.

## Design

`main.ts` is where cross-screen buttons are already wired (`btn-server`,
`btn-login`, `btn-logout`). Keep that: repoint `#btn-server` to `openServerScreen`
and wire the new gear (`#btn-server-settings`) to `openServerConfigModal`. Wiring the
gear's *click* in `main.ts` (rather than in `server-screen.ts`) deliberately avoids a
circular import — `server-config-modal.ts` already imports from `server-screen.ts`.

The gear's *visibility* belongs with the other role gating in
`renderForSession()`: one `toggle("hidden", !isAdmin())`, placed before the guest
early-return so it is correct in every branch, using
`getElementById(...)?.` so a partial test DOM cannot throw. Because
`renderForSession()` runs on entry and on `onAuthChange`, the gear follows role
changes for free (satisfies AC-4).

## Affected files

- `src/main.ts` — `#btn-server` handler → `openServerScreen("buscar", …)`; add
  `#btn-server-settings` → `openServerConfigModal(…)`.
- `src/index.html` — add `<button id="btn-server-settings" class="… hidden">` (gear
  SVG, `aria-hidden`) in `.server-screen__header`, accessible name via
  `data-i18n-attr="aria-label:server.configButton; title:server.configButton"`.
- `src/server-screen/server-screen.ts` — in `renderForSession()`, gate
  `#btn-server-settings` with `isAdmin()`.
- `src/styles.css` — icon-button rule for `#btn-server-settings` (like `.btn-back`,
  `margin-left:auto`).
- `src/i18n/locales/es.ts`, `src/i18n/locales/en.ts` — add `server.configButton`.

Id note: `btn-server-settings` is intentionally distinct from the modal's own
`btn-server-config-cancel` / `btn-server-config-save`.

## Testing strategy

- **Unit:** `server-config-modal.test.ts` continues to pass unchanged (modal
  behaviour is untouched). `i18n.test.ts` enforces the new key in both locales.
- **DOM/integration:** none added — `main.ts` (bootstrap) and the one-line
  visibility toggle are DOM glue the repo does not unit-test; the visibility rule is
  defensive (`?.`) so no existing suite breaks.
- **Manual / BDD:** `001-server-config-settings.feature` — the headline scenarios
  (Servidor→server screen; gear admin-only; gear opens modal; no main-page path).

## Desktop parity steps

`web` green → in `desktop/`: `make sync-web` → `make parity` (must match) →
`npm run build` → `npm test`.

## Rollout / delivery

- Branch off `dev`: `feat/tk-29-server-config-settings` (web + desktop);
  `chore/sdd-scaffolding` (backend, scaffolding only).
- Commit order: SDD scaffolding → spec 001 → code fix (web). Commit web before
  syncing desktop so `.web-sync` records the web commit that carries the fix.
- Verify (build + test + manual), then push each branch. PRs optional.
