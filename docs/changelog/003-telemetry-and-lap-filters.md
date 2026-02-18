# 003 — Per-Lap Telemetry & Smart Lap Filters

> Date: 2025-02-18

## What was built

Two new feature groups added to `F1DataLoader`:

1. **Per-lap telemetry merging** — get the full merged telemetry (car + GPS + computed fields) for any specific lap
2. **Smart lap filtering** — use FastF1's built-in filters to isolate clean/representative laps from noisy data

## Why

### Per-lap telemetry

The raw `car_data` and `pos_data` (exported with `--telemetry`) are separate datasets with different sampling rates. FastF1 can **merge** them for a specific lap via `lap.get_telemetry()`, which:
- Aligns the timestamps between car telemetry and GPS data
- Interpolates to a common timeline
- Computes 4 extra columns that don't exist in either raw source:

| Column | What it adds |
|---|---|
| `Distance` | Meters traveled from the start of the lap |
| `RelativeDistance` | 0.0 to 1.0 — fraction of the lap completed |
| `DriverAhead` | Three-letter code of the car directly ahead |
| `DistanceToDriverAhead` | Gap in meters to the car in front |

These are essential for speed trace comparisons, racing line analysis, and overtake detection.

### Smart lap filtering

Raw lap data contains a lot of noise: pit in/out laps are slow (pit lane speed limit), lap 1 includes grid-to-line time, safety car laps are 30-50% slower than racing pace, and some laps have interpolated timing.

Without filtering, any pace analysis is skewed. FastF1 provides built-in filters that handle all these cases, and we now expose them as convenient methods.

## Per-lap telemetry methods

### `get_lap_telemetry(session, driver_code, lap_number)`

Returns merged telemetry for a single lap — 640 rows × 20 columns.

```python
tel = loader.get_lap_telemetry(session, "VER", 43)
# 640 rows with Speed, Throttle, Brake, DRS, X, Y, Z,
# Distance, RelativeDistance, DriverAhead, DistanceToDriverAhead
```

### `get_driver_telemetry(session, driver_code, laps=None)`

Returns merged telemetry for all (or specific) laps of a driver, concatenated into a single DataFrame. Each row is tagged with `Driver` and `LapNumber`.

```python
# All laps
tel_all = loader.get_driver_telemetry(session, "VER")

# Specific laps only
tel_subset = loader.get_driver_telemetry(session, "VER", laps=[42, 43, 44])
```

### `export_lap_telemetry(session, driver_code, lap_number)`

Exports a single lap's telemetry to CSV:
```
telemetry/VER_lap43.csv  (640 rows)
```

### `export_driver_telemetry(session, driver_code, laps=None)`

Exports all (or specific) laps for a driver to a single CSV:
```
telemetry/VER_all_laps.csv  (4 laps, 3268 rows)
```

## Smart lap filter methods

All filters accept an optional `driver_code` parameter. Without it, they apply to all drivers.

| Method | What it filters | Round 1 example |
|---|---|---|
| `get_quicklaps()` | Only representative fast laps — excludes pit, SC, lap 1, outliers | 38 of 927 (4.1%) |
| `get_clean_laps()` | Removes pit in-laps and out-laps only | 795 of 927 (85.8%) |
| `get_accurate_laps()` | Only laps with reliable timing data (not interpolated) | 568 of 927 (61.3%) |
| `get_laps_by_compound(compound)` | Only laps on a specific tyre: `SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET` | INTER: 750, HARD: 92 |
| `get_green_flag_laps()` | Only green flag laps (no SC, VSC, yellow, red) | 557 of 927 (60.1%) |
| `get_box_laps()` | Only pit in-laps and out-laps | 132 of 927 (14.2%) |
| `get_valid_laps()` | Only laps not deleted for track limits | 921 of 927 (99.4%) |
| `print_lap_filter_summary()` | Prints a formatted table of all filters and their counts | — |

### Usage examples

```python
loader = F1DataLoader(year=2025)
session = loader.load_race(1)

# Representative pace for Verstappen
quick = loader.get_quicklaps(session, "VER")
print(f"Avg pace: {quick['LapTimeSeconds'].mean():.3f}s")

# Compare compound performance across all drivers
soft = loader.get_laps_by_compound(session, "SOFT")
medium = loader.get_laps_by_compound(session, "MEDIUM")
hard = loader.get_laps_by_compound(session, "HARD")

# Accurate green-flag laps only (strictest filter combination)
clean = loader.get_accurate_laps(session, "NOR")
green_clean = clean[clean["TrackStatus"] == "1"]

# Print the filter summary table
loader.print_lap_filter_summary(session)
```

### How `pick_quicklaps()` works internally

FastF1's `pick_quicklaps()` uses a **threshold-based filter**:
1. Finds the fastest lap in the session
2. Calculates a threshold: `fastest × 1.07` (107% rule, like qualifying)
3. Keeps only laps faster than the threshold
4. Also excludes laps where `LapTime` is `NaT`

This is why only 38 of 927 laps pass — the Australian GP was a rain race with many safety car laps and compound changes, so most laps were well over 107% of the fastest.

## CLI integration

All features are accessible from the command line:

```bash
# Merged telemetry
uv run f1-data-loader --round 1 --merged-telemetry                        # all drivers
uv run f1-data-loader --round 1 --merged-telemetry --driver VER           # one driver
uv run f1-data-loader --round 1 --merged-telemetry --driver VER --lap 43  # single lap

# Lap filtering
uv run f1-data-loader --round 1 --filter-summary                          # stats table
uv run f1-data-loader --round 1 --filter quick --driver VER               # show count
uv run f1-data-loader --round 1 --filter quick --export                   # export to CSV
uv run f1-data-loader --round 1 --filter compound --compound HARD         # by tyre
```

New CLI flags: `--merged-telemetry`, `--driver`, `--lap`, `--filter`, `--compound`, `--filter-summary`.

Validation rules:
- `--lap` requires `--driver` and `--merged-telemetry`
- `--filter compound` requires `--compound`

## Files changed

| File | Change |
|---|---|
| `src/data_loader.py` | Added 13 new methods: 4 telemetry, 7 filtering, 1 summary printer, 3 CLI helpers (`export_merged_telemetry`, `apply_lap_filter`, `export_filtered_laps`). Rewrote CLI with 6 new flags. |
| `docs/guides/cli-reference.md` | Updated with all new flags, filter types, examples, and output structure |
