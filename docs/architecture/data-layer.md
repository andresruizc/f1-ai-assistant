# Data Layer — FastF1 & F1DataLoader

> Last updated: 2025-02-18

## Overview

The data layer is built on [FastF1](https://docs.fastf1.dev/), an open-source Python library that provides access to official F1 timing data. It gives us lap times, tyre compounds, positions, weather, track status, pit stops, and more for every session since ~2018.

## How FastF1 caching works

FastF1 downloads raw timing data from the F1 live timing API and caches it locally as `.ff1pkl` (pickle) files.

```
data/.fastf1_cache/
├── fastf1_http_cache.sqlite      # HTTP response cache
└── 2025/
    └── 2025-03-16_Australian_Grand_Prix/
        └── 2025-03-16_Race/
            ├── session_info.ff1pkl
            ├── driver_info.ff1pkl
            ├── _extended_timing_data.ff1pkl
            ├── car_data.ff1pkl
            ├── position_data.ff1pkl
            ├── weather_data.ff1pkl
            ├── track_status_data.ff1pkl
            ├── timing_app_data.ff1pkl
            ├── lap_count.ff1pkl
            └── race_control_messages.ff1pkl
```

- **First load**: ~10-30 seconds per race (downloads from F1 API)
- **Cached load**: ~2-5 seconds (reads local pickle files)
- **Size**: ~100-150 MB per race (including car telemetry data)

The cache directory is configured in `config/settings.yaml`:

```yaml
fastf1:
  cache_dir: "data/.fastf1_cache"
```

## F1DataLoader (`src/data_loader.py`)

This is the main entry point for downloading and exploring F1 data. It wraps FastF1's API into a convenient class with methods for everything you'd want to do with race data.

### Key design decisions

1. **Season-level scope**: The loader is initialized for a specific year and gives you access to every round.
2. **Lazy loading**: Sessions are only downloaded when you request them (via `load_race()`), not upfront.
3. **In-memory caching**: Once loaded, sessions are kept in `self._sessions` so repeated access doesn't re-parse.
4. **CLI + library**: Works both as an importable module and a command-line tool.

### Class API

#### Schedule & loading

| Method | Returns | Purpose |
|---|---|---|
| `get_schedule()` | `pd.DataFrame` | Full season calendar |
| `get_race_rounds()` | `list[dict]` | Clean list of rounds with country, date, name |
| `print_schedule()` | — | Formatted table to stdout |
| `load_race(round)` | `Session` | Load one race (downloads if needed) |
| `download_all_races()` | `dict[int, Session]` | Batch-download all rounds |

#### Race exploration

| Method | Returns | Purpose |
|---|---|---|
| `get_race_summary(session)` | `dict` | Winner, podium, fastest lap, DNFs |
| `get_drivers(session)` | `list[dict]` | Driver list with code, name, team, grid, result |
| `get_laps_df(session)` | `pd.DataFrame` | All laps with computed `LapTimeSeconds` column |
| `get_driver_laps(session, code)` | `pd.DataFrame` | One driver's laps, sorted |
| `get_stint_summary(session, code)` | `list[dict]` | Stint breakdown: compound, laps, pace |
| `get_pit_stops(session, code)` | `list[dict]` | Pit stop list with compound changes |
| `get_weather_summary(session)` | `dict` | Temp ranges, humidity, rainfall |
| `get_track_status_events(session)` | `list[dict]` | Safety cars, VSC, red flags |
| `inspect_dataframes(session)` | `dict` | Raw DataFrame shapes, columns, dtypes |

#### Merged per-lap telemetry

| Method | Returns | Purpose |
|---|---|---|
| `get_lap_telemetry(session, driver, lap)` | `pd.DataFrame` | Merged car+GPS telemetry for one lap (~640 rows × 20 cols) |
| `get_driver_telemetry(session, driver, laps=None)` | `pd.DataFrame` | Merged telemetry for all (or specific) laps of a driver |
| `export_lap_telemetry(session, driver, lap)` | `Path` | Export single lap to `telemetry/{DRIVER}_lap{NN}.csv` |
| `export_driver_telemetry(session, driver, laps=None)` | `Path` | Export all laps to `telemetry/{DRIVER}_all_laps.csv` |
| `export_merged_telemetry(session, driver=None, lap=None)` | `Path` | CLI-facing: export merged telemetry (scoped by driver/lap or all) |

#### Smart lap filtering

| Method | Returns | Purpose |
|---|---|---|
| `get_quicklaps(session, driver=None)` | `pd.DataFrame` | Only representative fast laps (107% rule) |
| `get_clean_laps(session, driver=None)` | `pd.DataFrame` | Remove pit in/out laps |
| `get_accurate_laps(session, driver=None)` | `pd.DataFrame` | Only reliable (non-interpolated) timing |
| `get_laps_by_compound(session, compound, driver=None)` | `pd.DataFrame` | Only laps on a specific tyre |
| `get_green_flag_laps(session, driver=None)` | `pd.DataFrame` | Green flag only (no SC/VSC/yellow/red) |
| `get_box_laps(session, driver=None)` | `pd.DataFrame` | Only pit in/out laps |
| `get_valid_laps(session, driver=None)` | `pd.DataFrame` | Only laps not deleted for track limits |
| `apply_lap_filter(session, filter_name, driver=None, compound=None)` | `pd.DataFrame` | Apply a named filter by string key |
| `export_filtered_laps(session, filter_name, driver=None, compound=None)` | `Path` | Export filtered laps to CSV |
| `print_lap_filter_summary(session)` | — | Print filter statistics table |

#### CSV export

| Method | Returns | Purpose |
|---|---|---|
| `export_race_to_csv(session, include_telemetry=False)` | `Path` | Export all core DataFrames (+ raw telemetry if flagged) |
| `export_all_races_to_csv(include_telemetry=False)` | `list[Path]` | Export all loaded sessions |

### CLI usage

See `guides/cli-reference.md` for the full flag reference. Key commands:

```bash
uv run f1-data-loader --info                              # season schedule
uv run f1-data-loader --round 1                           # load + summarise
uv run f1-data-loader --round 1 --export                  # core CSVs
uv run f1-data-loader --round 1 --export --telemetry      # + raw car/pos data
uv run f1-data-loader --round 1 --merged-telemetry        # merged per-lap telemetry
uv run f1-data-loader --round 1 --filter quick --export   # export filtered laps
uv run f1-data-loader --round 1 --filter-summary          # filter statistics
```

### Library usage

```python
from src.data_loader import F1DataLoader

loader = F1DataLoader(year=2025)
session = loader.load_race(1)

# --- Basic exploration ---
loader.print_race_summary(session)
drivers = loader.get_drivers(session)
laps = loader.get_laps_df(session)
stints = loader.get_stint_summary(session, "VER")
pit_stops = loader.get_pit_stops(session, "VER")
weather = loader.get_weather_summary(session)

# --- Merged telemetry ---
tel = loader.get_lap_telemetry(session, "VER", 43)     # single lap
tel_all = loader.get_driver_telemetry(session, "VER")   # all laps

# --- Lap filtering ---
quick = loader.get_quicklaps(session, "VER")            # representative pace
green = loader.get_green_flag_laps(session)              # no SC/VSC
medium = loader.get_laps_by_compound(session, "MEDIUM")  # by tyre
loader.print_lap_filter_summary(session)                 # stats table
```

## Key DataFrames from FastF1

When you load a session, FastF1 provides these main DataFrames:

### `session.laps` — the most important one

Each row is one lap by one driver.

| Column | Type | Description |
|---|---|---|
| `Driver` | `str` | Three-letter code: `"VER"`, `"NOR"` |
| `LapNumber` | `int` | 1-indexed lap number |
| `LapTime` | `Timedelta` / `NaT` | Total lap time (NaT if incomplete) |
| `Compound` | `str` | `"SOFT"`, `"MEDIUM"`, `"HARD"`, `"INTERMEDIATE"`, `"WET"` |
| `TyreLife` | `float` | Laps on current tyre set |
| `Position` | `float` | Position at end of this lap (can be NaN) |
| `Stint` | `int` | Stint number (increments at each pit stop) |
| `PitInTime` | `Timedelta` / `NaT` | When driver entered pit lane |
| `PitOutTime` | `Timedelta` / `NaT` | When driver exited pit lane |
| `Time` | `Timedelta` | Session timestamp when lap was completed |

### `session.results` — final classification

| Column | Description |
|---|---|
| `Abbreviation` | Three-letter driver code |
| `FullName` | Full name |
| `TeamName` | Team name |
| `Position` | Finishing position |
| `Status` | `"Finished"`, `"+1 Lap"`, `"Retired"`, etc. |
| `GridPosition` | Starting grid position |

### `session.weather_data` — weather samples

| Column | Description |
|---|---|
| `AirTemp` | Air temperature (°C) |
| `TrackTemp` | Track temperature (°C) |
| `Humidity` | Humidity (%) |
| `WindSpeed` | Wind speed (m/s) |
| `Rainfall` | Boolean — whether rain is falling |

### `session.track_status` — status changes

| Status Code | Meaning |
|---|---|
| `"1"` | Green / All Clear |
| `"2"` | Yellow Flag |
| `"4"` | Safety Car |
| `"5"` | Red Flag |
| `"6"` | VSC Deployed |
| `"7"` | VSC Ending |

## FastF1 gotchas

These are critical to handle correctly:

1. **`NaT` values everywhere** — `LapTime`, sector times, etc. can be `NaT`. Always check with `pd.notna()` before calling `.total_seconds()`.
2. **Lap 1 is anomalous** — includes standing start time, always much longer than normal. Exclude from pace calculations.
3. **Pit in/out laps are slow** — pit lane speed limit makes them outliers. Exclude from pace analysis.
4. **Safety car laps are slow** — 30-50% slower than racing pace. Cross-reference with track status.
5. **Retired drivers** — their laps DataFrame is shorter than the race distance.
6. **`pd.Timedelta` is not JSON-serializable** — convert to float seconds with `.total_seconds()` before any API response.
7. **Driver codes vs numbers** — always use the three-letter `Driver` abbreviation (`VER`, `NOR`), not car numbers.
