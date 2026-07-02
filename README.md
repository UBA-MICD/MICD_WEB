# MICD_WEB

MICD web frontend — a TypeScript single-page DICOM viewer (window/level, zoom, pan, metadata, study explorer), served by **Nginx**, which also reverse-proxies `/api/*` to the MICD backend.

> Split out of [UBA-MICD/MICD_APP](https://github.com/UBA-MICD/MICD_APP). The API lives in [UBA-MICD/MICD_BACKEND](https://github.com/UBA-MICD/MICD_BACKEND); its Docker stack creates the shared network `micd` that this container joins — **start the backend stack first**.

## Project Structure

```
MICD_WEB/
├── src/
│   ├── index.html              # App shell
│   ├── styles.css              # Design system (CSS variables + components)
│   ├── renderer.ts             # App entry point (viewer + study explorer)
│   ├── dicom-parser-util.ts    # DICOM parsing (dicom-parser)
│   ├── dicom-renderer.ts       # Canvas rendering + viewport transforms
│   ├── folder-files.ts         # Local folder ingestion helpers
│   └── *.test.ts               # Unit tests (node:test)
├── Dockerfile                  # Multi-stage: builder (tsc) → runtime (nginx)
├── nginx.conf                  # SPA fallback + /api proxy → backend:3000
├── docker-compose.yml          # frontend service (joins external network 'micd')
├── Makefile                    # Dev commands
└── .env.example                # FRONTEND_PORT
```

## Quick Start

```bash
# 1. Start the backend stack first (creates the 'micd' Docker network)
#    → see UBA-MICD/MICD_BACKEND: make up

# 2. Then, in this repo:
make install    # npm install + create .env from .env.example
make up         # build & start nginx container on http://localhost
make check      # verify the SPA and the /api proxy respond
```

Open `http://localhost` (or `http://localhost:$FRONTEND_PORT`).

## Development

```bash
npm install
npm run build   # compile TypeScript to dist/
npm test        # unit tests (node --test)
```

The app calls the API through relative `/api` URLs, so in any deployment nginx (see `nginx.conf`) must proxy `/api/*` to the backend — locally that's the `backend:3000` service on the shared `micd` network.
