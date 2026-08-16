# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MICD web client — the browser-based DICOM viewer/study explorer. Plain TypeScript (no framework, no bundler — `tsc` compiles `src/**/*.ts` straight to `dist/` mirroring the folder structure, loaded via `<script type="module">`), served in production by nginx, which also reverse-proxies `/api/*` and `/auth/*` to the `backend` repo's API on the same origin.

## Critical networking requirement

This frontend never talks to Postgres/Orthanc directly — it only calls the backend's `/api/*` and `/auth/*` endpoints. The origin those calls target is resolved once in `src/auth/auth.ts` (`API_ORIGIN`, re-used across features via the exported `API_BASE`): it defaults to `http://localhost:3000` for local dev (page opened directly or served without nginx). For the Docker/nginx deployment, where the page is served same-origin and nginx reverse-proxies `/api` and `/auth` to `http://backend:3000` (see `nginx.conf`), set `window.MICD_API_ORIGIN = ""` before `auth.ts` loads to use the same-origin path. In Docker, this container joins an **external** network named `micd` that is created by the `backend` repo's `docker-compose.yml` — **the backend stack must be started first** (`make up` in `../backend`), or `docker compose up` here will fail with the network not existing.

## Commands

```bash
make install    # npm install + create .env from .env.example
make up          # docker compose up -d (requires the backend stack's `micd` network to already exist)
make down          # stop and remove the container
make build           # rebuild the Docker image
make restart          # build + up
make check             # curl-check the frontend is serving, and that /api proxies through
make test               # npm test (node:test unit tests)
make hooks                # install pre-commit git hooks

npm run build   # tsc -p tsconfig.json, compiles src/**/*.ts -> dist/
npm test         # node --experimental-strip-types --test 'src/**/*.test.ts'
```

Run these in a container rather than on the host. **`npm test` needs Node 22+**
for `--experimental-strip-types`; the Dockerfile's `node:20` builder only ever
runs `tsc`, so it is fine there but will fail the tests:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm install && npm run build && npm test"
```

There's no dev server with hot reload — iterate with `npm run build` and reload the page, or work against the Docker container.

## Architecture

The source is feature-first: `src/main.ts` is the only entry point (bootstrap + wiring of each feature's `init*`), and each feature lives in its own folder.

**The organising idea:** viewing local DICOM files is free and needs no session — the app always starts, and `startApp()` runs before any auth attempt. Everything that touches the server lives behind one `Servidor` button that leaves the viewer for a dedicated screen. There is no login modal; a guest who goes to the server screen lands on its auth card, and so does a session that dies mid-operation.

Two top-level **screens** are registered with `shared/screen.ts` and exactly one is visible: `#viewer-screen` and `#server-screen`. The inactive one keeps its DOM (so viewport state survives a round trip) but is hidden _and_ `inert`.

- **`src/main.ts`** — entry point: points `setLoginPrompt()` at the server screen, subscribes `updateAuthUI` via `onAuthChange`, calls every feature's `init*`, then attempts a silent session restore.
- **`src/auth/auth.ts`** — owns the session, DOM-free (unit-tested in `auth.test.ts` with stubbed `fetch`/`localStorage`): the access token lives in a module-level variable only (never persisted — cleared on reload), the refresh token lives in `localStorage` and is **rotated on every refresh**, which is why `refreshAccessToken()` is single-flight. `ensureAuthenticated()` is the gate every server operation goes through: in-memory token → silent refresh → login prompt (also single-flight). `authFetch()` wraps every protected fetch: attaches `Authorization: Bearer`, and on a 401 escalates refresh → prompt → one retry; if the user backs out, the caller gets the original 401. It also decodes the token's `exp` claim (`getSessionExpiresAt()`), which drives the countdown. `API_ORIGIN`/`API_BASE` resolution lives here (see networking section above).
- **`src/auth/login-form.ts`** — `mountLoginForm(form, opts)`: the submit/error/disable behaviour, found by `data-login-*` attributes inside the given form so more than one instance can exist. The single path to `login()`.
- **`src/auth/session-ui.ts`** — `updateAuthUI()`, the one place that repaints everything session-dependent (avatar, email, expiry countdown, panel footer, which buttons show). Also owns the activity-history dialog. The countdown ticks once a second and is **not** in a live region; a separate `#session-announce` element announces once near expiry.
- **`src/server-screen/server-screen.ts`** — the takeover (design screens 02-04): back link, Buscar/Cargar tablist, and the auth card a guest lands on. Exports `promptLoginOnServerScreen`, which is what `auth.ts` calls when a token dies mid-operation — the `LoginPrompt` contract (single-flight `Promise<boolean>`) is unchanged.
- **`src/explorer/explorer.ts`** — the study explorer, rendered into **two views at once**: the compact panel beside the viewer and the wide grid on Buscar. Controls are found by `data-explorer-*` attribute inside a view root rather than by global id, because ids could only describe one of the two. Both share one filter state and one fetch. The views differ only in what a click means — the panel opens a study immediately (`mode: "open"`), Buscar selects it as a listbox option and `Abrir estudio seleccionado` confirms (`mode: "select"`). Thumbnails are loaded via `authFetch` + `URL.createObjectURL`, so the CSP must allow `blob:` in `img-src`.
- **`src/upload/upload.ts`** — the Cargar tab. Every file gets its own progress row and its own XHR, because `fetch` reports no upload progress. Files upload one at a time. The XHR path can't use `authFetch`, so it pre-flights `ensureAuthenticated()` and does its own on-401 refresh + single retry per file. Exposes `onUploadComplete()`; it never navigates itself, since the server screen already imports it.
- **`src/viewer/`** — `state.ts` (the shared mutable `AppState`), `loading.ts` (file/folder pickers, drag-drop, `displayDicom`), `rendering.ts` (canvas render, metadata panel, info overlays — all DICOM-derived text is escaped, and the canvas `aria-label` is written here), `interaction.ts` (toolbar, mouse and **keyboard** window/level-zoom-pan, resize observer, Electron menu hooks).
- **`src/shared/`** — `dom.ts` (`$`, `escapeHtml`/`escapeAttr`, `showLoading`/`showError`, `formatDate`), `screen.ts` (viewer↔server switching), `dialog.ts` (`openDialog`/`closeDialog`: focus trap, Escape, background `inert`, focus restore; `anyDialogOpen()` lets global shortcuts stand down), `roving.ts` (single-tab-stop groups; `nextRovingIndex` is pure and unit-tested), `banner.ts` (the confirmation strip), `folder-files.ts` (DICOM filtering/sorting, unit-tested).
- **`src/index.html`** — one document holding both screens plus the duplicate-upload and activity dialogs. Loads `./dicomParser.min.js` (UMD) before `./main.js`.
- **`src/dicom/dicom-parser-util.ts`** / **`src/dicom/dicom-renderer.ts`** — pure DICOM parsing and canvas window/level/zoom/pan rendering.

## Accessibility

The UI targets WCAG 2.2 AA, and several conventions exist to keep it there:

- **Contrast is measured, not eyeballed.** The token comment in `styles.css` records the ratios. `--text-dim` is deliberately below AA and is for non-text UI only; `--border-strong` exists for control boundaries that need 3:1 (WCAG 1.4.11).
- **State that is visual must also be programmatic**: `aria-pressed` on the mode tools and modality chips, `aria-expanded` on the metadata toggle, `aria-current` on the loaded study, `aria-selected` on listbox options. Where possible the CSS keys off the ARIA attribute so the two cannot drift.
- **Live regions are rationed.** Anything that updates continuously (the session countdown, upload percentages) stays out of them; the file count and one-off warnings are what get announced.
- **Every group is one tab stop** via `shared/roving.ts`, and every modal traps focus and restores it via `shared/dialog.ts`.
- Reflow below ~900px is **not** claimed: a three-pane DICOM viewer does not reflow to 320px.

## Known gaps

- **Activity history has no backend.** `Ver historial de actividad` calls `GET /api/v1/activity`, which does not exist: the backend writes an `audit_log` via `shared/audit.ts` but exposes no reader, and `AUDIT_ACTIONS` covers only Zenodo operations — no logins, uploads, downloads or study views. The dialog says so on a 404. Landing it needs a read route returning `{ entries: [{ action, resourceId, timestamp }] }` scoped to the caller, plus new audit actions.
- **Multi-repo context** — sibling repos `backend` (the API this proxies to) and `desktop` (an Electron app). `desktop/frontend/src/` was once a file-for-file mirror of this source, but the two have **diverged substantially**: it still has a monolithic `renderer.ts` with no feature folders, and none of the screen/dialog/roving primitives, the server screen, or the accessibility work above. Only `dicom-parser-util.ts` and `dicom-renderer.ts` are still worth keeping in lockstep by filename.
