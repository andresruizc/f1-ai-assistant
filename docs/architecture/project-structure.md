# Project Structure

> Last updated: 2025-02-16

## Top-level layout

```
f1-ai-assistant/
├── src/                        # Python backend source code
│   ├── __init__.py
│   ├── data_loader.py          # F1DataLoader — download & explore race data
│   ├── race_state.py           # RaceState — queryable race state ("as of lap N")
│   ├── tools.py                # AI tool functions + OpenAI-format schemas
│   ├── agent.py                # LiteLLM conversation loop with tool-calling
│   ├── api/                    # FastAPI application
│   │   ├── main.py             # App entry point, CORS, lifespan, routes
│   │   ├── services.py         # RaceService singleton (session cache)
│   │   └── routes/
│   │       ├── race.py         # Race data endpoints (/api/race/*)
│   │       └── chat.py         # Chat/agent endpoint (/api/chat)
│   └── utils/
│       ├── config.py           # YAML + env var config loading
│       └── logger.py           # Loguru setup (console + file)
├── config/
│   └── settings.yaml           # Main configuration file
├── data/                       # Runtime data (gitignored, see data/README.md)
│   └── .fastf1_cache/          # FastF1 HTTP cache
├── frontend/                   # Next.js 14 application
│   ├── app/                    # App Router pages
│   ├── components/             # React components
│   ├── lib/                    # API client, types, utilities
│   └── package.json
├── tests/                      # Python tests
│   ├── conftest.py             # Shared fixtures
│   └── unit/
├── docs/                       # Project documentation
│   ├── architecture/           # System design docs (this file)
│   ├── guides/                 # How-to guides
│   └── changelog/              # What was built and when
├── deployment/
│   └── docker/
│       ├── docker-compose.yml  # API + Frontend + Qdrant
│       └── qdrant_storage/     # Qdrant data (gitignored)
├── logs/                       # Log files (gitignored)
├── scripts/                    # Utility scripts
├── .cursor/rules/              # Cursor AI rules for consistent coding
├── pyproject.toml              # Python project config + dependencies
├── Makefile                    # Developer task runner
├── Dockerfile                  # API backend Docker image
└── .env / .env.example         # Environment variables
```

## Design principles

### 1. `data/` is runtime-only, never committed

All data in `data/` is downloaded at runtime by FastF1. The `.fastf1_cache/` folder is gitignored. Each developer/machine downloads its own copy. This keeps the repo lightweight.

See `data/README.md` for the full breakdown.

### 2. `src/` is the single Python package

Everything importable lives under `src/`. The package is installed via `pyproject.toml` (`[tool.setuptools.packages.find]` includes `src*`). This means you import with:

```python
from src.data_loader import F1DataLoader
from src.race_state import RaceState
from src.utils.config import settings
```

### 3. `docs/` is the single source of documentation

- `architecture/` — evergreen design docs, updated as the system evolves
- `guides/` — task-oriented how-to docs
- `changelog/` — numbered entries documenting what was built and why

### 4. CLI entry points via `pyproject.toml`

Instead of running `python -m src.something`, we define named scripts:

```toml
[project.scripts]
f1-data-loader = "src.data_loader:main"
f1-api = "src.api.main:cli"
```

Run them with `uv run f1-data-loader` or `uv run f1-api`.

### 5. Config hierarchy

1. **`config/settings.yaml`** — defaults for everything (LLM model, cache path, API port, CORS)
2. **`.env`** — secrets and per-machine overrides (API keys, model overrides)
3. **Environment variables** — highest priority, set in Docker/CI

Loaded by `src/utils/config.py`. YAML is read first, then env vars override specific keys.
