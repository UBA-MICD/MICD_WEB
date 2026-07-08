.PHONY: help install hooks up down build logs ps restart check test pre-commit clean

# ── Default ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  MICD web — available commands"
	@echo ""
	@echo "  make install     Install dependencies and create .env"
	@echo "  make hooks       Install pre-commit Git hooks"
	@echo "  make up          Start the frontend container (backend stack must be up)"
	@echo "  make down        Stop and remove the container"
	@echo "  make build       Rebuild the Docker image"
	@echo "  make logs        Follow container logs"
	@echo "  make ps          Show container status"
	@echo "  make restart     Rebuild image and restart"
	@echo "  make pre-commit  Run pre-commit checks manually"
	@echo "  make test        Run frontend unit tests"
	@echo "  make check       Verify the frontend is serving"
	@echo "  make clean       Remove container and image"
	@echo ""

# ── Dependencies ──────────────────────────────────────────────────────────────
install:
	npm install
	@[ -f .env ] || (cp .env.example .env && echo ".env created from .env.example")

hooks:
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit install; \
		echo "Git hooks installed successfully."; \
	else \
		echo "Error: 'pre-commit' is not installed. Please install it first."; \
		exit 1; \
	fi

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

# ── Tests and Checks ──────────────────────────────────────────────────────────
test:
	npm test

check:
	@curl -sf -o /dev/null -w "GET http://localhost:$${FRONTEND_PORT:-80} -> %{http_code}\n" http://localhost:$${FRONTEND_PORT:-80} || (echo "frontend not reachable" && exit 1)
	@curl -sf -o /dev/null -w "GET http://localhost:$${FRONTEND_PORT:-80}/api/health -> %{http_code}\n" http://localhost:$${FRONTEND_PORT:-80}/api/health || echo "warning: /api proxy not reachable (is the MICD_BACKEND stack up?)"

pre-commit:
	@if command -v pre-commit >/dev/null 2>&1; then \
		pre-commit run --all-files; \
	else \
		echo "Error: 'pre-commit' is not installed. Please install it first."; \
		exit 1; \
	fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	docker compose down --rmi local
