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

**Upload.** The Cargar tab uploads the instant files are picked/dropped, so the selector is set
first and read at send time. In `uploadOne` (the Cargar path only), read `#upload-classification`;
if a non-empty id is selected, `formData.append("classification_id", id)` **before** the `file` part
(busboy/multer field-order convention). `uploadOneExplorer` is left untouched (Buscar quick-drop is
out of scope).

**Display.** `StudyRecord` gains `classification_id?: number | null` and
`classification_key?: string | null`. `renderStudy` renders a badge next to the validation badge:
`t('classification.'+classification_key)` when a key is present, else a muted `classification.none`
("Sin clasificar"). `renderStudy` feeds both the side panel and the Buscar grid, so one change covers
both; the explorer re-renders on locale change, so the badge label follows the locale.

## Affected files

- `src/html/partials/server-screen/tab-cargar.html` — add a labeled `<select id="upload-classification">` containing only the blank default (`classification.none`); options are injected at runtime. Then **`npm run build:html`** to regenerate the git-ignored `src/index.html` (never hand-edit it).
- `src/upload/upload.ts` — fetch + cache the catalog and populate the select on first Cargar-tab open; re-label options on `onLocaleChange`; in `uploadOne`, append `classification_id` when set. Leave `uploadOneExplorer` unchanged.
- `src/explorer/explorer.ts` — add `classification_id`/`classification_key` to `StudyRecord`; render the badge in `renderStudy`.
- `styles.css` — add `.study-item__classification-badge` mirroring `.study-item__validation-badge`.
- `src/i18n/locales/es.ts` **and** `en.ts` — add `classification.label`, `classification.none`, and `classification.{acv,hemorragia,tumor,desmielinizante,normales,otros}`.

## Testing strategy

- **Unit (`tsx --test`):** no new pure logic; `i18n.test.ts` fails if a key is added to one locale and not the other (covers FR-5). If the catalog→option mapping is extracted as a pure helper, add a tiny test for it.
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
