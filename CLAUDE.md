# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MICD web client — the browser-based DICOM viewer/study explorer. Plain TypeScript (no framework, no bundler — `tsc` compiles `src/**/*.ts` straight to `dist/` mirroring the folder structure, loaded via `<script type="module">`), served in production by nginx, which also reverse-proxies `/api/*` and `/auth/*` to the `backend` repo's API on the same origin.

## Critical networking requirement

This frontend never talks to Postgres/Orthanc directly — it only calls the backend's `/api/*` and `/auth/*` endpoints. The origin those calls target is resolved once in `src/auth/auth.ts` (`API_ORIGIN`, re-used across features via the exported `API_BASE`): it defaults to `http://localhost:3000` for local dev (page opened directly or served without nginx). For the Docker/nginx deployment, where the page is served same-origin and nginx reverse-proxies `/api` and `/auth` to `http://backend:3000` (see `nginx.conf`), `window.MICD_API_ORIGIN ??= ""` in `index.html` (before `auth.ts` loads) resolves the same-origin path. It's `??=`, not `=`: the vendored copy of this file also ships inside the desktop app, where Electron's preload sets `window.MICD_API_ORIGIN` synchronously before any page script runs — the browser build's default must not clobber it. In Docker, this container joins an **external** network named `micd` that is created by the `backend` repo's `docker-compose.yml` — **the backend stack must be started first** (`make up` in `../backend`), or `docker compose up` here will fail with the network not existing.

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

npm run build   # prebuild (assemble src/index.html from html/ partials) + tsc src/**/*.ts -> dist/
npm run build:html  # just re-assemble src/index.html (build-html.mjs)
npm test         # tsx --test 'src/**/*.test.ts' (tsx is a pinned devDependency)
```

Run these in a container rather than on the host:

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
- **`src/auth/accept-invite.ts`** / **`src/auth/password-reset.ts`** — the two public, session-less credential flows, built the same way: a screen entered from an emailed link (`?invite=` / `?reset=`, stripped from the URL before any request) plus a modal on the login card for typing the code by hand (the only path on desktop). Password reset is a two-step dialog (`#forgot-dialog`: request code → code + new password) and the reset screen (`#reset-screen`); both end in `adoptSession`. Backend side and security rationale: `backend/docs/password-recovery.md`.
- **`src/auth/session-ui.ts`** — `updateAuthUI()`, the one place that repaints everything session-dependent (avatar, email, expiry countdown, panel footer, which buttons show). Also owns the activity-history dialog. The countdown ticks once a second and is **not** in a live region; a separate `#session-announce` element announces once near expiry.
- **`src/server-screen/server-screen.ts`** — the takeover (design screens 02-04): back link, Buscar/Cargar tablist, and the auth card a guest lands on. Exports `promptLoginOnServerScreen`, which is what `auth.ts` calls when a token dies mid-operation — the `LoginPrompt` contract (single-flight `Promise<boolean>`) is unchanged.
- **`src/explorer/explorer.ts`** — the study explorer, rendered into **two views at once**: the compact panel beside the viewer and the wide grid on Buscar. Controls are found by `data-explorer-*` attribute inside a view root rather than by global id, because ids could only describe one of the two. Both share one filter state and one fetch. The views differ only in what a click means — the panel opens a study immediately (`mode: "open"`), Buscar selects it as a listbox option and `Abrir estudio seleccionado` confirms (`mode: "select"`). Thumbnails are loaded via `authFetch` + `URL.createObjectURL`, so the CSP must allow `blob:` in `img-src`.
- **`src/upload/upload.ts`** — the Cargar tab. Files first, classification second: once files are picked or dropped, `startUpload` awaits `confirmClassification()`, an in-app modal (`#classify-dialog`, reset to "Sin clasificar" each time) — nothing is sent until "Subir"; Cancel/Escape upload nothing. Never use browser `alert`/`confirm` here. The browser build offers **no folder picker**: `<input webkitdirectory>` makes Chrome show its own "Upload N files to this site?" prompt, which a page cannot suppress, so `#btn-upload-folder` is `data-desktop-only` and folders are **dropped** instead — `droppedFiles()` walks directories via `webkitGetAsEntry()` and reads plain files with `getAsFile()` (a file *entry* can be unreadable for synthetic/foreign drags). Every file gets its own progress row and its own XHR, because `fetch` reports no upload progress. Files upload one at a time. The XHR path can't use `authFetch`, so it pre-flights `ensureAuthenticated()` and does its own on-401 refresh + single retry per file. Exposes `onUploadComplete()`; it never navigates itself, since the server screen already imports it.
- **`src/viewer/`** — `state.ts` (the shared mutable `AppState`), `loading.ts` (file/folder pickers, drag-drop, `displayDicom`), `rendering.ts` (canvas render, metadata panel, info overlays — all DICOM-derived text is escaped, and the canvas `aria-label` is written here), `interaction.ts` (toolbar, mouse and **keyboard** window/level-zoom-pan, resize observer, Electron menu hooks).
- **`src/shared/`** — `dom.ts` (`$`, `escapeHtml`/`escapeAttr`, `showLoading`/`showError`, `formatDate`), `screen.ts` (viewer↔server switching), `dialog.ts` (`openDialog`/`closeDialog`: focus trap, Escape, background `inert`, focus restore; `anyDialogOpen()` lets global shortcuts stand down), `roving.ts` (single-tab-stop groups; `nextRovingIndex` is pure and unit-tested), `banner.ts` (the confirmation strip), `folder-files.ts` (DICOM filtering/sorting, unit-tested), `token-store.ts` and `desktop.ts` (see Desktop parity below).
- **`src/i18n/`** — see Internationalization below.
- **`src/index.html`** — one document holding both screens plus the classify-before-upload, duplicate-upload and activity dialogs. Loads `./dicomParser.min.js` (UMD) before `./main.js`. **This file is generated — do not hand-edit it.** Because there's no bundler and the same document is served by nginx _and_ loaded from `file://` by Electron under a strict `default-src 'self'` CSP (runtime `fetch` of HTML fragments is not possible), the markup is authored as fragments under **`src/html/`** and concatenated at build time: `src/html/index.template.html` is the document skeleton, `src/html/partials/*.html` are the sections (`topbar`, `sidebar`, `main-content`, `explorer-panel`, `zenodo-panel`, `server-screen`, `invite-screen`, `reset-screen`, `dialogs`), and `scripts/build-html.mjs` resolves the `<!-- @include html/partials/NAME.html -->` directives into `src/index.html`. It runs as `prebuild` (so `npm run build` keeps it in sync). `src/index.html` is a **generated artifact and is git-ignored** — like `dist/` and `src/vendor/fflate.js` — so it never appears in diffs; the build produces it (the Dockerfile copies the builder's freshly-assembled copy, and any environment that loads it directly, e.g. the Electron renderer, must run the build first, which it already does for `dist/`). To change the markup, edit the template/partial and run `npm run build` (or `npm run build:html`); never edit `src/index.html` directly, as it will be overwritten.
- **`src/dicom/dicom-parser-util.ts`** / **`src/dicom/dicom-renderer.ts`** — pure DICOM parsing and canvas window/level/zoom/pan rendering.

## Internationalization

The UI ships in Spanish (`es`, the default and the app's original language) and English (`en`). Everything lives in `src/i18n/`:

- **`i18n.ts`** — `t(key, params?)` looks up the active locale with `{{param}}` interpolation and falls back to the key itself if missing (never throws). `setLocale()`/`currentLocale()` persist the choice to `localStorage` (`micd_lang`). `applyTranslations(root)` walks `[data-i18n]` (textContent), `[data-i18n-html]` (innerHTML — only for the handful of static, app-authored strings that carry trusted markup, e.g. `<kbd>` shortcut hints; never for DICOM/user-supplied data), and `[data-i18n-attr]` (`"attr:key; attr2:key2"`). `onLocaleChange(cb)` subscribes to switches. All browser-global access is guarded (`typeof localStorage`/`navigator`), because this module is unit-tested under Node's bare test runner and is also vendored into the Electron renderer.
- **`locales/es.ts`** / **`locales/en.ts`** — flat `key -> string` maps. `i18n.test.ts` asserts they carry the **same key set**, which is what stops the two from silently drifting apart — add a key to one, the test fails until you add it to the other.
- **Static markup** (`index.html`) is translated once via `applyTranslations(document)` in `main.ts`'s `initI18n()`, called before `startApp()`, and re-applied on every `onLocaleChange`.
- **Dynamically-rendered markup** — features that build their own HTML from live data (`explorer.ts`, `study-detail-panel.ts`, the metadata/series-nav/info-overlay trio in `rendering.ts`, the Zenodo panel's config/publish/logs tabs, the upload transport note) don't go through the static-DOM pass, so each subscribes to `onLocaleChange` and re-renders itself. The one deliberate exception is Zenodo search results: they stay in whatever locale they were fetched in, since the next search naturally lands in the new one — re-rendering already-fetched result cards wasn't worth the extra state.
- **First-visit detection**: `initLocaleFromBrowser()` (called once from `main.ts`, browser-only) matches `navigator.language` against a supported locale, but only if `micd_lang` has never been stored. It's deliberately **not** run at module load in `i18n.ts` itself — Node's test runner also has a `navigator` global, and a CI container's own locale must never leak into the `es`-asserting unit tests that import `i18n.ts` transitively (e.g. `auth.test.ts`).
- Adding a string: add the key to both locale files, then either `data-i18n="the.key"` in HTML or `t("the.key")` in TS. If the call site is inside a function that only runs once (at `init*` time) rather than on every render, wire an `onLocaleChange` re-render — a string that looks translated but freezes after the first paint is the usual mistake here.

## Desktop parity

**Every feature landed here must also work in `desktop` (an Electron app), and vice versa — this is a standing rule, not a one-time migration.** `desktop/src/renderer/` is a verbatim copy of this repo's `src/`, kept in sync by a script in `desktop/` and checked by CI (`diff -r web/src desktop/src/renderer` must be empty). Practically, this means:

- **Never write Electron-specific branches directly in a feature file.** Anything that needs to differ under Electron goes through a shared, feature-detected seam:
  - `shared/token-store.ts` — the refresh token goes through `window.api.secureStore` (Electron's `safeStorage`) when present, else `localStorage`.
  - `services/export-service.ts`'s `downloadBlob()` — `window.api.saveFile` (native save dialog) when present, else the browser's `<a download>`.
  - `window.MICD_API_ORIGIN ??= ""` in `index.html` — see the networking section above.
  - `shared/desktop.ts` — `isDesktop()` and `initDesktopOnlyUI()`, which unhides `[data-desktop-only]` markup (the server screen's API-origin field, meaningless in the browser build where nginx already proxies same-origin; and the Cargar tab's "Seleccionar carpeta" button, which in a browser would trigger Chrome's unsuppressible folder-upload prompt).
  - `global.d.ts` declares the full `window.api` contract these target. `window.api` is simply `undefined` in the browser, so every seam takes its already-tested fallback path with zero desktop-specific setup.
- **This file (`web/`) is upstream.** A change to shared behavior lands here first; `desktop` never hand-edits `src/renderer/` — it re-syncs from this repo's `src/`. If you're fixing something and find yourself editing a file under `desktop/src/renderer/`, stop and make the change in `web/src/` instead.
- **Offline-capable by construction.** Electron loads from `file://` under `default-src 'self'`, so nothing here may depend on a CDN: `fflate` is generated at build time from `node_modules` (see `Dockerfile`), and Inter/JetBrains Mono ship as local variable-weight `woff2` files in `src/vendor/fonts/` (latin subset only — sufficient for `es`/`en`).

## Accessibility

The UI targets WCAG 2.2 AA, and several conventions exist to keep it there:

- **Contrast is measured, not eyeballed.** The token comment in `styles.css` records the ratios. `--text-dim` is deliberately below AA and is for non-text UI only; `--border-strong` exists for control boundaries that need 3:1 (WCAG 1.4.11).
- **State that is visual must also be programmatic**: `aria-pressed` on the mode tools and modality chips, `aria-expanded` on the metadata toggle, `aria-current` on the loaded study, `aria-selected` on listbox options. Where possible the CSS keys off the ARIA attribute so the two cannot drift.
- **Live regions are rationed.** Anything that updates continuously (the session countdown, upload percentages) stays out of them; the file count and one-off warnings are what get announced.
- **Every group is one tab stop** via `shared/roving.ts`, and every modal traps focus and restores it via `shared/dialog.ts`.
- Reflow below ~900px is **not** claimed: a three-pane DICOM viewer does not reflow to 320px.

## Multi-repo context

Sibling repos: `backend` (the API this proxies to — see the networking section above) and `desktop` (an Electron app built on a verbatim vendored copy of this repo's `src/` — see Desktop parity above).
