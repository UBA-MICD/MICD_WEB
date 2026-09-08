# Tasks: Admin-only server-config settings button

> **Spec:** `specs/001-server-config-settings/spec.md` · **Plan:** `specs/001-server-config-settings/plan.md`

## Phase 0 — Setup

- [x] T001 Branch off `dev`: `feat/tk-29-server-config-settings` (web, desktop);
  `chore/sdd-scaffolding` (backend).

## Phase 1 — Acceptance

- [x] T010 Encode acceptance in `001-server-config-settings.feature`.
- [x] T011 Confirm `server-config-modal.test.ts` still covers modal behaviour
  (no change needed — modal is untouched).

## Phase 2 — Implementation (web)

- [x] T020 `src/main.ts`: repoint `#btn-server` → `openServerScreen("buscar", …)`.
- [x] T021 `src/main.ts`: wire `#btn-server-settings` → `openServerConfigModal(…)`.
- [x] T022 `src/index.html`: add the `#btn-server-settings` gear button in
  `.server-screen__header` (starts `hidden`, `aria-hidden` SVG, i18n accessible name).
- [x] T023 `src/server-screen/server-screen.ts`: gate `#btn-server-settings` on
  `isAdmin()` in `renderForSession()`.
- [x] T024 `src/styles.css`: icon-button styling for `#btn-server-settings`.
- [x] T025 i18n: add `server.configButton` to `src/i18n/locales/es.ts` and `en.ts`.

## Phase 3 — Desktop parity

- [x] T030 `make sync-web` in `desktop/`.
- [x] T031 `make parity` prints match.
- [x] T032 `npm run build` && `npm test` (desktop) green.

## Phase 4 — Verify & deliver

- [x] T040 `npm run build` && `npm test` (web) green.
- [x] T041 Manual check of the headline `.feature` scenarios.
- [x] T042 Commit (with required trailers) and push the branch(es).
