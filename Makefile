SHELL := /bin/bash

.PHONY: help init test dev-api dev-frontend format lint docker-up docker-down clean load-data

help:
	@echo "F1 Race Engineer — Project Commands"
	@echo "  make init            # Sync venv + install all dependencies"
	@echo "  make test            # Run backend tests"
	@echo "  make dev-api         # Run FastAPI with hot reload"
	@echo "  make dev-frontend    # Run Next.js dev server"
	@echo "  make format          # Format Python code"
	@echo "  make lint            # Lint Python code"
	@echo "  make docker-up       # Build and start all services"
	@echo "  make docker-down     # Stop all services"
	@echo "  make clean           # Remove cache files"
	@echo "  make load-data       # Download all 2025 race data"
	@echo ""
	@echo "CLI commands (via uv run):"
	@echo "  uv run f1-data-loader --info         # Show 2025 schedule"
	@echo "  uv run f1-data-loader --round 1      # Download Round 1"
	@echo "  uv run f1-data-loader                # Download all races"
	@echo "  uv run f1-api                        # Start the API server"

init:
	uv sync --all-extras
	cd frontend && npm install

test:
	uv run pytest

dev-api:
	uv run f1-api

dev-frontend:
	cd frontend && npm run dev

format:
	uv run ruff format .
	uv run ruff check --select I --fix .

lint:
	uv run ruff check .

load-data:
	uv run f1-data-loader

docker-up:
	cd deployment/docker && docker compose up --build -d

docker-down:
	cd deployment/docker && docker compose down

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .ruff_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf htmlcov .coverage
