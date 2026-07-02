.PHONY: help install up down build logs ps restart clean test check

# ── Default ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  MICD web — available commands"
	@echo ""
	@echo "  make install     Install dependencies and create .env"
	@echo "  make up          Start the frontend container (backend stack must be up)"
	@echo "  make down        Stop and remove the container"
	@echo "  make build       Rebuild the Docker image"
	@echo "  make logs        Follow container logs"
	@echo "  make ps          Show container status"
	@echo "  make restart     Rebuild image and restart"
	@echo "  make test        Run frontend unit tests"
	@echo "  make check       Verify the frontend is serving"
	@echo "  make clean       Remove container and image"
	@echo ""

# ── Dependencies ──────────────────────────────────────────────────────────────
install:
	npm install
	@[ -f .env ] || (cp .env.example .env && echo ".env created from .env.example")

# ── Docker ────────────────────────────────────────────────────────────────────
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

ps:
	docker compose ps

restart: build up

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	npm test

check:
	@curl -sf -o /dev/null -w "GET http://localhost:$${FRONTEND_PORT:-80} → %{http_code}\n" http://localhost:$${FRONTEND_PORT:-80} || (echo "frontend not reachable" && exit 1)
	@curl -sf -o /dev/null -w "GET http://localhost:$${FRONTEND_PORT:-80}/api/health → %{http_code}\n" http://localhost:$${FRONTEND_PORT:-80}/api/health || echo "warning: /api proxy not reachable (is the MICD_BACKEND stack up?)"

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	docker compose down --rmi local
