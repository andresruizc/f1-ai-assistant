# Getting Started

> Last updated: 2025-02-16

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for the frontend)
- **uv** — fast Python package manager ([install](https://docs.astral.sh/uv/getting-started/installation/))

## Setup

### 1. Install dependencies

From the project root (`f1-ai-assistant/`):

```bash
# Python backend — creates .venv and installs everything
uv sync --all-extras

# Frontend
cd frontend && npm install
```

Or simply:

```bash
make init
```

### 2. Configure environment

Copy the example env file and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add at least one LLM API key:

```
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Download F1 data

Download race data for the 2025 season:

```bash
# See the schedule first
uv run f1-data-loader --info

# Download a single race to test
uv run f1-data-loader --round 1

# Download all 24 races (takes ~5-10 min first time)
uv run f1-data-loader
```

Data is cached in `data/.fastf1_cache/`. Subsequent runs are instant.

## Running the app

### Backend API

```bash
uv run f1-api
# or
make dev-api
```

The API starts at `http://localhost:8000`. OpenAPI docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend && npm run dev
# or
make dev-frontend
```

The frontend starts at `http://localhost:3000`.

### Docker (both services)

```bash
make docker-up    # build and start
make docker-down  # stop
```

## Development commands

| Command | What it does |
|---|---|
| `make init` | Install all dependencies (Python + Node) |
| `make dev-api` | Start FastAPI with hot reload |
| `make dev-frontend` | Start Next.js dev server |
| `make load-data` | Download all 2025 race data |
| `make test` | Run Python tests |
| `make format` | Format Python code (ruff) |
| `make lint` | Lint Python code (ruff) |
| `make docker-up` | Build and start all Docker services |
| `make docker-down` | Stop all Docker services |
| `make clean` | Remove cache files |

## CLI tools

Both are registered in `pyproject.toml` and available via `uv run`:

```bash
# F1 data loader
uv run f1-data-loader --help
uv run f1-data-loader --info
uv run f1-data-loader --round 5
uv run f1-data-loader --round 5 --inspect

# API server
uv run f1-api
```

## Project layout

See [docs/architecture/project-structure.md](../architecture/project-structure.md) for the full breakdown.
