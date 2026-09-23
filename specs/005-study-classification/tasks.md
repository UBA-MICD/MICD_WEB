# Tasks: Study pathology classification (web)

> **Spec:** `specs/005-study-classification/spec.md` · **Plan:** `specs/005-study-classification/plan.md`

## Phase 0 — Setup

- [ ] T001 Branch off `dev`: `feat/us-NN-study-classification`.

## Phase 1 — Tests / acceptance first

- [ ] T010 Encode acceptance in `specs/005-study-classification/005-study-classification.feature`.
- [ ] T011 [P] Confirm `i18n.test.ts` will guard the new key parity (add a small unit test only if the catalog→option mapping is extracted as a pure helper).

## Phase 2 — Implementation

- [ ] T020 `tab-cargar.html` — add the labeled `<select id="upload-classification">` with only the blank default option; run `npm run build:html`.
- [ ] T021 `upload.ts` — fetch + cache the catalog via `authFetch` on first Cargar-tab open; inject `<option value=id>` per category (label via `t('classification.'+key)`, store `data-key`); re-label on `onLocaleChange`.
- [ ] T022 `upload.ts` — append `classification_id` to `FormData` in `uploadOne` when set (Cargar only).
- [ ] T023 `explorer.ts` — `StudyRecord.classification_id`/`classification_key` + badge in `renderStudy`.
- [ ] T024 [P] `styles.css` — `.study-item__classification-badge`.
- [ ] T025 i18n: add keys to `src/i18n/locales/es.ts` and `en.ts` (both).

## Phase 3 — Desktop parity

- [ ] T030 `make sync-web` in `desktop/`.
- [ ] T031 `make parity` prints match.
- [ ] T032 `npm run build` && `npm test` (desktop).

## Phase 3b — Revision 2026-09-22: classify dialog + no browser folder prompt

- [x] T050 `dialogs.html` — `#classify-dialog` with the select, `#classify-confirm`, `#classify-cancel`; select removed from `tab-cargar.html`.
- [x] T051 `upload.ts` — `confirmClassification()` gates `startUpload` after the auth check; select reset to blank on open.
- [x] T052 i18n — `upload.classifyTitle`, `upload.classifyMessage`, `upload.classifyConfirm` in `es` + `en`.
- [x] T053 `styles.css` — `.classify-field`.
- [x] T054 `tab-cargar.html` — `#btn-upload-folder` → `hidden data-desktop-only`; `tour-steps.ts` `staff.uploadFolder` → `optional: true`.
- [x] T055 `upload.ts` — `droppedFiles`/`walkEntry`: dropped folders walked via entries API, plain files via `getAsFile()`.
- [x] T056 Unit tests in `upload.test.ts` (confirm, cancel, folder drop).
- [x] T057 E2E SC-7 … SC-9 in `testing/cypress/e2e/study-classification.cy.js` — 9/9 green against the local stack.
- [ ] T058 Re-sync `desktop` (`make sync-web` → `make parity`) and check the folder button shows there.

## Phase 4 — Verify & deliver

- [ ] T040 `npm run build` && `npm test` (web) green.
- [ ] T041 Manual check of the headline `.feature` scenarios (catalog loads; badge shows; locale relabels; quick-drop has no selector).
- [ ] T042 Commit (with required trailers) and push the branch.
