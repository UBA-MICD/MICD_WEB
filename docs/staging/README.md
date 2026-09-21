# Staging deployment (web + edge)

This repo owns the **public entrypoint** for staging:

- `Dockerfile.staging` — static SPA (nginx) image, built on GitHub runners → GHCR.
- `Caddyfile` — the edge: automatic HTTPS + routing (`/api`,`/auth` → backend, `/` → web).
- `docker-compose.staging.yml` — `caddy` (ports 80/443) + `web` (internal); both on the shared
  `micd` network.
- `.env.staging.example` — copy to `.env.staging` **on the VPS** (`STAGING_DOMAIN`, `ACME_EMAIL`).
- `.github/workflows/deploy-to-staging.yml` — build+push to GHCR, SSH deploy, public HTTPS check.

Full design, the cross-repo picture, and the resume routemap live in the **`MICD_BACKEND`** repo:
`docs/staging-deployment/{spec,plan,tasks,routemap}.md`.

Quick facts:

- Domain: `dicomviewermed.online` (its DNS A record must point at the VPS before first deploy — ACME).
- The backend stack (postgres/orthanc/backend) is deployed from the `backend` repo, internal only.
- Deploy trigger: CI success on the `staging` branch. The VPS never builds — it only pulls from GHCR.
