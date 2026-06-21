# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies using root package.json
COPY package*.json ./
RUN npm ci

# Copy all source files needed by Vite
COPY vite.config.ts postcss.config.mjs tailwind.config.ts ./
COPY tsconfig.renderer.json ./
COPY src/ ./src/

# Build only the renderer (React SPA)
RUN npx vite build

# ── Stage 2: Runtime (Nginx) ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx static files
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist/renderer /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
