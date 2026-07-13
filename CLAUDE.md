# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MICD web client — the browser-based DICOM viewer/study explorer. Plain TypeScript (no framework, no bundler — `tsc` compiles `src/*.ts` straight to `dist/*.js`, loaded via `<script type="module">`), served in production by nginx, which also reverse-proxies `/api/*` and `/auth/*` to the `backend` repo's API on the same origin.

## Critical networking requirement

This frontend never talks to Postgres/Orthanc directly — it only calls the backend's `/api/*` and `/auth/*` endpoints. The origin those calls target is resolved once in `src/auth.ts` (`API_ORIGIN`, re-used by `renderer.ts` via the exported `API_BASE`): it defaults to `http://localhost:3000` for local dev (page opened directly or served without nginx). For the Docker/nginx deployment, where the page is served same-origin and nginx reverse-proxies `/api` and `/auth` to `http://backend:3000` (see `nginx.conf`), set `window.MICD_API_ORIGIN = ""` before `auth.ts` loads to use the same-origin path. In Docker, this container joins an **external** network named `micd` that is created by the `backend` repo's `docker-compose.yml` — **the backend stack must be started first** (`make up` in `../backend`), or `docker compose up` here will fail with the network not existing.

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

There's no dev server with hot reload — iterate with `npm run build` and reload the page, or work against the Docker container.

## Architecture

- **`src/renderer.ts`** — single entry point, wires up all UI: local file/folder DICOM opening (`dicom-parser-util.ts` + `dicom-renderer.ts` for canvas rendering), the server-side study explorer (search/filter/paginate against `/api/v1/studies`), upload (drag-drop and file picker, XHR-based for progress reporting), and the auth UI (the promise-based login dialog `promptLogin()`, injected into auth.ts via `setLoginPrompt`; sidebar session state via `onAuthChange`). The app always starts — local viewing needs no session; only server-bound actions trigger the login popup.
- **`src/auth.ts`** — owns the session, DOM-free (unit-tested in `auth.test.ts` with stubbed `fetch`/`localStorage`): access token lives in a module-level variable only (never persisted — cleared on reload), refresh token lives in `localStorage` and is **rotated on every refresh**, which is why `refreshAccessToken()` is single-flight — parallel refreshes with the same token would race and log the session out. `ensureAuthenticated()` is the gate every server operation goes through: in-memory token → silent refresh → login popup (also single-flight, so N concurrent 401s never stack N dialogs). `authFetch()` wraps every protected fetch call: attaches `Authorization: Bearer`, and on a 401 escalates refresh → popup → one retry; if the user cancels, the caller gets the original 401. The XHR-based upload path can't use `authFetch`, so it pre-flights `ensureAuthenticated()` and does its own on-401 refresh + single retry. Study thumbnails are loaded via `authFetch` + `URL.createObjectURL` (not a plain `<img src>`) because `<img>` tags can't carry an Authorization header — see `loadThumbnails()`.
- **`src/index.html`** — the login screen (`#login-screen`) reuses the same `.dialog-overlay`/`.dialog` CSS pattern as the duplicate-upload confirmation dialog, rather than introducing new modal styling.
- **`src/dicom-parser-util.ts`** / **`src/dicom-renderer.ts`** — pure DICOM parsing (via the `dicom-parser` UMD bundle, loaded as a separate `<script>` before the compiled module) and canvas window/level/zoom/pan rendering. These are the files most likely to need porting in lockstep with the `desktop` repo's `frontend/src/` — the two are meant to stay near-identical.
- **Multi-repo context** — sibling repos `backend` (the API this proxies to) and `desktop` (an Electron app whose `frontend/src/` mirrors this repo's `src/` file-for-file, kept in sync by hand rather than a shared package).
