# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Runtime (Nginx) ──────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json ./
RUN npm install

FROM nginx:1.27-alpine AS runtime

RUN rm -rf /usr/share/nginx/html/*

# JS compilado
COPY --from=builder /app/dist /usr/share/nginx/html

# index.html is assembled from src/html/ partials by `prebuild` (build-html.mjs),
# so take the builder's freshly-generated copy rather than the host's.
COPY --from=builder /app/src/index.html /usr/share/nginx/html/index.html
COPY src/styles.css /usr/share/nginx/html/styles.css
COPY src/favicon.svg /usr/share/nginx/html/favicon.svg

# Vendored, offline-safe assets: fonts are tracked in src/vendor/fonts; the
# fflate ESM bundle is generated from node_modules so its version always
# matches package.json (no more CDN-pinned drift).
COPY src/vendor /usr/share/nginx/html/vendor
COPY --from=deps /app/node_modules/fflate/esm/browser.js /usr/share/nginx/html/vendor/fflate.js

# dicom-parser UMD bundle
COPY --from=deps /app/node_modules/dicom-parser/dist/dicomParser.min.js /usr/share/nginx/html/dicomParser.min.js

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
