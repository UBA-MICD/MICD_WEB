# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
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

COPY src/index.html /usr/share/nginx/html/index.html
COPY src/styles.css /usr/share/nginx/html/styles.css
COPY src/favicon.svg /usr/share/nginx/html/favicon.svg

# dicom-parser UMD bundle
COPY --from=deps /app/node_modules/dicom-parser/dist/dicomParser.min.js /usr/share/nginx/html/dicomParser.min.js

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
