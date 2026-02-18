# F1 AI Race Engineer — Complete Build Specification

> **Purpose**: This document is the single source of truth for building the F1 AI Race Engineer application. It contains every architectural decision, data format, edge case, algorithm, UI detail, and infrastructure setup needed to build the project from scratch.

---

## Table of Contents

1. [Concept](#1-concept)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Development Setup](#4-development-setup)
5. [Configuration — YAML + Environment Variables](#5-configuration--yaml--environment-variables)
6. [FastF1 Data — What It Gives You](#6-fastf1-data--what-it-gives-you)
7. [Race State Processing — `race_state.py`](#7-race-state-processing--race_statepy)
8. [AI Tool Definitions — `tools.py`](#8-ai-tool-definitions--toolspy)
9. [AI Agent — `agent.py`](#9-ai-agent--agentpy)
10. [FastAPI Backend](#10-fastapi-backend)
11. [Next.js Frontend](#11-nextjs-frontend)
12. [Key Algorithms and Logic](#12-key-algorithms-and-logic)
13. [FastF1 Gotchas and Edge Cases](#13-fastf1-gotchas-and-edge-cases)
14. [Docker](#14-docker)
15. [Testing](#15-testing)
16. [CI/CD Pipeline](#16-cicd-pipeline)
17. [Git Workflow and Conventions](#17-git-workflow-and-conventions)
18. [Coding Conventions](#18-coding-conventions)
19. [Documentation](#19-documentation)
20. [Implementation Order](#20-implementation-order)
21. [Example Conversations](#21-example-conversations)
22. [Project Setup Checklist](#22-project-setup-checklist)

---

## 1. Concept

Build a web app where the user selects an F1 race and a driver. The app loads real historical race data and presents a lap-by-lap view of the race. The user can advance through the race lap by lap. At any point, they can ask questions in a chat interface as if talking to their driver's race engineer on the pit wall.

An AI agent answers using tool-calling — it queries the actual race data (standings, tyre strategy, pace, gaps, weather, track status) and responds with data-backed strategic advice. The AI only has access to data up to the current lap, so it genuinely feels like the race is unfolding live.

---

## 2. Tech Stack

### Core Application

| Component | Technology | Why |
|---|---|---|
| Race data | `fastf1` | Official F1 timing data — lap times, telemetry, tyre compounds, weather, track status, positions. Free, well-documented |
| AI agent | `litellm` | Multi-provider LLM gateway. Supports OpenAI, Anthropic, Google, Groq, etc. with a unified API. Switch models without changing code |
| Backend API | `FastAPI` + `uvicorn` | Async Python API framework. Serves race data + AI agent endpoints. Auto-generated OpenAPI docs, native async, CORS middleware |
| Frontend | `Next.js 14` (App Router) | React framework with server components, built-in routing, and optimized production builds. Tailwind CSS + shadcn/ui for styling |
| Charts | `recharts` or `plotly.js` | Interactive race position charts, lap time graphs, gap evolution (rendered in the browser) |
| Data processing | `pandas`, `numpy` | FastF1 returns pandas DataFrames. All race state derivation is DataFrame operations |

### Development Tooling

| Tool | Purpose | Why |
|---|---|---|
| `uv` | Python package manager | 10–100x faster than pip, written in Rust. Handles venv creation, dependency resolution, and installation |
| `ruff` | Linting + formatting | Replaces flake8, isort, and black in a single tool. Extremely fast |
| `pytest` | Testing | Standard Python testing with async support, coverage, and fixtures |
| `loguru` | Logging | Simple, structured logging with zero configuration |
| `Docker` + `docker-compose` | Containerization | Reproducible builds, multi-service orchestration (API + Frontend) |
| `Make` | Task runner | Consistent commands across the project via `Makefile` |

---

## 3. Project Structure

```
f1-race-engineer/
├── src/                            # Python backend source code
│   ├── __init__.py
│   ├── api/                        # FastAPI application
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app, CORS, routes, lifespan
│   │   ├── routes/                 # API route handlers
│   │   │   ├── __init__.py
│   │   │   ├── race.py             # Race data endpoints (load, standings, laps)
│   │   │   └── chat.py             # Chat/agent endpoint (POST /chat)
│   │   └── services.py             # Shared singletons (race state cache)
│   ├── race_state.py               # Loads FastF1 session, derives queryable race state
│   ├── tools.py                    # Tool functions the AI calls + tool schemas
│   ├── agent.py                    # LiteLLM tool-calling conversation loop
│   └── utils/                      # Shared utilities
│       ├── __init__.py
│       ├── config.py               # Configuration loading (YAML + env vars)
│       └── logger.py               # Logging setup (loguru)
├── config/                         # Configuration files
│   └── settings.yaml               # Main config (LLM, API, retrieval settings)
├── frontend/                       # Next.js 14 frontend
│   ├── app/                        # App Router pages
│   │   ├── page.tsx                # Main page — race view + chat
│   │   ├── layout.tsx              # Root layout
│   │   └── globals.css             # Global styles (Tailwind)
│   ├── components/                 # React components
│   │   ├── ui/                     # Base UI components (shadcn/ui)
│   │   │   ├── button.tsx
│   │   │   ├── select.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── badge.tsx
│   │   │   └── ...
│   │   ├── RaceSelector.tsx        # Year/Race/Driver dropdowns + Load button
│   │   ├── LapControls.tsx         # Lap slider + auto-play toggle
│   │   ├── StandingsTable.tsx      # Current lap standings with tyre indicators
│   │   ├── PositionChart.tsx       # Position-over-laps chart (recharts/plotly)
│   │   ├── ChatInterface.tsx       # Chat input + message history
│   │   ├── TrackStatusBadge.tsx    # Green/Yellow/SC/Red flag indicator
│   │   └── WeatherInfo.tsx         # Current weather display
│   ├── lib/                        # Frontend utilities
│   │   ├── api.ts                  # API client (fetch wrappers to backend)
│   │   ├── types.ts                # TypeScript types matching backend responses
│   │   └── utils.ts                # General utilities
│   ├── public/                     # Static assets
│   ├── Dockerfile                  # Multi-stage build for production
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── components.json             # shadcn/ui config
├── tests/                          # Python backend tests
│   ├── __init__.py
│   ├── conftest.py                 # Pytest config and shared fixtures
│   ├── unit/                       # Unit tests
│   │   ├── __init__.py
│   │   ├── test_race_state.py
│   │   ├── test_tools.py
│   │   └── test_agent.py
│   └── integration/                # Integration tests
│       ├── __init__.py
│       └── test_api.py
├── docs/                           # Documentation
│   ├── ARCHITECTURE.md             # System architecture overview
│   ├── QUICKSTART.md               # Getting started guide
│   ├── API.md                      # API endpoint reference
│   └── FASTF1_REFERENCE.md        # FastF1 data format reference
├── scripts/                        # Utility scripts
│   └── test_race_load.py           # Verify FastF1 data loading works
├── deployment/                     # Deployment artifacts
│   └── docker/
│       └── docker-compose.yml      # Multi-service orchestration
├── data/                           # Runtime data (gitignored)
│   └── .fastf1_cache/              # FastF1 HTTP response cache
├── logs/                           # Application logs (gitignored)
│   └── .gitkeep
├── .github/                        # GitHub Actions CI/CD
│   └── workflows/
│       └── ci.yml                  # Test + Docker build pipeline
├── pyproject.toml                  # Python project config, dependencies, tool settings
├── Dockerfile                      # API backend Docker build
├── Makefile                        # Common project commands
├── .env.example                    # Environment variable template
├── .env                            # Actual env vars (gitignored)
├── .gitignore                      # Git ignore rules
├── LICENSE                         # License file
└── README.md                       # Project README
```

### Naming Conventions

- **Directories**: `snake_case` (e.g., `race_state/`, `src/utils/`)
- **Python files**: `snake_case.py` (e.g., `race_state.py`, `config.py`)
- **TypeScript files**: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- **Test files**: `test_*.py` (e.g., `test_race_state.py`, `test_tools.py`)

### Special Files

- **`.gitkeep`**: Preserve empty directories in git
  ```bash
  touch logs/.gitkeep
  touch data/.gitkeep
  ```

---

## 4. Development Setup

### 4.1 Package Management with UV

`uv` is an extremely fast Python package manager written in Rust (10–100x faster than pip).

**Installation:**

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# macOS via Homebrew
brew install uv
```

**Standard commands:**

```bash
# Create virtual environment
uv venv

# Activate virtual environment
source .venv/bin/activate  # macOS/Linux

# Install all dependencies (including dev)
uv pip install -e ".[dev]"

# Install a new package
uv pip install package-name

# Run a script within the venv
uv run python scripts/test_race_load.py

# Run the API server
uv run uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

**Best practices:**
1. Always use `uv pip` instead of `pip`
2. Create venvs with `uv venv` (faster than `python -m venv`)
3. Use `uv run` to execute scripts (ensures correct environment)
4. Keep `pyproject.toml` updated with all dependencies

### 4.2 `pyproject.toml`

All project metadata, dependencies, and tool configuration in a single file:

```toml
[build-system]
requires = ["setuptools>=65.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "f1-race-engineer"
version = "0.1.0"
description = "AI-powered F1 race engineer with real historical data"
readme = "README.md"
requires-python = ">=3.11"
license = {text = "MIT"}

dependencies = [
    # F1 Data
    "fastf1>=3.3.0",
    # LLM Gateway (multi-provider)
    "litellm>=1.0.0",
    "openai>=1.0.0",
    # API Framework
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    # Data processing
    "pandas>=2.0.0",
    "numpy>=1.24.0",
    # Configuration
    "pyyaml>=6.0.1",
    "python-dotenv>=1.0.0",
    "pydantic>=2.5.0",
    "pydantic-settings>=2.1.0",
    # Utilities
    "loguru>=0.7.2",
    "httpx>=0.26.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
    "pytest-cov>=4.1.0",
    "ruff>=0.1.0",
    "mypy>=1.8.0",
]

[tool.setuptools]
package-dir = {"" = "."}

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[tool.ruff]
line-length = 100
target-version = "py311"
select = ["E", "W", "F", "I", "B", "UP"]
ignore = ["E501"]

[tool.ruff.format]
quote-style = "double"

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
asyncio_mode = "auto"
addopts = [
    "-v",
    "--strict-markers",
    "--tb=short",
    "--cov=src",
    "--cov-report=term-missing",
]
markers = [
    "unit: Unit tests",
    "integration: Integration tests (require FastF1 data)",
    "slow: Slow running tests (data loading)",
]
```

### 4.3 Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Run dev server (with hot reload)
npm run dev

# Build for production
npm run build
```

Key frontend dependencies (`package.json`):

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "recharts": "^2.10.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.0.0"
  }
}
```

### 4.4 Makefile

Centralize common project commands:

```makefile
SHELL := /bin/bash

.PHONY: help init test dev-api dev-frontend format lint docker-up docker-down clean

help:
	@echo "F1 Race Engineer — Project Commands"
	@echo "  make init            # Create venv + install all dependencies"
	@echo "  make test            # Run backend tests"
	@echo "  make dev-api         # Run FastAPI with hot reload"
	@echo "  make dev-frontend    # Run Next.js dev server"
	@echo "  make format          # Format Python code"
	@echo "  make lint            # Lint Python code"
	@echo "  make docker-up       # Build and start all services"
	@echo "  make docker-down     # Stop all services"
	@echo "  make clean           # Remove cache files"

init:
	uv venv || true
	uv pip install -e ".[dev]"
	cd frontend && npm install

test:
	uv run pytest

dev-api:
	uv run uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload

dev-frontend:
	cd frontend && npm run dev

format:
	uv run ruff format .
	uv run ruff check --select I --fix .

lint:
	uv run ruff check .

docker-up:
	cd deployment/docker && docker compose up --build -d

docker-down:
	cd deployment/docker && docker compose down

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .ruff_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf htmlcov .coverage
```

**Development workflow**: Run `make dev-api` and `make dev-frontend` in separate terminals. The frontend (port 3000) talks to the API (port 8000).

---

## 5. Configuration — YAML + Environment Variables

### 5.1 Architecture

Configuration follows a two-layer model:

1. **`config/settings.yaml`** — All application settings (committed to git, safe defaults)
2. **`.env`** — Secrets and overrides (gitignored, never committed)

**Priority**: Environment variables override YAML values.

### 5.2 `config/settings.yaml`

```yaml
# Application
app:
  name: "F1 AI Race Engineer"
  version: "0.1.0"
  debug: false

# LLM Configuration (via LiteLLM)
llm:
  provider: "openai"          # Supports: openai, anthropic, google, groq, cohere, mistral
  model: "gpt-4o-mini"        # Model name (LiteLLM format)
  temperature: 0.3
  max_tokens: 2048

# FastF1
fastf1:
  cache_dir: "data/.fastf1_cache"
  min_year: 2018               # FastF1 has good data from ~2018+
  max_year: 2025

# API
api:
  host: "0.0.0.0"
  port: 8000
  cors_origins:
    - "http://localhost:3000"     # Next.js dev server
    - "http://localhost:3001"
    - "http://127.0.0.1:3000"
    # For Docker:
    - "http://frontend:3000"
    # NOTE: For production, override via API__CORS_ORIGINS env var

# Logging
logging:
  level: "INFO"
```

### 5.3 Loading Configuration in Python

```python
# src/utils/config.py
import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

load_dotenv()


def load_settings(yaml_path: Path = Path("config/settings.yaml")) -> dict[str, Any]:
    """Load settings from YAML file with env var overrides."""
    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)

    # Environment variable overrides (secrets + dynamic config)
    if os.getenv("LLM_MODEL"):
        config["llm"]["model"] = os.getenv("LLM_MODEL")
    if os.getenv("LLM_PROVIDER"):
        config["llm"]["provider"] = os.getenv("LLM_PROVIDER")
    if os.getenv("API__CORS_ORIGINS"):
        cors_str = os.getenv("API__CORS_ORIGINS")
        config["api"]["cors_origins"] = [o.strip() for o in cors_str.split(",")]

    return config


# API keys — always from env vars, never in YAML
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

settings = load_settings()
```

### 5.4 `.env.example`

Committed to git as a template:

```bash
# =============================================================================
# LLM API Keys (at least one required — depends on provider in settings.yaml)
# =============================================================================
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_API_KEY=...
# GROQ_API_KEY=...

# =============================================================================
# Optional Overrides (defaults are in config/settings.yaml)
# =============================================================================
# LLM_PROVIDER=openai
# LLM_MODEL=gpt-4o-mini
# API__CORS_ORIGINS=http://localhost:3000,http://localhost:3001
# LOG_LEVEL=INFO
```

### 5.5 Frontend Environment Variables

**Build-time** (prefixed with `NEXT_PUBLIC_`, baked into the JS bundle):

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**In Docker Compose** — passed as build args:

```yaml
frontend:
  build:
    args:
      NEXT_PUBLIC_API_URL: http://localhost:8000
  environment:
    - NEXT_PUBLIC_ENV=docker
```

---

## 6. FastF1 Data — What It Gives You

When you load a race session, FastF1 provides several key data structures. Understanding these is critical.

### 6.1 Loading a Session

```python
import fastf1
fastf1.Cache.enable_cache('data/.fastf1_cache')  # cache HTTP responses locally
session = fastf1.get_session(year, round_number, 'R')  # 'R' = Race, 'Q' = Qualifying, 'S' = Sprint
session.load()  # downloads + parses all data
```

> **Note**: The `session.load()` call is slow (10–30 seconds first time, cached after). Plan for a loading state in the UI.

### 6.2 The Laps DataFrame — `session.laps`

This is the single most important data source. It is a pandas DataFrame where each row is one lap by one driver.

**Key columns:**

| Column | Type | Description |
|---|---|---|
| `Driver` | `str` | Three-letter code: `"VER"`, `"HAM"`, `"NOR"`, etc. |
| `DriverNumber` | `str` | Car number as string: `"1"`, `"44"`, `"4"` |
| `LapNumber` | `int` | 1-indexed lap number |
| `LapTime` | `pd.Timedelta` or `NaT` | Total lap time. `NaT` if lap wasn't completed (pit in-lap, retirement, etc.) |
| `Sector1Time` | `pd.Timedelta` or `NaT` | Sector 1 time |
| `Sector2Time` | `pd.Timedelta` or `NaT` | Sector 2 time |
| `Sector3Time` | `pd.Timedelta` or `NaT` | Sector 3 time |
| `Compound` | `str` | Tyre compound: `"SOFT"`, `"MEDIUM"`, `"HARD"`, `"INTERMEDIATE"`, `"WET"` |
| `TyreLife` | `float` | Number of laps on current set of tyres (carries over from qualifying if not changed) |
| `Position` | `float` | Track position at end of this lap (`1` = leader). Can be `NaN` |
| `TrackStatus` | `str` | Track status code during the lap |
| `IsPersonalBest` | `bool` | Whether this was the driver's fastest lap so far |
| `Time` | `pd.Timedelta` | Session timestamp when the lap was completed (time since session start) |
| `PitInTime` | `pd.Timedelta` or `NaT` | Timestamp when driver entered pit lane (`NaT` if no pit) |
| `PitOutTime` | `pd.Timedelta` or `NaT` | Timestamp when driver exited pit lane (`NaT` if no pit) |
| `Stint` | `int` | Stint number (`1` = first stint, increments at each pit stop) |
| `FreshTyre` | `bool` | Whether the tyre set was new (not used in previous sessions) |

> **Critical gotcha**: Many fields can be `NaT` (Not a Time) or `NaN`. Always check with `pd.notna()` before using values. Lap 1 often has an abnormally long `LapTime` because it includes the grid-to-line time.

### 6.3 Session Results — `session.results`

DataFrame with final classification.

**Key columns:**

| Column | Description |
|---|---|
| `Abbreviation` | Three-letter driver code |
| `FullName` | Full driver name |
| `TeamName` | Team name |
| `Position` | Final finishing position |
| `Status` | `"Finished"`, `"+1 Lap"`, `"Retired"`, `"Collision"`, etc. |
| `Points` | Points scored |
| `GridPosition` | Starting grid position |

### 6.4 Weather Data — `session.weather_data`

DataFrame with weather samples throughout the session:

| Column | Description |
|---|---|
| `Time` | `pd.Timedelta` — session timestamp |
| `AirTemp` | Air temperature in °C |
| `TrackTemp` | Track temperature in °C |
| `Humidity` | Humidity percentage |
| `WindSpeed` | Wind speed in m/s |
| `WindDirection` | Wind direction in degrees |
| `Rainfall` | Boolean or `0`/`1` — whether rain is falling |

> **Note**: Weather is sampled irregularly (roughly every few seconds). For lap-level queries, find the weather sample closest to each lap's completion time.

### 6.5 Track Status — `session.track_status`

DataFrame of track status changes:

| Column | Description |
|---|---|
| `Time` | `pd.Timedelta` — when the status changed |
| `Status` | Status code string |
| `Message` | Human-readable message |

**Status codes** (these are strings, not integers):

| Code | Meaning |
|---|---|
| `"1"` | Green / All Clear |
| `"2"` | Yellow Flag |
| `"4"` | Safety Car |
| `"5"` | Red Flag |
| `"6"` | Virtual Safety Car Deployed |
| `"7"` | VSC Ending |

### 6.6 Driver Colors

FastF1 provides official team colors for each driver:

```python
color_map = fastf1.plotting.get_driver_color_mapping(session)
# Returns: {"VER": "#3671C6", "HAM": "#27F4D2", ...}
```

Useful for charts.

### 6.7 Circuit Info

```python
circuit_info = session.get_circuit_info()
# circuit_info.corners — corner numbers and positions
# circuit_info.rotation — suggested rotation angle for display
```

---

## 7. Race State Processing — `race_state.py`

This module loads a FastF1 session and builds a structured, queryable representation of the race.

**Core design principle**: Everything is queryable "as of lap N" — you filter the laps DataFrame to `LapNumber <= current_lap` before answering any question. This creates the feeling of a developing race.

### 7.1 Data to Derive

From the raw laps DataFrame, derive these higher-level structures:

#### A. Standings as of Lap N

- Filter laps to `LapNumber == N`
- Sort by `Position` column
- For each driver: position, tyre compound, tyre age, last lap time

#### B. Lap Times per Driver

- Filter laps for a specific driver, up to lap N
- Convert `LapTime` timedelta to seconds (`.total_seconds()`)
- Skip `NaT` values (incomplete laps)
- Lap 1 is typically an outlier — flag it or exclude it from pace analysis

#### C. Pit Stop Detection

- Use the `Stint` column — when a driver's stint number increases, they pitted
- Alternatively, look for rows where `PitInTime` is not `NaT`
- For each pit stop, record:
  - Lap number
  - Compound before (stint N)
  - Compound after (stint N+1)
  - Approximate pit stop duration (difference between `PitOutTime` of next stint and `PitInTime` of this stint)

#### D. Stint Summary

- Group each driver's laps by `Stint` column
- For each stint: compound, start lap, end lap, number of laps, average lap time (excluding lap 1 and in/out laps), best lap time

#### E. Tyre Degradation Within a Stint

- For a specific driver and stint, take the lap times and tyre life values
- Exclude outlier laps (safety car laps, pit in/out laps — identified by abnormally slow times or `NaT` sectors)
- Compute the trend: is lap time increasing as tyre life increases? By how much per lap?
- Simple approach: linear regression of `lap_time_seconds` vs `tyre_life`. The slope is the degradation rate in seconds per lap

#### F. Gaps Between Drivers

- For each lap N, compute the cumulative race time for each driver: sum of all `LapTime` values from lap 1 to N (skipping `NaT`)
- Gap between two drivers = difference in cumulative race times
- If a driver is a lap behind (lapped), note this separately
- Track whether the gap is increasing or decreasing over the last few laps

#### G. Position Changes / Overtakes

- Compare each driver's `Position` at lap N vs lap N-1
- If position improved (number decreased), they overtook someone
- If position worsened, they were overtaken
- Record: lap, driver who gained, driver who lost

#### H. Track Status per Lap

- Map track status changes to lap numbers
- For each lap, determine if it was run under green, safety car, VSC, yellow, or red flag
- Use the `Time` column from track status and lap completion times to map them

#### I. Weather per Lap

- For each lap's completion `Time`, find the closest weather data sample
- Attach air temp, track temp, humidity, rainfall status to each lap
- Track trends: is track temp rising or falling? Is rain starting/stopping?

### 7.2 The `RaceState` Class

Design a class that holds all processed data and exposes query methods. **Every query method must accept an `as_of_lap` parameter** that filters the data to only include information up to that lap.

**Required methods:**

| Method | Description |
|---|---|
| `get_standings(as_of_lap)` | Current positions with driver, team, tyre, gap to leader |
| `get_driver_info(driver_code, as_of_lap)` | Position, current tyre, stint info, recent pace |
| `get_lap_times(driver_code, as_of_lap, last_n=None)` | Lap time history |
| `get_pit_stops(driver_code, as_of_lap)` | List of pit stops so far |
| `get_stints(driver_code, as_of_lap)` | Stint breakdown |
| `get_tyre_degradation(driver_code, as_of_lap)` | Degradation rate for current stint |
| `get_gap_to_driver(driver_a, driver_b, as_of_lap)` | Current gap + trend |
| `get_track_status(as_of_lap)` | Current flag state + history of status changes |
| `get_weather(as_of_lap)` | Current weather conditions + trends |
| `get_race_summary(as_of_lap)` | Key events so far (pit stops, SCs, overtakes, retirements) |
| `get_strategy_options(driver_code, as_of_lap)` | Available compounds, estimated stint lengths, when competitors might pit |
| `get_position_history(driver_code, as_of_lap)` | Position at each lap (for charts) |

**Metadata to store**: event name, circuit name, country, year, total laps, list of all drivers with team names.

**All methods should return JSON-serializable dicts/lists** (not DataFrames) since their output goes over the API to the frontend.

---

## 8. AI Tool Definitions — `tools.py`

Each tool is a Python function that calls the corresponding `RaceState` method, plus a tool schema (JSON) that describes the function for the model.

### 8.1 Tool List

#### Tool 1: `get_race_standings`

- **Parameters**: none (always uses current lap)
- **Returns**: formatted standings table — P1–P20 with driver, team, tyre compound, tyre age (laps), gap to leader in seconds, last lap time
- **When to use**: "What's the current order?", "Who's leading?", "Where am I?"

#### Tool 2: `get_driver_info`

- **Parameters**: `driver_code` (string, e.g. `"NOR"`)
- **Returns**: position, team, current tyre compound, tyre age, current stint number, total pit stops, last 3 lap times, best lap time, grid position (where they started)
- **When to use**: "How's Verstappen doing?", "What tyre is Hamilton on?"

#### Tool 3: `get_lap_times`

- **Parameters**: `driver_code` (string), `last_n_laps` (optional int, default 5)
- **Returns**: list of recent lap times with lap numbers, average pace, best lap
- **When to use**: "What's my pace?", "Am I faster than last stint?"

#### Tool 4: `get_pit_stop_history`

- **Parameters**: `driver_code` (string)
- **Returns**: list of pit stops — lap number, old compound, new compound, approximate pit time
- **When to use**: "When did Leclerc pit?", "How many stops has Verstappen made?"

#### Tool 5: `get_tyre_strategy`

- **Parameters**: `driver_code` (string)
- **Returns**: all stints — compound, start lap, end lap (or "current"), lap count, average pace, degradation rate (seconds per lap)
- **When to use**: "How are my tyres?", "What's the deg like?", "Should we pit?"

#### Tool 6: `get_gap_between_drivers`

- **Parameters**: `driver_a` (string), `driver_b` (string), `last_n_laps` (optional int for trend)
- **Returns**: current gap in seconds, who's ahead, trend over last N laps (increasing/decreasing/stable), rate of change per lap
- **When to use**: "What's the gap to Verstappen?", "Is Hamilton catching me?", "DRS range?"

#### Tool 7: `get_track_status`

- **Parameters**: none
- **Returns**: current track status (green/SC/VSC/yellow/red), history of status changes with lap numbers
- **When to use**: "Any safety cars?", "What flags have we had?"

#### Tool 8: `get_weather_conditions`

- **Parameters**: none
- **Returns**: current air temp, track temp, humidity, wind speed/direction, rainfall status, trend (temps rising/falling, rain approaching/clearing)
- **When to use**: "Is rain coming?", "What's the track temp?", "Should we go to inters?"

#### Tool 9: `get_race_summary`

- **Parameters**: none
- **Returns**: key events so far — notable overtakes, pit stops, safety cars, retirements, position changes from grid
- **When to use**: "What's happened so far?", "Catch me up", "Any DNFs?"

#### Tool 10: `compare_drivers`

- **Parameters**: `driver_a` (string), `driver_b` (string)
- **Returns**: head-to-head comparison — position, tyre compound/age, average pace (last 5 laps), stint history, gap, gap trend
- **When to use**: "Compare me to Verstappen", "Who's faster, me or Piastri?"

### 8.2 Tool Schema Format

Each tool needs to be defined as a JSON object for the LLM API (LiteLLM uses the OpenAI format):

```python
{
    "type": "function",
    "function": {
        "name": "get_gap_between_drivers",
        "description": "Get the time gap between two drivers and whether it's increasing or decreasing. Use this when asked about gaps, intervals, DRS range, or whether a driver is catching/pulling away.",
        "parameters": {
            "type": "object",
            "properties": {
                "driver_a": {
                    "type": "string",
                    "description": "Three-letter driver code, e.g. 'VER', 'HAM', 'NOR'"
                },
                "driver_b": {
                    "type": "string",
                    "description": "Three-letter driver code for the second driver"
                },
                "last_n_laps": {
                    "type": "integer",
                    "description": "Number of recent laps to compute gap trend over. Default 5."
                }
            },
            "required": ["driver_a", "driver_b"]
        }
    }
}
```

> **Important**: The `description` fields are crucial — they tell the model WHEN to use each tool. Make them specific and include example question patterns.

### 8.3 Tool Return Format

Return results as **formatted strings, not raw data structures**. The model works better with human-readable text.

**Example output:**

```
Gap: NOR is 2.3s behind VER
Trend (last 5 laps): Gap DECREASING by 0.4s/lap
NOR will be within DRS range (~1.0s) in approximately 3 laps at current pace
```

---

## 9. AI Agent — `agent.py`

### 9.1 LiteLLM — Multi-Provider LLM Gateway

Instead of using the OpenAI SDK directly, use **LiteLLM** as a unified gateway. This lets you switch between providers (OpenAI, Anthropic, Google, Groq, etc.) by changing a single config value — no code changes.

```python
import litellm

# LiteLLM uses the same interface for all providers
response = litellm.completion(
    model="gpt-4o-mini",           # or "anthropic/claude-3-haiku", "groq/llama3-8b"
    messages=messages,
    tools=tool_definitions,
    temperature=0.3,
)
```

**Provider setup** — LiteLLM auto-detects the provider from the model name. Set the appropriate API key as an env var:

| Provider | Model format | Env var |
|---|---|---|
| OpenAI | `gpt-4o`, `gpt-4o-mini` | `OPENAI_API_KEY` |
| Anthropic | `anthropic/claude-3-haiku-20240307` | `ANTHROPIC_API_KEY` |
| Google | `gemini/gemini-pro` | `GOOGLE_API_KEY` |
| Groq | `groq/llama3-8b-8192` | `GROQ_API_KEY` |

**Configuration** — The model is read from `config/settings.yaml`:

```python
from src.utils.config import settings

model = settings["llm"]["model"]       # e.g. "gpt-4o-mini"
temperature = settings["llm"]["temperature"]  # e.g. 0.3
```

### 9.2 System Prompt

This is the most important piece for the AI's personality and behavior:

```text
You are an F1 race engineer on the pit wall during a live race. You are the race engineer for {driver_name} ({driver_code}), driving for {team_name}.

Your job is to provide strategic advice, answer questions about the race, and proactively identify threats and opportunities. You speak directly to your driver and the strategy team.

Communication style:
- Be concise and direct, like a real race engineer on the radio
- Use driver codes (VER, HAM, NOR) not full names in technical discussion
- Back up every recommendation with data from your tools
- When uncertain, say so — never fabricate data
- Use "we" when talking about your driver's strategy ("we should pit", "our pace is good")
- Use "P" notation for positions (P1, P2, P3...)

When discussing strategy, ALWAYS consider these factors:
1. Current tyre state — compound, age, degradation trend
2. Gap to car ahead and behind — is it growing or shrinking?
3. Track position — will we lose/gain places by pitting now?
4. Competitors' likely strategy — when might they pit?
5. Weather conditions and trends
6. Track status — safety car periods are strategic opportunities
7. DRS — is the car behind within 1 second?

Race context:
- Total race laps: {total_laps}
- Circuit: {circuit_name}, {country}
- Current lap: provided with each question

Important rules:
- Only reference data up to the current lap — you don't know the future
- If asked about something you don't have data for, use your tools first
- A pit stop typically costs 20-25 seconds (pit lane time loss)
- DRS activation zone: gap must be under 1.0 seconds at the detection point
- Tyre compounds ranked softest to hardest: SOFT → MEDIUM → HARD
- Soft tyres are fastest but degrade quickest, hard tyres are slowest but most durable
- Intermediates are for light rain, full wets for heavy rain
```

### 9.3 Conversation Loop

The agent loop follows the standard tool-calling pattern (LiteLLM uses the same interface as OpenAI):

1. Maintain a conversation history (list of messages)
2. User sends a message → append to history with role `"user"`
3. Call `litellm.completion()` with the full history + tool definitions
4. If the response contains tool calls:
   - Execute each tool function locally
   - Append the tool results to the conversation
   - Call the API again (it will now synthesize a final answer)
5. If the response is a regular message, return it
6. The model may call multiple tools in one turn — handle all of them

**Temperature**: Low (0.3–0.5) for factual, data-grounded responses.

### 9.4 Injecting the Current Lap

Before every user message, prepend context about the current race state:

```text
[Race Update — Lap {current_lap}/{total_laps}]
```

This ensures the model and tools always know what lap to query. The `as_of_lap` parameter flows from this.

---

## 10. FastAPI Backend

### 10.1 Application Setup — `src/api/main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.utils.config import settings
from src.api.routes import race, chat

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events."""
    # Startup: initialize FastF1 cache, etc.
    yield
    # Shutdown: cleanup

app = FastAPI(
    title="F1 AI Race Engineer API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings["api"]["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(race.router, prefix="/api/race", tags=["race"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])

@app.get("/health")
async def health():
    return {"status": "ok"}
```

### 10.2 CORS Configuration

CORS is critical because the frontend (Next.js, port 3000) and backend (FastAPI, port 8000) run on different origins.

**How it works:**
- `settings.yaml` defines default allowed origins for local dev
- The `API__CORS_ORIGINS` env var overrides them for production/Docker
- The `CORSMiddleware` reads from `settings["api"]["cors_origins"]`

**Common CORS issues:**
- Forgetting to add the frontend's origin → browser blocks all API calls
- Using `"*"` in production → security risk. Always list specific origins
- Forgetting Docker service names → `http://frontend:3000` for inter-container communication

### 10.3 API Endpoints

#### Race Data Routes — `src/api/routes/race.py`

```python
from fastapi import APIRouter, HTTPException
router = APIRouter()

@router.get("/schedules/{year}")
async def get_schedule(year: int):
    """Return list of races for a given year."""
    # Returns: [{"round": 1, "name": "Bahrain GP", "country": "Bahrain"}, ...]

@router.post("/load")
async def load_race(year: int, round_number: int):
    """Load a race session from FastF1. Returns session metadata."""
    # Slow on first load (~10-30s), cached after.
    # Returns: {"total_laps": 52, "circuit": "Silverstone", "drivers": [...]}

@router.get("/standings")
async def get_standings(lap: int):
    """Get race standings as of a specific lap."""
    # Returns: [{"position": 1, "driver": "VER", "team": "Red Bull", ...}, ...]

@router.get("/position-history")
async def get_position_history(lap: int):
    """Get position history for all drivers up to a specific lap (for charts)."""
    # Returns: {"VER": [1, 1, 1, ...], "NOR": [4, 3, 3, ...], ...}

@router.get("/track-status")
async def get_track_status(lap: int):
    """Get current track status and weather."""
    # Returns: {"status": "Green", "weather": {"air_temp": 22, ...}}

@router.get("/drivers")
async def get_drivers():
    """Get list of drivers with team info and colors."""
    # Returns: [{"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#3671C6"}, ...]
```

#### Chat Route — `src/api/routes/chat.py`

```python
from fastapi import APIRouter
from pydantic import BaseModel
router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    driver_code: str
    current_lap: int
    conversation_history: list[dict]  # Previous messages

class ChatResponse(BaseModel):
    reply: str
    tools_used: list[str]

@router.post("/", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a message to the AI race engineer and get a response."""
    # 1. Build system prompt with driver/race context
    # 2. Inject [Race Update — Lap X/Y] before user message
    # 3. Run agent conversation loop (may call multiple tools)
    # 4. Return the final response text + list of tools used
```

### 10.4 Race State Caching — `src/api/services.py`

FastF1 sessions are expensive to load. Cache them in memory so the entire app shares one loaded session:

```python
from src.race_state import RaceState

class RaceService:
    """Singleton service that holds the loaded race state."""
    _instance = None
    _race_state: RaceState | None = None

    @classmethod
    def get_instance(cls) -> "RaceService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def load_race(self, year: int, round_number: int) -> dict:
        """Load a race and cache the RaceState."""
        self._race_state = RaceState(year, round_number)
        return self._race_state.get_metadata()

    @property
    def race_state(self) -> RaceState:
        if self._race_state is None:
            raise RuntimeError("No race loaded. Call /api/race/load first.")
        return self._race_state
```

---

## 11. Next.js Frontend

### 11.1 Architecture

The frontend is a Next.js 14 application using the App Router. It communicates with the FastAPI backend via REST API calls.

**Key design decisions:**
- **shadcn/ui** for base components (buttons, selects, sliders, badges) — consistent, accessible, customizable
- **Tailwind CSS** for styling — utility-first, rapid iteration
- **recharts** (or plotly.js) for the position chart — lightweight, React-native
- **Client-side state** managed via React hooks (`useState`, `useEffect`) — no global state library needed for this scale

### 11.2 API Client — `frontend/lib/api.ts`

All API calls to the backend go through a single client module:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function loadRace(year: number, round: number) {
  const res = await fetch(`${API_BASE}/api/race/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, round_number: round }),
  });
  if (!res.ok) throw new Error(`Failed to load race: ${res.statusText}`);
  return res.json();
}

export async function getStandings(lap: number) {
  const res = await fetch(`${API_BASE}/api/race/standings?lap=${lap}`);
  return res.json();
}

export async function getPositionHistory(lap: number) {
  const res = await fetch(`${API_BASE}/api/race/position-history?lap=${lap}`);
  return res.json();
}

export async function sendChatMessage(
  message: string,
  driverCode: string,
  currentLap: number,
  history: ChatMessage[]
) {
  const res = await fetch(`${API_BASE}/api/chat/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      driver_code: driverCode,
      current_lap: currentLap,
      conversation_history: history,
    }),
  });
  return res.json();
}
```

### 11.3 TypeScript Types — `frontend/lib/types.ts`

Define types that mirror the backend API responses:

```typescript
export interface Driver {
  code: string;
  name: string;
  team: string;
  color: string;
}

export interface StandingsEntry {
  position: number;
  driver: string;
  team: string;
  compound: "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
  tyre_age: number;
  gap_to_leader: number | null;
  last_lap_time: number | null;
}

export interface RaceMetadata {
  total_laps: number;
  circuit: string;
  country: string;
  event_name: string;
  year: number;
  drivers: Driver[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  lap?: number;
  tools_used?: string[];
}

export interface TrackStatus {
  status: "Green" | "Yellow" | "Safety Car" | "Red Flag" | "VSC";
  weather: {
    air_temp: number;
    track_temp: number;
    humidity: number;
    rainfall: boolean;
  };
}
```

### 11.4 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ SIDEBAR                          MAIN AREA                   │
│                                                              │
│ 🏎️ AI Race Engineer              Race Standings (lap 34/52)  │
│                                  ┌──────────────────────┐    │
│ Year: [2024 ▼]                   │ P1  VER  HARD  L12  │    │
│ Race: [Silverstone ▼]            │ P2  NOR  MED   L8   │    │
│ Driver: [NOR - Norris ▼]        │ P3  HAM  HARD  L12  │    │
│                                  │ P4  PIA  MED   L8   │    │
│ [Load Race]                      │ ...                  │    │
│                                  └──────────────────────┘    │
│ ─────────────────                                            │
│ Lap: ◄ [====34====] ►            Position Chart (recharts)   │
│      34 / 52                     ┌──────────────────────┐    │
│                                  │ 📈 position over lap │    │
│ Track Status: 🟢 GREEN           └──────────────────────┘    │
│ Weather: 22°C, Dry                                           │
│                                  Chat                        │
│                                  ┌──────────────────────┐    │
│                                  │ 🧑 Should we pit?    │    │
│                                  │                      │    │
│                                  │ 🤖 Not yet. We're   │    │
│                                  │ on 8-lap mediums,    │    │
│                                  │ deg is 0.15s/lap.    │    │
│                                  │ VER pits first on    │    │
│                                  │ older hards. Wait    │    │
│                                  │ for his stop, then   │    │
│                                  │ undercut PIA who's   │    │
│                                  │ 3.2s ahead.          │    │
│                                  │                      │    │
│                                  │ [________________]   │    │
│                                  └──────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 11.5 Component Breakdown

| Component | Responsibility |
|---|---|
| **`RaceSelector`** | Year/Race/Driver dropdowns + "Load Race" button. Calls `GET /api/race/schedules/{year}` and `POST /api/race/load` |
| **`LapControls`** | Lap slider (`1` to `total_laps`) + optional auto-play toggle. Changing the lap triggers re-fetch of standings and chart data |
| **`StandingsTable`** | Displays current standings from `GET /api/race/standings?lap=N`. Columns: position, driver (team-colored), team, tyre compound (colored badge), tyre age, gap, last lap. Highlights the user's selected driver |
| **`PositionChart`** | recharts `LineChart` with inverted Y-axis (P1 at top). Each driver's line colored by team color. Selected driver's line is thicker. Data from `GET /api/race/position-history?lap=N` |
| **`ChatInterface`** | Message list + input box. Sends messages via `POST /api/chat/`. Each message displays the lap it was asked on. Shows loading state while AI responds |
| **`TrackStatusBadge`** | Colored badge: green for clear, yellow for flag, orange for SC/VSC, red for red flag |
| **`WeatherInfo`** | Displays air temp, track temp, humidity, rainfall status |

### 11.6 Tyre Compound Colors

Use consistent colors throughout the UI for tyre compounds:

| Compound | Color | Badge Style |
|---|---|---|
| SOFT | Red `#FF3333` | Solid red background |
| MEDIUM | Yellow `#FFC700` | Solid yellow background |
| HARD | White `#FFFFFF` | White with dark border |
| INTERMEDIATE | Green `#43B02A` | Solid green background |
| WET | Blue `#0067FF` | Solid blue background |

### 11.7 Loading Flow

1. User selects year → frontend calls `GET /api/race/schedules/{year}` to populate race dropdown
2. User selects race + driver, clicks **"Load Race"**
3. Frontend calls `POST /api/race/load` → shows loading spinner (10–30s first time)
4. API returns race metadata (total laps, circuit, drivers)
5. Frontend initializes lap slider at lap 1, fetches initial standings + chart data
6. Chat interface becomes active
7. When user moves the lap slider → frontend re-fetches standings + chart data for the new lap

### 11.8 Dockerfile Frontend (Multi-Stage)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

> **Requires** `output: 'standalone'` in `next.config.js`:
> ```javascript
> const nextConfig = { output: 'standalone' }
> ```

---

## 12. Key Algorithms and Logic

### 12.1 Computing Gaps Between Drivers

For each driver, compute cumulative race time at each lap:

```
cumulative_time[driver][lap] = sum of LapTime for laps 1..N (skipping NaT values)
```

Gap between driver A and driver B at lap N:

```
gap = cumulative_time[A][N] - cumulative_time[B][N]
```

- **Positive** = A is behind B
- **Negative** = A is ahead

**Edge cases:**

- **Lapped drivers**: If a driver has fewer completed laps than another, they're lapped. Note this separately (e.g., "+1 Lap").
- **Safety car laps**: Lap times during safety car are slow for everyone but don't represent real pace. When computing pace averages, either exclude safety car laps or flag them. Identify SC laps by cross-referencing the track status data with lap completion times.

### 12.2 Detecting Pit Stops

FastF1's `Stint` column is the easiest way. When stint number increases between consecutive laps, a pit stop happened on the lap where `PitInTime` is not `NaT`.

**Record for each pit stop:**

- Lap number (the lap they pitted on)
- Old compound (from the stint that just ended)
- New compound (from the stint that just started)
- Approximate pit stop time (if available from `PitInTime` and `PitOutTime`)

### 12.3 Tyre Degradation Calculation

For a given stint:

1. Get all laps in the stint
2. Exclude the out-lap (first lap of stint — usually slow, driver on cold tyres behind traffic)
3. Exclude laps under safety car or yellow flag
4. Exclude laps with `NaT` lap times
5. Plot lap time (seconds) vs tyre age (`TyreLife`)
6. Fit a simple linear regression: `lap_time = base_pace + degradation_rate * tyre_life`
7. The `degradation_rate` (slope) is the deg in seconds per lap

**Reference values:**

| Degradation Rate | Severity |
|---|---|
| 0.02–0.05 s/lap | Low |
| 0.05–0.10 s/lap | Medium |
| 0.10+ s/lap | High / cliff risk |

### 12.4 Estimating Undercut/Overcut Potential

An undercut works when the fresh-tyre advantage outweighs the pit stop time loss:

- **Typical pit stop time loss**: ~22–25 seconds (varies by circuit; approximate from actual pit stop data in the session)
- **Fresh tyre advantage**: ~1–3 seconds per lap for the first few laps on new tyres vs worn tyres
- If the gap to the car ahead is less than the pit loss, and you can make up the difference with fresh tyre pace, an undercut is viable

### 12.5 Identifying the DRS Threat

DRS is available when the gap between two consecutive cars is less than 1.0 second at the DRS detection point. Since you have gap data per lap, flag when:

- A car behind is within **~1.2 seconds** → approaching DRS range
- A car behind is **under 1.0 seconds** → DRS active

---

## 13. FastF1 Gotchas and Edge Cases

> These are things that will trip you up if you don't handle them.

| # | Issue | How to Handle |
|---|---|---|
| 1 | **`NaT` values everywhere** — `LapTime`, `Sector1Time`, etc. can be `NaT` | Always check `pd.notna(value)` before calling `.total_seconds()` |
| 2 | **Lap 1 is anomalous** — includes time from standing start grid to finish line, always much longer than normal | Exclude from pace calculations or flag it |
| 3 | **Pit in-laps and out-laps are slow** — pit lane speed limit | Exclude from pace analysis. In-lap = last lap of a stint; out-lap = first lap of next stint |
| 4 | **Safety car laps are very slow** — ~30–50% slower than racing pace | Exclude from pace calculations. Cross-reference with track status data |
| 5 | **Retired drivers** don't complete all laps — their laps DataFrame is shorter | Don't show them in standings after their last lap |
| 6 | **Sprint races** use session type `'S'` — shorter (~17 laps), same data structure | Handle session type parameter |
| 7 | **`Position` column can have `NaN`** | Fall back to computing position from cumulative distance or time |
| 8 | **Timedelta conversion** — FastF1 uses `pd.Timedelta` objects, not floats | Convert to seconds with `.total_seconds()` for any math |
| 9 | **Driver codes vs driver numbers** — use three-letter `Driver` abbreviation consistently | Use abbreviations (`VER`, `HAM`, `NOR`) for display and as tool parameters |
| 10 | **Session loading can fail** — some old sessions have incomplete data | Wrap `session.load()` in `try/except` |
| 11 | **FastF1 cache** — without caching, every load re-downloads all data | Always enable with `fastf1.Cache.enable_cache(path)` |
| 12 | **JSON serialization** — `pd.Timedelta` and `NaT` are not JSON-serializable | Convert all timedeltas to float seconds and `NaT`/`NaN` to `null` before API responses |

---

## 14. Docker

### 14.1 API Backend Dockerfile

```dockerfile
# Stage 1: Builder — install dependencies
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml ./
RUN uv pip install --system --no-cache -e .

# Stage 2: Runtime — minimal production image
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 appuser && \
    mkdir -p /app /app/data/.fastf1_cache /app/logs && \
    chown -R appuser:appuser /app

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY --chown=appuser:appuser src/ ./src/
COPY --chown=appuser:appuser config/ ./config/
COPY --chown=appuser:appuser pyproject.toml ./

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 14.2 Docker Compose — `deployment/docker/docker-compose.yml`

```yaml
services:
  api:
    build:
      context: ../..
      dockerfile: Dockerfile
    container_name: f1-api
    ports:
      - "8000:8000"
    env_file:
      - ../../.env
    environment:
      - API__CORS_ORIGINS=http://localhost:3000,http://frontend:3000
    volumes:
      - fastf1_cache:/app/data/.fastf1_cache
    restart: unless-stopped
    networks:
      - f1-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  frontend:
    build:
      context: ../../frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: http://localhost:8000
    container_name: f1-frontend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - f1-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  f1-network:
    driver: bridge

volumes:
  fastf1_cache:
```

### 14.3 Key Docker Principles

1. **Layer ordering**: Copy files that change less frequently first (dependencies before code)
2. **Multi-stage builds**: Separate build from runtime to reduce image size
3. **Non-root user**: API runs as `appuser`, not root
4. **Health checks**: API exposes `/health`, frontend uses wget
5. **Persistent volume**: `fastf1_cache` volume persists downloaded race data across container restarts
6. **CORS in Docker**: `API__CORS_ORIGINS` env var includes both `localhost:3000` (browser) and `frontend:3000` (inter-container)

### 14.4 Docker Commands

```bash
# Build and start all services
make docker-up

# Stop all services
make docker-down

# Rebuild after code changes
cd deployment/docker && docker compose up --build -d

# View API logs
docker logs -f f1-api

# View frontend logs
docker logs -f f1-frontend

# Clean volumes (removes cached race data!)
cd deployment/docker && docker compose down -v
```

> **Important**: Docker does NOT rebuild automatically when you change code. Always run `docker compose up --build` after changes.

---

## 15. Testing

### 15.1 Test Structure

```
tests/
├── __init__.py
├── conftest.py              # Shared fixtures
├── unit/                    # Unit tests (no external dependencies)
│   ├── __init__.py
│   ├── test_race_state.py   # Test RaceState class methods
│   ├── test_tools.py        # Test tool functions and schemas
│   └── test_agent.py        # Test agent conversation loop
└── integration/             # Integration tests (require FastF1 data / running API)
    ├── __init__.py
    └── test_api.py          # Test API endpoints
```

### 15.2 `conftest.py` — Shared Fixtures

```python
"""Pytest configuration and shared fixtures."""
import pytest
import pandas as pd
from unittest.mock import Mock, AsyncMock

@pytest.fixture
def sample_laps_df():
    """Create a minimal laps DataFrame for testing."""
    return pd.DataFrame({
        "Driver": ["VER", "VER", "NOR", "NOR"],
        "LapNumber": [1, 2, 1, 2],
        "LapTime": [pd.Timedelta(seconds=95), pd.Timedelta(seconds=88),
                     pd.Timedelta(seconds=96), pd.Timedelta(seconds=89)],
        "Compound": ["MEDIUM", "MEDIUM", "SOFT", "SOFT"],
        "TyreLife": [1, 2, 1, 2],
        "Position": [1, 1, 2, 2],
        "Stint": [1, 1, 1, 1],
        "PitInTime": [pd.NaT, pd.NaT, pd.NaT, pd.NaT],
        "PitOutTime": [pd.NaT, pd.NaT, pd.NaT, pd.NaT],
    })

@pytest.fixture
def mock_race_state(sample_laps_df):
    """Mock RaceState for testing tools and agent."""
    state = Mock()
    state.total_laps = 52
    state.event_name = "British Grand Prix"
    state.circuit_name = "Silverstone"
    state.drivers = {"VER": "Red Bull Racing", "NOR": "McLaren"}
    return state

@pytest.fixture
def mock_litellm():
    """Mock LiteLLM completion for testing agent without API calls."""
    with patch("litellm.completion") as mock:
        mock.return_value = Mock(
            choices=[Mock(message=Mock(content="Test response", tool_calls=None))]
        )
        yield mock
```

### 15.3 Test Conventions

```python
"""Unit tests for race_state module."""
import pytest
from src.race_state import RaceState

class TestGetStandings:
    """Tests for RaceState.get_standings()."""

    def test_returns_correct_positions(self, sample_laps_df):
        """Standings should reflect Position column at the given lap."""
        state = RaceState(laps=sample_laps_df)
        standings = state.get_standings(as_of_lap=2)
        assert standings[0]["driver"] == "VER"
        assert standings[0]["position"] == 1

    def test_excludes_retired_drivers(self):
        """Retired drivers should not appear in standings after their last lap."""
        ...

    def test_handles_nan_positions(self):
        """Should fall back gracefully when Position is NaN."""
        ...
```

### 15.4 Running Tests

```bash
# Run all tests
make test

# Run only unit tests
uv run pytest tests/unit/

# Run a specific test class
uv run pytest tests/unit/test_race_state.py::TestGetStandings

# Run with coverage report
uv run pytest --cov=src --cov-report=html

# Run only fast tests (exclude integration)
uv run pytest -m "not integration and not slow"
```

---

## 16. CI/CD Pipeline

### 16.1 GitHub Actions — 2-Phase Pipeline

```
Phase 1: Lint + Test (on every push/PR)
   ↓
Phase 2: Build Docker Images (on push to main)
```

### 16.2 Workflow File — `.github/workflows/ci.yml`

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Lint & Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install uv
        run: |
          curl -LsSf https://astral.sh/uv/install.sh | sh
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH

      - name: Install dependencies
        run: uv pip install --system -e ".[dev]"

      - name: Lint
        run: uv run ruff check .

      - name: Run tests
        run: uv run pytest tests/unit/ -v

  docker-build:
    name: Build Docker Images
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build API image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          push: false
          tags: f1-race-engineer-api:latest
          cache-from: type=gha
          cache-to: type=gha,mode=min,compression=zstd

      - name: Build Frontend image
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          file: ./frontend/Dockerfile
          push: false
          tags: f1-race-engineer-frontend:latest
          build-args: |
            NEXT_PUBLIC_API_URL=http://localhost:8000
          cache-from: type=gha
          cache-to: type=gha,mode=min,compression=zstd
```

### 16.3 Best Practices

- Use `--system` flag with `uv pip install` in CI (no venv needed in containers)
- Mock external services (LiteLLM, FastF1) in unit tests — don't call real APIs in CI
- Use GitHub Actions cache (`type=gha`) for Docker layer caching
- Only build Docker on pushes to `main`, not on every PR
- Build both API and Frontend images to verify they compile

---

## 17. Git Workflow and Conventions

### 17.1 Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Production-ready code |
| `develop` | Development integration |
| `feature/feature-name` | New features |
| `fix/bug-name` | Bug fixes |

### 17.2 Commit Messages

Use conventional commit format:

```
feat: Add tyre degradation calculation
fix: Handle NaT values in gap computation
docs: Update FastF1 data reference
refactor: Simplify standings query logic
test: Add unit tests for pit stop detection
chore: Update dependencies in pyproject.toml
style: Fix frontend layout for mobile
```

### 17.3 `.gitignore`

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
dist/
*.egg-info/
*.egg

# Virtual environments
.venv/
venv/
env/

# IDEs
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store
.cursor/

# Testing
.pytest_cache/
.coverage
htmlcov/
.mypy_cache/
.ruff_cache/

# Environment variables
.env
.env.local
.env.*.local

# FastF1 cache (large, downloaded per-machine)
data/.fastf1_cache/

# Logs
logs/*.log
logs/**/*.log
!logs/.gitkeep

# Data artifacts (generated at runtime)
data/**/*.json
data/**/*.csv
data/**/*.pkl
!data/.gitkeep

# Docker volumes
deployment/docker/volumes/

# Node / Frontend
frontend/node_modules/
frontend/.next/
frontend/out/

# Jupyter
.ipynb_checkpoints/

# Temporary files
tmp/
temp/
*.tmp
```

### 17.4 Security Checklist (Before Every Commit)

**NEVER commit:**
- API keys (OpenAI, Anthropic, etc.)
- Passwords or tokens
- `.env` files with real values

**Always use:**
- `.env` file (gitignored) for secrets
- `.env.example` (committed) as a template with placeholder values
- `config/settings.yaml` for non-secret configuration only

---

## 18. Coding Conventions

### 18.1 Python — Type Hints

Always use type hints on function signatures:

```python
def get_standings(self, as_of_lap: int) -> list[dict[str, Any]]:
    ...

def get_gap_to_driver(self, driver_a: str, driver_b: str, as_of_lap: int) -> dict[str, float]:
    ...
```

### 18.2 Python — Docstrings (Google Style)

```python
def get_tyre_degradation(self, driver_code: str, as_of_lap: int) -> dict:
    """Calculate tyre degradation rate for the driver's current stint.

    Args:
        driver_code: Three-letter driver abbreviation (e.g. "VER").
        as_of_lap: Only consider data up to this lap number.

    Returns:
        Dict with keys: degradation_rate (s/lap), severity (low/medium/high),
        stint_laps (int), compound (str).
    """
    ...
```

### 18.3 Python — Import Order

```python
# Standard library
import os
from pathlib import Path
from typing import Any, Optional

# Third-party
import pandas as pd
import numpy as np
import litellm
from fastapi import APIRouter, HTTPException

# Local
from src.race_state import RaceState
from src.utils.config import settings
from src.utils.logger import logger
```

### 18.4 Python — Logging

Use `loguru` for structured logging:

```python
from loguru import logger

logger.info("Loading session: {year} {event}", year=2024, event="British GP")
logger.debug("Laps DataFrame shape: {shape}", shape=laps_df.shape)
logger.warning("NaT values found in LapTime for driver {driver}", driver="VER")
logger.error("Failed to load session: {error}", error=str(e))
```

### 18.5 Python — Error Handling

Use specific exceptions, not bare `except`:

```python
try:
    session.load()
except Exception as e:
    logger.error("Failed to load FastF1 session: {}", e)
    raise HTTPException(status_code=500, detail=f"Could not load race data: {e}")
```

For data operations, always validate before using:

```python
if pd.notna(lap_time):
    seconds = lap_time.total_seconds()
else:
    logger.debug("Skipping NaT lap time for {} on lap {}", driver, lap_num)
```

### 18.6 TypeScript — Frontend Conventions

- **Components**: PascalCase (`StandingsTable.tsx`, `ChatInterface.tsx`)
- **Utilities**: camelCase (`api.ts`, `utils.ts`)
- **Types**: defined in `lib/types.ts`, imported where needed
- **API calls**: centralized in `lib/api.ts` — components never call `fetch` directly
- **State**: React hooks (`useState`, `useEffect`) — no global state library needed

---

## 19. Documentation

### 19.1 Docs Folder Structure

```
docs/
├── ARCHITECTURE.md         # System architecture — how frontend, API, and agent connect
├── API.md                  # API endpoint reference (auto-generated from FastAPI OpenAPI)
├── QUICKSTART.md           # Getting started in 5 minutes
└── FASTF1_REFERENCE.md    # FastF1 data format quick reference
```

### 19.2 `ARCHITECTURE.md` — What to Include

- High-level diagram: Browser → Next.js Frontend → FastAPI Backend → Agent → Tools → RaceState → FastF1 Data
- Module responsibilities (one paragraph each)
- Data flow: how a user question becomes a data-backed answer
- API contract between frontend and backend
- Key design decisions and why they were made

### 19.3 `API.md` — What to Include

FastAPI auto-generates OpenAPI docs at `/docs` (Swagger UI) and `/redoc`. The `API.md` file should summarize:

- Base URL and authentication (none for now)
- All endpoints with request/response examples
- Error codes and their meanings

### 19.4 `QUICKSTART.md` — What to Include

- Prerequisites (Python 3.11+, Node.js 20+, uv)
- Installation steps (clone, `make init`, `.env` setup)
- Run: `make dev-api` + `make dev-frontend` in separate terminals
- First interaction walkthrough (select a race, ask a question)

### 19.5 README.md

The project root README should contain:

- Project title and one-line description
- Screenshot or demo GIF
- Features list
- Quick install + run instructions
- Link to full docs
- Tech stack badges
- License

---

## 20. Implementation Order

Build and test in this sequence:

### Step 1: Project Scaffolding

- Create directory structure (`src/`, `frontend/`, `tests/`, `docs/`, `config/`, `scripts/`, `data/`, `logs/`, `deployment/`)
- Set up `pyproject.toml` with all dependencies
- Create `config/settings.yaml`
- Create `Makefile`, `.gitignore`, `.env.example`
- Run `make init` to verify environment works
- Initialize git repository

### Step 2: `race_state.py` — Data Foundation

- Load a session, extract laps DataFrame
- Implement `get_standings(as_of_lap)` first — this validates your data is loading correctly
- Then implement pit stop detection, stint summary, gap calculation
- Ensure all methods return JSON-serializable dicts/lists
- Write unit tests as you go (`test_race_state.py`)
- Test with a known race (e.g., 2024 British GP) where you can verify results

### Step 3: `tools.py` — Query Functions

- Implement each tool function, calling `RaceState` methods
- Format outputs as clean, readable strings
- Define the tool schemas (OpenAI format, used by LiteLLM)
- Write unit tests for each tool
- Test each tool independently before connecting to the LLM

### Step 4: `agent.py` — LLM Integration

- Set up LiteLLM with config from `settings.yaml`
- Implement the tool-calling conversation loop
- Test in a simple terminal loop first (no API, no UI)
- Verify the model calls the right tools for different question types
- Write tests with mocked LiteLLM responses

### Step 5: FastAPI Backend

- Set up `src/api/main.py` with CORS middleware
- Implement race data endpoints (`/api/race/*`)
- Implement chat endpoint (`/api/chat/`)
- Implement `RaceService` singleton for session caching
- Test endpoints with `pytest` + `httpx.AsyncClient`
- Verify CORS works: run API on :8000, test from browser on :3000

### Step 6: Next.js Frontend

- Initialize Next.js project with TypeScript + Tailwind + shadcn/ui
- Create `lib/api.ts` client and `lib/types.ts`
- Build `RaceSelector` → `StandingsTable` → `PositionChart` → `ChatInterface`
- Connect to running API backend
- Test full flow end-to-end

### Step 7: Infrastructure

- Create API `Dockerfile` and test local build
- Create frontend `Dockerfile` and test local build
- Create `docker-compose.yml` and test multi-service startup
- Set up `.github/workflows/ci.yml`
- Write docs (`QUICKSTART.md`, `ARCHITECTURE.md`, `API.md`)
- Final cleanup and README

---

## 21. Example Conversations

These show what the final app should be capable of:

---

**User** (Lap 15): *"Where are we?"*

**AI calls**: `get_driver_info("NOR")`, `get_race_standings()`

**Response**: "We're P4, 6.2s behind PIA in P3. On 15-lap old mediums, pace is solid at 1:29.4 average. VER leads, 8.1s ahead. No stops from anyone yet — we're in a good window."

---

**User** (Lap 22): *"Should we pit this lap?"*

**AI calls**: `get_tyre_strategy("NOR")`, `get_gap_between_drivers("NOR", "PIA")`, `get_gap_between_drivers("NOR", "SAI")`, `get_race_standings()`

**Response**: "Not yet. Deg is only 0.08s/lap on our mediums — we have 3-4 more laps before the crossover. PIA is 5.8s ahead and hasn't pitted. If we wait for him to stop first, we undercut by staying out on faster rubber while he's on cold tyres. SAI behind us is 3.1s back and also hasn't stopped — no immediate threat. Recommend: stay out until lap 25-26, then box for hards."

---

**User** (Lap 38): *"How does our pace compare to Verstappen?"*

**AI calls**: `compare_drivers("NOR", "VER")`

**Response**: "VER is averaging 1:28.9 over the last 5 laps on 12-lap hards. We're at 1:29.2 on 8-lap hards. He's 0.3s/lap quicker right now. Gap is 11.4s and growing. At this rate, P1 isn't realistic unless we get a safety car. Focus on defending P2 from HAM who's 2.1s back and closing 0.15s/lap."

---

**User** (Lap 41): *"Safety car! What do we do?"*

**AI calls**: `get_track_status()`, `get_tyre_strategy("NOR")`, `get_race_standings()`, `get_weather_conditions()`

**Response**: "Safety car out. This is our opportunity. We're on 16-lap hards, VER ahead is on 20-lap hards. Recommend: BOX BOX BOX for fresh mediums. VER will likely stay out to keep track position. We'll restart on much fresher rubber with 11 laps to go — should be able to close 11.4s with a ~2s/lap tyre delta. HAM behind will probably also stop, so we won't lose P2."

---

## 22. Project Setup Checklist

Use this checklist when starting the project from scratch:

### Initial Setup

- [ ] Create directory structure (`src/`, `frontend/`, `tests/`, `docs/`, `config/`, `scripts/`, `data/`, `logs/`, `deployment/`)
- [ ] Initialize git repository
- [ ] Create `pyproject.toml` with all dependencies
- [ ] Create `config/settings.yaml`
- [ ] Create `.env.example` with placeholder values
- [ ] Create `.gitignore`
- [ ] Create `Makefile`
- [ ] Create `README.md` (basic, expand later)

### UV + Python Dependencies

- [ ] Install `uv`
- [ ] Create virtual environment: `uv venv`
- [ ] Install dependencies: `uv pip install -e ".[dev]"`
- [ ] Verify installation: `uv run python -c "import fastf1; import litellm; print('OK')"`

### Frontend Setup

- [ ] Initialize Next.js project: `npx create-next-app@latest frontend --typescript --tailwind --app`
- [ ] Install shadcn/ui: `npx shadcn-ui@latest init`
- [ ] Add components: button, select, slider, badge, input
- [ ] Install recharts: `npm install recharts`
- [ ] Create `frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000`
- [ ] Verify: `cd frontend && npm run dev`

### Backend Implementation

- [ ] Implement `src/utils/config.py` (YAML + env var loading)
- [ ] Implement `src/utils/logger.py` (loguru setup)
- [ ] Implement `src/race_state.py` (data foundation)
- [ ] Implement `src/tools.py` (tool functions + schemas)
- [ ] Implement `src/agent.py` (LiteLLM conversation loop)
- [ ] Implement `src/api/main.py` (FastAPI app + CORS)
- [ ] Implement `src/api/routes/race.py` (race data endpoints)
- [ ] Implement `src/api/routes/chat.py` (chat endpoint)
- [ ] Implement `src/api/services.py` (race state caching)
- [ ] Verify: `make dev-api` → test `/health` and `/docs`

### Frontend Implementation

- [ ] Create `lib/api.ts` (API client)
- [ ] Create `lib/types.ts` (TypeScript types)
- [ ] Build `RaceSelector` component
- [ ] Build `StandingsTable` component
- [ ] Build `PositionChart` component
- [ ] Build `ChatInterface` component
- [ ] Build `TrackStatusBadge` and `WeatherInfo` components
- [ ] Build `LapControls` component
- [ ] Wire up main page layout
- [ ] Verify: full flow with `make dev-api` + `make dev-frontend`

### Testing

- [ ] Create `tests/conftest.py` with shared fixtures
- [ ] Write unit tests for `race_state.py`
- [ ] Write unit tests for `tools.py`
- [ ] Write unit tests for `agent.py` (mocked LiteLLM)
- [ ] Write integration tests for API endpoints
- [ ] Verify: `make test` passes

### Docker

- [ ] Create API `Dockerfile` (multi-stage)
- [ ] Create frontend `Dockerfile` (multi-stage, with `output: 'standalone'`)
- [ ] Create `deployment/docker/docker-compose.yml`
- [ ] Test: `make docker-up`
- [ ] Verify both services healthy and frontend can reach API
- [ ] Verify CORS works in Docker

### CI/CD

- [ ] Create `.github/workflows/ci.yml`
- [ ] Push to GitHub
- [ ] Verify CI pipeline runs: lint → test → Docker build

### Documentation

- [ ] Write `docs/ARCHITECTURE.md`
- [ ] Write `docs/QUICKSTART.md`
- [ ] Write `docs/API.md`
- [ ] Write `docs/FASTF1_REFERENCE.md`
- [ ] Update `README.md` with full content (features, screenshots, install guide)

### Pre-Launch Security

- [ ] Verify `.gitignore` includes all secrets (`.env`, cache dirs, `node_modules`)
- [ ] Verify no hardcoded API keys: search for `sk-` in codebase
- [ ] Verify `.env.example` has only placeholder values
- [ ] Verify `settings.yaml` has no real secrets (only in `.env`)
- [ ] Verify FastF1 cache directory is gitignored
