# CLI Reference

> Last updated: 2025-02-18

All CLI commands are run via `uv run` from the project root (where `pyproject.toml` lives).

---

## `f1-data-loader`

Download, explore, filter, and export F1 race data.

### Basic usage

```bash
uv run f1-data-loader [OPTIONS]
```

### Flags

#### General

| Flag | Description |
|---|---|
| `--year YEAR` | Season year. Default: `2025` |
| `--round N` | Only process round number N (1–24). Without this, processes all rounds |
| `--info` | Show the season schedule and exit — no downloading |
| `--inspect` | Print DataFrame structures (column names, dtypes, row counts) after loading |
| `--cache-dir PATH` | Override the FastF1 cache directory (default: `data/.fastf1_cache`) |

#### Export

| Flag | Description |
|---|---|
| `--export` | Export core race data to CSV files in `data/exports/` |
| `--telemetry` | Also export raw `car_data/` and `pos_data/` per driver (large). Requires `--export` |
| `--merged-telemetry` | Export merged per-lap telemetry (car + GPS + computed fields like Distance, DriverAhead) |
| `--driver CODE` | Scope `--merged-telemetry` or `--filter` to one driver (e.g. `VER`, `NOR`) |
| `--lap N` | Export a single lap's merged telemetry. Requires `--driver` and `--merged-telemetry` |

#### Lap filtering

| Flag | Description |
|---|---|
| `--filter-summary` | Print a table showing how many laps pass each filter |
| `--filter TYPE` | Apply a lap filter. Types: `quick`, `clean`, `accurate`, `green`, `box`, `valid`, `compound` |
| `--compound NAME` | Tyre compound for `--filter compound`. Values: `SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET` |

**Filter types:**

| Filter | What it keeps |
|---|---|
| `quick` | Only representative fast laps (107% of fastest, no pit/SC/lap 1) |
| `clean` | All laps except pit in-laps and out-laps |
| `accurate` | Only laps with reliable timing data (not interpolated) |
| `green` | Only green-flag laps (no SC, VSC, yellow, red flag) |
| `box` | Only pit in-laps and out-laps |
| `valid` | Only laps not deleted for track limits |
| `compound` | Only laps on a specific tyre (requires `--compound`) |

### Examples

```bash
# --- Schedule & basic usage ---
uv run f1-data-loader --info                          # show season schedule
uv run f1-data-loader --round 1                       # load round 1, print summary
uv run f1-data-loader --round 1 --inspect             # inspect DataFrame structures

# --- Core export ---
uv run f1-data-loader --round 1 --export              # export 6 core CSVs
uv run f1-data-loader --round 1 --export --telemetry  # + raw car_data/ and pos_data/
uv run f1-data-loader --export --telemetry             # export all 24 rounds (~2.5 GB)

# --- Merged per-lap telemetry ---
uv run f1-data-loader --round 1 --merged-telemetry                        # all 20 drivers
uv run f1-data-loader --round 1 --merged-telemetry --driver VER           # one driver, all laps
uv run f1-data-loader --round 1 --merged-telemetry --driver VER --lap 43  # single lap

# --- Lap filtering ---
uv run f1-data-loader --round 1 --filter-summary                             # summary table
uv run f1-data-loader --round 1 --filter quick                               # count quick laps
uv run f1-data-loader --round 1 --filter quick --driver VER                   # VER quick laps
uv run f1-data-loader --round 1 --filter quick --export                       # export quick laps CSV
uv run f1-data-loader --round 1 --filter compound --compound HARD             # hard-compound laps
uv run f1-data-loader --round 1 --filter compound --compound HARD --driver VER  # VER hard laps
uv run f1-data-loader --round 1 --filter green --export                       # export green-flag laps

# --- Combine everything ---
uv run f1-data-loader --round 1 --export --filter quick --merged-telemetry --driver VER
```

### Output directory structure

When using `--export`, `--merged-telemetry`, or `--filter --export`:

```
data/exports/2025/
├── round_01_melbourne/
│   ├── laps.csv                     # --export (always)
│   ├── results.csv                  # --export (always)
│   ├── weather.csv                  # --export (always)
│   ├── track_status.csv             # --export (always)
│   ├── race_control_messages.csv    # --export (always)
│   ├── circuit_info.csv             # --export (always)
│   ├── car_data/                    # --export --telemetry
│   │   ├── VER.csv
│   │   └── ... (20 drivers)
│   ├── pos_data/                    # --export --telemetry
│   │   ├── VER.csv
│   │   └── ... (20 drivers)
│   ├── telemetry/                   # --merged-telemetry
│   │   ├── VER_all_laps.csv         #   --driver VER
│   │   ├── VER_lap43.csv            #   --driver VER --lap 43
│   │   ├── NOR_all_laps.csv         #   (all drivers if no --driver)
│   │   └── ...
│   ├── laps_filtered_quick.csv          # --filter quick --export
│   ├── laps_filtered_VER_quick.csv      # --filter quick --driver VER --export
│   └── laps_filtered_compound_hard.csv  # --filter compound --compound HARD --export
├── round_02_shanghai/
└── ...
```

---

## `f1-api`

Start the FastAPI backend server.

### Basic usage

```bash
uv run f1-api
```

Starts the API at `http://localhost:8000` with hot reload enabled. Configuration is read from `config/settings.yaml` and `.env`.

### Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /docs` | OpenAPI documentation (Swagger UI) |
| `GET /api/race/schedules/{year}` | Season schedule |
| `POST /api/race/load` | Load a race session |
| `GET /api/race/standings` | Current standings |
| `GET /api/race/position-history` | Position history for charts |
| `GET /api/race/track-status` | Track status events |
| `GET /api/race/drivers` | Driver list |
| `POST /api/chat/` | Send a message to the AI race engineer |

---

## Makefile commands

These are shortcuts that wrap `uv run` and other tools.

```bash
make help          # Show all available commands
```

| Command | What it does |
|---|---|
| `make init` | Install all dependencies (Python + Node) |
| `make dev-api` | Start FastAPI server (`uv run f1-api`) |
| `make dev-frontend` | Start Next.js dev server |
| `make load-data` | Download all 2025 race data (`uv run f1-data-loader`) |
| `make test` | Run Python tests (`uv run pytest`) |
| `make format` | Format code (`uv run ruff format .`) |
| `make lint` | Lint code (`uv run ruff check .`) |
| `make docker-up` | Build and start Docker services |
| `make docker-down` | Stop Docker services |
| `make clean` | Remove cache files (`__pycache__`, `.pytest_cache`, etc.) |

---

## Tips

### First-time setup

```bash
# 1. Install everything
make init

# 2. Set up environment
cp .env.example .env
# Edit .env and add your API key

# 3. Download some data to work with
uv run f1-data-loader --round 1 --export

# 4. Start the API
make dev-api
```

### Working with exported CSVs in pandas

```python
import pandas as pd

# Load lap data
laps = pd.read_csv("data/exports/2025/round_01_melbourne/laps.csv")

# Filter for one driver
ver = laps[laps["Driver"] == "VER"]

# Lap times are already in float seconds — ready for math
ver["LapTime"].mean()  # average lap time
ver["LapTime"].min()   # fastest lap

# Load raw telemetry for one driver
car = pd.read_csv("data/exports/2025/round_01_melbourne/car_data/VER.csv")
car[["Speed", "RPM", "Throttle", "Brake"]].describe()

# Load merged per-lap telemetry (richer data)
tel = pd.read_csv("data/exports/2025/round_01_melbourne/telemetry/VER_all_laps.csv")
lap43 = tel[tel["LapNumber"] == 43]
lap43[["Distance", "Speed", "Throttle", "Brake", "DriverAhead"]].head()

# Load filtered laps
quick = pd.read_csv("data/exports/2025/round_01_melbourne/laps_filtered_VER_quick.csv")
quick["LapTime"].describe()  # only representative pace laps
```

### Cache location

FastF1 caches downloaded data in `data/.fastf1_cache/`. If you need to clear it:

```bash
rm -rf data/.fastf1_cache/*
```

This forces a re-download on the next `load_race()` call.
