# 002 — CSV Export for Race Data

> Date: 2025-02-16

## What was built

Added the ability to export FastF1 race data as clean CSV files that you can open in pandas, Excel, Jupyter, or any data tool.

## Why

FastF1 caches its data as `.ff1pkl` (pickle) files — a binary Python format that you can't open or inspect directly. To visualize and check the data, we need it in a universal format. CSV is the simplest choice: every tool on earth reads CSV.

## The core problem: Timedelta columns

FastF1 stores times as `pd.Timedelta` objects. For example, a lap time of 1 minute 22.167 seconds looks like this internally:

```python
pd.Timedelta('0 days 00:01:22.167000')
```

If you just call `df.to_csv()`, that raw string is what you get — ugly and unusable for math. We need to convert it to a plain float: `82.167` (seconds).

### The solution: `_make_csv_friendly()`

This helper function walks through every column in a DataFrame and converts types:

```python
def _make_csv_friendly(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_timedelta64_dtype(out[col]):
            # Timedelta → float seconds (NaT → None/NaN)
            out[col] = out[col].apply(
                lambda x: round(x.total_seconds(), 3) if pd.notna(x) else None
            )
        elif pd.api.types.is_datetime64_any_dtype(out[col]):
            # datetime → ISO string
            out[col] = out[col].astype(str).replace("NaT", "")
    return out
```

Key details:

1. **`pd.api.types.is_timedelta64_dtype()`** — checks if a column is Timedelta. This is safer than checking `dtype == 'timedelta64[ns]'` because pandas can have different timedelta precisions.
2. **`.total_seconds()`** — converts Timedelta to a plain float. A time of `1:22.167` becomes `82.167`.
3. **`pd.notna(x)`** — critical check. FastF1 data is full of `NaT` (Not a Time) values — incomplete laps, pit in-laps, retirements. Calling `.total_seconds()` on `NaT` would crash. So we return `None` instead, which becomes an empty cell in CSV.
4. **`round(x, 3)`** — keeps 3 decimal places (millisecond precision, which is what F1 timing uses).
5. **`.copy()`** — we never modify the original DataFrame. Always work on a copy.

### Before and after

| Column | Raw FastF1 | After conversion |
|---|---|---|
| `LapTime` | `0 days 00:01:22.167000` | `82.167` |
| `Sector1Time` | `0 days 00:00:28.451000` | `28.451` |
| `PitInTime` | `NaT` | _(empty)_ |
| `LapStartDate` | `2025-03-16 06:12:33.001` | `2025-03-16 06:12:33.001000` |

## How the export works

### Method: `export_race_to_csv(session)`

1. Determines the output folder from the session metadata:
   ```python
   data/exports/2025/round_01_melbourne/
   ```

2. Collects the 4 key DataFrames from the session:
   - `session.laps` → `laps.csv` (the big one — every lap by every driver)
   - `session.results` → `results.csv` (final classification)
   - `session.weather_data` → `weather.csv` (temperature, humidity, rain)
   - `session.track_status` → `track_status.csv` (safety car, VSC, flags)

3. For each DataFrame:
   - Runs `_make_csv_friendly()` to convert Timedeltas to seconds
   - Calls `.to_csv(path, index=False)` — `index=False` avoids writing the row index as a column

4. Logs what was exported.

### CLI flag: `--export`

```bash
uv run f1-data-loader --round 1 --export   # export one race
uv run f1-data-loader --export              # export all races
```

The flag works in combination with `--round` or standalone (exports all after downloading).

## Output structure

```
data/exports/2025/
├── round_01_melbourne/
│   ├── laps.csv          # 927 rows × 31 columns
│   ├── results.csv       # 20 rows
│   ├── weather.csv       # 178 rows
│   └── track_status.csv  # 20 rows
├── round_02_shanghai/
│   └── ...
└── round_24_yas_island/
    └── ...
```

## What's in each CSV

### `laps.csv` — the most important one

927 rows for the Australian GP (approximately `num_drivers × num_laps`; less for retired drivers).

Key columns:
- `Driver` — three-letter code (`VER`, `NOR`, `HAM`)
- `LapNumber` — 1-indexed
- `LapTime` — **float seconds** (e.g. `82.167`). `NaN` for incomplete laps
- `Sector1Time`, `Sector2Time`, `Sector3Time` — sector times in seconds
- `Compound` — tyre type (`SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET`)
- `TyreLife` — laps on current tyre set
- `Position` — position at end of this lap
- `Stint` — stint number (increments at each pit stop)
- `PitInTime`, `PitOutTime` — pit lane entry/exit times in seconds (NaN if no pit)

### `results.csv`

20 rows (one per driver). Final classification: driver code, name, team, finishing position, grid position, status (Finished/Retired/+1 Lap).

### `weather.csv`

Sampled every few seconds during the race. Air temp, track temp, humidity, wind speed, rainfall.

### `track_status.csv`

One row per status change: green flag, yellow flag, safety car, VSC, red flag.

## How to use the CSVs in pandas

```python
import pandas as pd

# Load laps
laps = pd.read_csv("data/exports/2025/round_01_melbourne/laps.csv")

# Verstappen's lap times (excluding lap 1 which is always slow)
ver = laps[(laps["Driver"] == "VER") & (laps["LapNumber"] > 1)]
print(ver[["LapNumber", "LapTime", "Compound", "Position"]].head(10))

# Average pace per compound
laps_clean = laps[laps["LapTime"].notna() & (laps["LapNumber"] > 1)]
print(laps_clean.groupby("Compound")["LapTime"].mean().sort_values())

# Pit stop laps (where stint changes)
laps_sorted = laps.sort_values(["Driver", "LapNumber"])
laps_sorted["PrevStint"] = laps_sorted.groupby("Driver")["Stint"].shift(1)
pit_laps = laps_sorted[laps_sorted["Stint"] != laps_sorted["PrevStint"]].dropna(subset=["PrevStint"])
print(pit_laps[["Driver", "LapNumber", "Compound"]])
```

## Gitignore

The CSVs are automatically gitignored — the existing rule `data/**/*.csv` in `.gitignore` covers them. They're derived data that anyone can regenerate with `uv run f1-data-loader --export`.

## Files changed

| File | Change |
|---|---|
| `src/data_loader.py` | Added `_make_csv_friendly()` helper, `export_race_to_csv()`, `export_all_races_to_csv()`, `--export` CLI flag |
