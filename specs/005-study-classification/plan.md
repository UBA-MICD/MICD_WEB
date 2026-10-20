# Plan: Study pathology classification (web)

> **Spec:** `specs/005-study-classification/spec.md` · **Ticket:** US-NN · **Date:** 2026-09-22

## Summary

On opening the Cargar tab, fetch the category catalog (`GET /api/v1/pathologies`) via `authFetch`,
build the `<select>` options from it (value = id, label = `t('classification.'+key)`), append the
chosen `classification_id` to each file's upload `FormData`, and render the returned
`classification_key` as a badge in the study rows — mirroring the existing `validation_status` badge.
No framework, no new dependency.

## Constitution check

- **Plain platform / no new dep:** native `<select>` + `FormData` + `authFetch`; no library.
- **Desktop parity / vendoring:** all edits in `web/src/`; catalog fetch uses `API_BASE`/`authFetch` (existing seam); `desktop` re-syncs — no `desktop/src/renderer/` hand-edits.
- **i18n parity:** keys added to both locale files; `i18n.test.ts` enforces the identical key set; dynamically-built options re-translate on `onLocaleChange`.
- **Accessibility:** labeled native control; badge is plain text, not a live region.
- **Security (escaping, API surface, role gating):** value is a numeric id from a server list; badge text via `t()` (no raw user data); only `/api/*` calls.
- **Tests:** `i18n.test.ts` guards key parity; the fetch/populate/append/badge wiring is DOM+network glue (no new pure logic; covered by the manual `.feature` run).

## Existing code to reuse

- `src/auth/auth.ts` — `API_BASE` + `authFetch()` for the catalog fetch (handles token + 401 retry).
- `src/html/partials/server-screen/tab-usuarios.html:32-43` — labeled `<select>` markup pattern (here the options are injected at runtime, not authored statically).
- `src/i18n/i18n.ts` — `t()` (key fallback) + `onLocaleChange()` to re-translate the built options.
- `src/explorer/explorer.ts:24-40` (`StudyRecord`) + `:473` (`renderStudy`) + `:527` (validation badge) — the type + badge render to extend; `explorer.ts` already re-renders on `onLocaleChange`.
- `src/i18n/locales/{es,en}.ts` `validation.status.*` (e.g. `es.ts:705-708`) — the enum-suffix label pattern to copy.
- `src/upload/upload.ts` `uploadOne` (`~:301`, `FormData` build) + `initUploadPanel` (`:73`) — where to append the field and to trigger the catalog load.

## Design

**Catalog + selector.** The Cargar tab holds a labeled `<select id="upload-classification">` whose
only static child is the blank default (`classification.none`). A small helper in `upload.ts`
fetches `GET /api/v1/pathologies` via `authFetch` **once, lazily, the first time the Cargar tab is
opened** (cached in a module variable), then injects one `<option value="{id}">` per category with
text `t('classification.'+key)`; it stores each option's `key` (e.g. `data-key`) so it can re-label
on `onLocaleChange` without refetching, preserving the current selection. If the fetch fails, the
selector keeps just the blank default (upload proceeds unclassified) — no blocking.

**Classify dialog (revision 2026-09-22).** The selector moved out of the tab into
`#classify-dialog` (`partials/dialogs.html`, next to the duplicate dialog). `startUpload` — after the
auth gate, before any row or XHR — awaits `confirmClassification(count)`: it ensures the catalog is
loaded, resets the select to `""`, opens the dialog via `openDialog`, and resolves `true` only on
`#classify-confirm`; Cancel, Escape and any other close resolve `false` and the queue never starts.
When the dialog isn't in the page (unit fixtures, Buscar quick-drop shell) it resolves `true`, so
FR-6 is unaffected. The select can't change mid-batch: it lives in the closed modal.

**Folder picker / folder drop (FR-7).** `#btn-upload-folder` carries `class="hidden"
data-desktop-only`, so `initDesktopOnlyUI()` reveals it only in Electron; the tour step
`staff.uploadFolder` is `optional` and is skipped when hidden. The drop handler reads
`dataTransfer.items` synchronously: directories go through `webkitGetAsEntry()` and are walked
recursively (`readEntries` until empty, `webkitRelativePath` set from `fullPath` so
`collectDicomFiles` groups series); plain files use `getAsFile()`, because a file _entry_ can be
unreadable for synthetic/foreign drags. Unreadable folders are skipped, not fatal.

**Upload.** The selector is read at send time. In `uploadOne` (the Cargar path only), read `#upload-classification`;
if a non-empty id is selected, `formData.append("classification_id", id)` **before** the `file` part
(busboy/multer field-order convention). `uploadOneExplorer` is left untouched (Buscar quick-drop is
out of scope).

**Display.** `StudyRecord` gains `classification_id?: number | null` and
`classification_key?: string | null`. `renderStudy` renders a badge next to the validation badge:
`t('classification.'+classification_key)` when a key is present, else a muted `classification.none`
("Sin clasificar"). `renderStudy` feeds both the side panel and the Buscar grid, so one change covers
both; the explorer re-renders on locale change, so the badge label follows the locale.

## Affected files

- `src/html/partials/dialogs.html` — `#classify-dialog` holding the labeled `<select id="upload-classification">` (only the blank default; options injected at runtime), `#classify-confirm`, `#classify-cancel`. _(Originally in `tab-cargar.html`; moved 2026-09-22.)_
- `src/html/partials/server-screen/tab-cargar.html` — `#btn-upload-folder` marked `hidden data-desktop-only`.
- `src/walkthrough/tour-steps.ts` — `staff.uploadFolder` step `optional: true`. Then **`npm run build:html`** to regenerate the git-ignored `src/index.html` (never hand-edit it).
- `src/upload/upload.ts` — fetch + cache the catalog and populate the select on first Cargar-tab open; re-label options on `onLocaleChange`; `confirmClassification` gates `startUpload`; `droppedFiles`/`walkEntry` read dropped folders; in `uploadOne`, append `classification_id` when set. Leave `uploadOneExplorer` unchanged.
- `src/explorer/explorer.ts` — add `classification_id`/`classification_key` to `StudyRecord`; render the badge in `renderStudy`.
- `styles.css` — add `.study-item__classification-badge` mirroring `.study-item__validation-badge`.
- `src/i18n/locales/es.ts` **and** `en.ts` — add `classification.label`, `classification.none`, and `classification.{acv,hemorragia,tumor,desmielinizante,normales,otros}`.

## Testing strategy

- **Unit (`tsx --test`):** `i18n.test.ts` fails if a key is added to one locale and not the other (covers FR-5). `upload.test.ts` covers the dialog holding the upload until confirm (and sending the chosen `classification_id`), cancel sending nothing, and a dropped folder + sub-folder + loose file all being queued.
- **E2E (`testing/`, Cypress):** `study-classification.cy.js` SC-7 (pick → dialog → confirm → duplicate/replace → persisted `tumor`), SC-8 (drop → cancel → no request), SC-9 (browser build hides the folder button). See `testing/docs/study-classification-use-cases.md`.
- **DOM / integration:** none required — markup + network glue; covered by the manual `.feature` run.
- **Manual / BDD:** the `005-study-classification.feature` scenarios (catalog loads; upload with/without a category; locale switch relabels options + badge; quick-drop shows no selector).

## Desktop parity steps

`web` first → in `desktop/`: `make sync-web` → `make parity` (must print match) → `npm run build`
→ `npm test`.

## Rollout / delivery

Branch `feat/us-NN-study-classification` off `dev`. `npm run build` (regenerates `index.html` +
`tsc`) and `npm test` green. Re-sync `desktop` and confirm parity. Commit with required trailers;
push. Depends on backend spec `001` being deployed (the catalog endpoint + `classification_id` must
exist).
