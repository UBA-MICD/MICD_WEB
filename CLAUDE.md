# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MICD web client — the browser-based DICOM viewer/study explorer. Plain TypeScript (no framework, no bundler — `tsc` compiles `src/*.ts` straight to `dist/*.js`, loaded via `<script type="module">`), served in production by nginx, which also reverse-proxies `/api/*` and `/auth/*` to the `backend` repo's API on the same origin.

## Critical networking requirement

This frontend never talks to Postgres/Orthanc directly — every `/api/*` and `/auth/*` call is same-origin and proxied by nginx to `http://backend:3000` (see `nginx.conf`). In Docker, this container joins an **external** network named `micd` that is created by the `backend` repo's `docker-compose.yml` — **the backend stack must be started first** (`make up` in `../backend`), or `docker compose up` here will fail with the network not existing.

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

- **`src/renderer.ts`** — single entry point, wires up all UI: local file/folder DICOM opening (`dicom-parser-util.ts` + `dicom-renderer.ts` for canvas rendering), the server-side study explorer (search/filter/paginate against `/api/v1/studies`), upload (drag-drop and file picker, XHR-based for progress reporting), and auth (login gate, silent refresh on load, logout).
- **`src/auth.ts`** — owns the session: access token lives in a module-level variable only (never persisted — cleared on reload), refresh token lives in `localStorage`. `authFetch()` is the wrapper used for every protected API call: it attaches `Authorization: Bearer`, and on a 401 does one silent `/auth/refresh` + retry before giving up. The XHR-based upload path can't use `authFetch`, so it calls `getAccessToken()` and sets the header manually before `send()`. Study thumbnails are loaded via `authFetch` + `URL.createObjectURL` (not a plain `<img src>`) because `<img>` tags can't carry an Authorization header — see `loadThumbnails()`.
- **`src/index.html`** — the login screen (`#login-screen`) reuses the same `.dialog-overlay`/`.dialog` CSS pattern as the duplicate-upload confirmation dialog, rather than introducing new modal styling.
- **`src/dicom-parser-util.ts`** / **`src/dicom-renderer.ts`** — pure DICOM parsing (via the `dicom-parser` UMD bundle, loaded as a separate `<script>` before the compiled module) and canvas window/level/zoom/pan rendering. These are the files most likely to need porting in lockstep with the `desktop` repo's `frontend/src/` — the two are meant to stay near-identical.
- **Multi-repo context** — sibling repos `backend` (the API this proxies to) and `desktop` (an Electron app whose `frontend/src/` mirrors this repo's `src/` file-for-file, kept in sync by hand rather than a shared package).
