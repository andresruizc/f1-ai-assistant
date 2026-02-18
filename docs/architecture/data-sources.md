# FastF1 Data Sources — Complete Reference

> Last updated: 2025-02-18

## Overview

When you load a race session with FastF1, you get access to **8 raw data sources** plus **2 derived datasets** (merged telemetry and filtered laps). Some are small (20 rows), some are massive (800,000+ rows). Understanding what each one contains is essential for building features on top.

This document covers every data source, its columns, typical size, and what it's useful for.

> **For AI agents**: see also `race-data-guide.md` for cross-referencing patterns, race reconstruction capabilities, and common query templates.

---

## 1. `session.laps` — Lap-by-Lap Race Data

**The single most important data source.** One row per lap per driver.

| | |
|---|---|
| **Typical rows** | ~900 (20 drivers × ~50 laps, minus retirements) |
| **Columns** | 31 |
| **Size as CSV** | ~180 KB |
| **Exported as** | `laps.csv` |

### Columns

| Column | Type | Description |
|---|---|---|
| `Driver` | `str` | Three-letter code: `VER`, `NOR`, `HAM` |
| `DriverNumber` | `str` | Car number: `1`, `4`, `44` |
| `LapNumber` | `int` | 1-indexed lap number |
| `LapTime` | `float` (seconds) | Total lap time. `NaN` if incomplete (pit in-lap, retirement) |
| `Sector1Time` | `float` (seconds) | Sector 1 time |
| `Sector2Time` | `float` (seconds) | Sector 2 time |
| `Sector3Time` | `float` (seconds) | Sector 3 time |
| `Compound` | `str` | `SOFT`, `MEDIUM`, `HARD`, `INTERMEDIATE`, `WET` |
| `TyreLife` | `float` | Laps on current tyre set (carries over from qualifying if not changed) |
| `Position` | `float` | Position at end of this lap. Can be `NaN` |
| `Stint` | `int` | Stint number — increments at each pit stop (1 = first stint) |
| `PitInTime` | `float` (seconds) | Session time when driver entered pit lane. `NaN` if no pit |
| `PitOutTime` | `float` (seconds) | Session time when driver exited pit lane. `NaN` if no pit |
| `Time` | `float` (seconds) | Session timestamp when the lap was completed |
| `LapStartTime` | `float` (seconds) | Session timestamp when the lap started |
| `LapStartDate` | `datetime` | Absolute timestamp when the lap started |
| `Sector1SessionTime` | `float` (seconds) | Absolute session time at end of sector 1 |
| `Sector2SessionTime` | `float` (seconds) | Absolute session time at end of sector 2 |
| `Sector3SessionTime` | `float` (seconds) | Absolute session time at end of sector 3 |
| `SpeedI1` | `float` | Speed trap at intermediate point 1 (km/h) |
| `SpeedI2` | `float` | Speed trap at intermediate point 2 (km/h) |
| `SpeedFL` | `float` | Speed at finish line (km/h) |
| `SpeedST` | `float` | Speed at longest straight (km/h) |
| `IsPersonalBest` | `bool` | Whether this was the driver's fastest lap so far |
| `FreshTyre` | `bool` | Whether the tyre set was new (not used in prior sessions) |
| `Team` | `str` | Team name |
| `TrackStatus` | `str` | Track status code during the lap |
| `Deleted` | `bool` | Whether the lap time was deleted (track limits) |
| `DeletedReason` | `str` | Reason for deletion |
| `FastF1Generated` | `bool` | Whether FastF1 inferred/generated this data |
| `IsAccurate` | `bool` | Whether FastF1 considers the timing data reliable |

### What it's useful for

- Race standings at any lap
- Lap time analysis and pace comparisons
- Pit stop detection (stint changes)
- Tyre strategy (compound + tyre life per stint)
- Position changes and overtakes

---

## 2. `session.results` — Final Classification

**Final race results.** One row per driver.

| | |
|---|---|
| **Typical rows** | 20 |
| **Columns** | 22 |
| **Size as CSV** | ~5 KB |
| **Exported as** | `results.csv` |

### Key columns

| Column | Description |
|---|---|
| `Abbreviation` | Three-letter driver code |
| `DriverNumber` | Car number |
| `FullName` | Full driver name |
| `TeamName` | Team name |
| `Position` | Final finishing position |
| `GridPosition` | Starting grid position |
| `Status` | `Finished`, `+1 Lap`, `Retired`, `Collision`, etc. |
| `Points` | Championship points scored |
| `Time` | Race time (winner) or gap to winner |
| `ClassifiedPosition` | Official classified position |
| `Q1`, `Q2`, `Q3` | Qualifying times |

### What it's useful for

- Winner/podium identification
- Grid vs finish position comparisons (who gained/lost the most)
- DNF/retirement detection
- Points scoring

---

## 3. `session.weather_data` — Weather Conditions

**Weather samples taken throughout the race.** Sampled every few seconds.

| | |
|---|---|
| **Typical rows** | ~150–200 |
| **Columns** | 8 |
| **Size as CSV** | ~8 KB |
| **Exported as** | `weather.csv` |

### Columns

| Column | Type | Description |
|---|---|---|
| `Time` | `float` (seconds) | Session timestamp |
| `AirTemp` | `float` | Air temperature in °C |
| `TrackTemp` | `float` | Track temperature in °C |
| `Humidity` | `float` | Humidity percentage |
| `Pressure` | `float` | Atmospheric pressure (mbar) |
| `WindSpeed` | `float` | Wind speed in m/s |
| `WindDirection` | `float` | Wind direction in degrees |
| `Rainfall` | `bool` | Whether rain is falling |

### What it's useful for

- Detecting rain onset/cessation (critical for tyre strategy)
- Track temperature trends (affects tyre degradation)
- Contextualizing lap time changes

---

## 4. `session.track_status` — Track Status Changes

**Status changes during the race** — safety car deployments, yellow flags, red flags.

| | |
|---|---|
| **Typical rows** | ~10–30 |
| **Columns** | 3 |
| **Size as CSV** | ~400 B |
| **Exported as** | `track_status.csv` |

### Columns

| Column | Description |
|---|---|
| `Time` | Session timestamp of the status change |
| `Status` | Status code (see table below) |
| `Message` | Human-readable description |

### Status codes

| Code | Meaning |
|---|---|
| `1` | Green / All Clear |
| `2` | Yellow Flag |
| `4` | Safety Car |
| `5` | Red Flag |
| `6` | Virtual Safety Car (VSC) Deployed |
| `7` | VSC Ending |

### What it's useful for

- Identifying safety car periods (affects strategy, lap times, gaps)
- Excluding safety car laps from pace analysis
- Understanding race-changing events

---

## 5. `session.race_control_messages` — Race Control

**Official race control messages** — flags, penalties, DRS, investigations.

| | |
|---|---|
| **Typical rows** | ~100–150 |
| **Columns** | 9 |
| **Size as CSV** | ~9 KB |
| **Exported as** | `race_control_messages.csv` |

### Columns

| Column | Description |
|---|---|
| `Time` | Timestamp of the message |
| `Category` | `Flag`, `Drs`, `SafetyCar`, `Other` |
| `Message` | Full text: `"YELLOW IN TRACK SECTOR 17"`, `"DRS ENABLED"`, etc. |
| `Status` | Status value (e.g. `ENABLED`, `DISABLED`) |
| `Flag` | Flag type: `GREEN`, `YELLOW`, `DOUBLE YELLOW`, `CLEAR`, `CHEQUERED` |
| `Scope` | `Track`, `Sector`, `Driver` |
| `Sector` | Sector number (if scope is Sector) |
| `RacingNumber` | Driver number (if directed at a specific driver) |
| `Lap` | Lap number when message was issued |

### Example messages

```
LOW GRIP CONDITIONS
DRS DISABLED
GREEN LIGHT - PIT EXIT OPEN
YELLOW IN TRACK SECTOR 17
DOUBLE YELLOW IN TRACK SECTOR 10
PIT EXIT CLOSED
DRS ENABLED
```

### What it's useful for

- DRS availability tracking
- Flag incidents per sector
- Penalty and investigation tracking
- More granular context than track_status alone

---

## 6. `session.get_circuit_info()` — Circuit Layout

**Corner positions and track geometry.**

| | |
|---|---|
| **Typical rows** | 10–20 (one per corner) |
| **Columns** | 6 + rotation value |
| **Size as CSV** | ~1 KB |
| **Exported as** | `circuit_info.csv` |

### Columns

| Column | Description |
|---|---|
| `X` | Corner X coordinate (track-local) |
| `Y` | Corner Y coordinate (track-local) |
| `Number` | Corner number (1, 2, 3...) |
| `Letter` | Corner letter suffix (if any) |
| `Angle` | Corner angle in degrees |
| `Distance` | Distance from start/finish line (meters) |
| `Rotation` | Suggested rotation angle for track display (same for all rows) |

### What it's useful for

- Track map visualisation
- Sector analysis (which corners are in which sector)
- Understanding circuit characteristics

---

## 7. `session.car_data` — Car Telemetry

**High-frequency telemetry from each car.** Sampled at ~3.7 Hz (~every 270ms).

| | |
|---|---|
| **Typical rows** | ~768,000 total (~38,000 per driver × 20 drivers) |
| **Columns** | 10 |
| **Size as CSV** | ~52 MB total (~2.6 MB per driver) |
| **Exported as** | `car_data/VER.csv`, `car_data/NOR.csv`, etc. |
| **Requires** | `--telemetry` flag |

### Columns

| Column | Type | Description |
|---|---|---|
| `Date` | `datetime` | Absolute timestamp |
| `Time` | `float` (seconds) | Time relative to lap start |
| `SessionTime` | `float` (seconds) | Time relative to session start |
| `RPM` | `float` | Engine RPM |
| `Speed` | `float` | Car speed in km/h |
| `nGear` | `int` | Gear number (0 = neutral) |
| `Throttle` | `float` | Throttle position (0–100%) |
| `Brake` | `bool` | Whether brake is applied |
| `DRS` | `int` | DRS status (0 = closed, 1+ = open/activating) |
| `Source` | `str` | Data source (`car` = from car, `interpolation` = estimated) |

### What it's useful for

- Speed traces through corners
- Braking point comparisons between drivers
- Throttle application analysis
- DRS usage tracking
- Identifying driver errors or off-track moments

---

## 8. `session.pos_data` — GPS Position Data

**GPS position of each car at ~3.7 Hz.**

| | |
|---|---|
| **Typical rows** | ~791,000 total (~39,500 per driver × 20 drivers) |
| **Columns** | 8 |
| **Size as CSV** | ~55 MB total (~2.8 MB per driver) |
| **Exported as** | `pos_data/VER.csv`, `pos_data/NOR.csv`, etc. |
| **Requires** | `--telemetry` flag |

### Columns

| Column | Type | Description |
|---|---|---|
| `Date` | `datetime` | Absolute timestamp |
| `Time` | `float` (seconds) | Time relative to lap start |
| `SessionTime` | `float` (seconds) | Time relative to session start |
| `Status` | `str` | `OnTrack`, `OffTrack` |
| `X` | `float` | X coordinate (track-local) |
| `Y` | `float` | Y coordinate (track-local) |
| `Z` | `float` | Z coordinate (elevation) |
| `Source` | `str` | `pos` = from positioning system |

### What it's useful for

- Plotting car positions on the track map
- Racing line analysis
- Overtake visualisation (where on track did it happen)
- Off-track detection

---

## 9. Merged Per-Lap Telemetry (Derived)

**`car_data` + `pos_data` merged per lap** via FastF1's `lap.get_telemetry()`. This combines both raw telemetry sources using time-based interpolation and computes 4 extra columns that don't exist in either.

| | |
|---|---|
| **Typical rows** | ~640 per lap, ~46,000 per driver, ~920,000 for all drivers |
| **Columns** | 20 |
| **Size as CSV** | ~9 MB per driver, ~180 MB for all drivers |
| **Exported as** | `telemetry/{DRIVER}_all_laps.csv` or `telemetry/{DRIVER}_lap{NN}.csv` |
| **Requires** | `--merged-telemetry` flag |

### How the merge works

1. Both datasets are sliced to the lap's time window (`LapStartDate` to `LapStartDate + LapTime`)
2. `car_data` timestamps are used as the base (higher frequency: ~3.7 Hz)
3. `pos_data` values (X, Y, Z) are **linearly interpolated** onto the `car_data` timestamps
4. Four derived columns are computed from the merged result

### Columns (all 20)

| Column | Source | Type | Description |
|---|---|---|---|
| `Date` | both | datetime | Absolute wall-clock time |
| `SessionTime` | both | float (seconds) | Time since session start |
| `Time` | car_data | float (seconds) | Time relative to lap start |
| `RPM` | car_data | float | Engine RPM |
| `Speed` | car_data | float | Car speed in km/h |
| `nGear` | car_data | int | Gear number (0 = neutral) |
| `Throttle` | car_data | float | Throttle position (0–100%) |
| `Brake` | car_data | bool | Whether brake is applied |
| `DRS` | car_data | int | DRS status (0 = closed, 1+ = open) |
| `Source` | both | str | `car`, `pos`, or `interpolation` |
| `X` | pos_data | float | X coordinate (track-local, interpolated) |
| `Y` | pos_data | float | Y coordinate (track-local, interpolated) |
| `Z` | pos_data | float | Z coordinate (elevation, interpolated) |
| `Status` | pos_data | str | `OnTrack` or `OffTrack` |
| `Distance` | **computed** | float | Meters traveled from lap start (integrated from speed) |
| `RelativeDistance` | **computed** | float | 0.0 to 1.0 fraction of lap completed |
| `DriverAhead` | **computed** | str | Three-letter code of car directly ahead on track |
| `DistanceToDriverAhead` | **computed** | float | Gap in meters to the car in front |
| `Driver` | added | str | Driver code (added by export) |
| `LapNumber` | added | int | Lap number (added by export) |

### What it's useful for

- Speed trace comparisons between drivers through specific corners
- Braking point analysis (where `Brake` goes True relative to `Distance`)
- Racing line comparison (X, Y overlaid on circuit map)
- Overtake detection (where `DriverAhead` changes)
- DRS effectiveness (speed delta with `DRS` on vs off)
- Gap tracking at sub-lap resolution (`DistanceToDriverAhead`)

---

## 10. Filtered Laps (Derived)

**Subsets of `laps.csv`** filtered by quality criteria. Same columns as laps, pre-filtered.

| | |
|---|---|
| **Typical rows** | 38–921 depending on filter |
| **Columns** | 32 (same as laps + `LapTimeSeconds`) |
| **Size as CSV** | <1 MB |
| **Exported as** | `laps_filtered_{type}.csv` or `laps_filtered_{DRIVER}_{type}.csv` |
| **Requires** | `--filter {type} --export` flags |

### Available filters

| Filter | What it keeps | Round 1 example |
|---|---|---|
| `quick` | Representative fast laps only (within 107% of fastest) | 38 / 927 (4.1%) |
| `clean` | All laps except pit in-laps and out-laps | 795 / 927 (85.8%) |
| `accurate` | Only laps with reliable (non-interpolated) timing | 568 / 927 (61.3%) |
| `green` | Only green-flag laps (no SC, VSC, yellow, red) | 557 / 927 (60.1%) |
| `box` | Only pit in-laps and out-laps | 132 / 927 (14.2%) |
| `valid` | Only laps not deleted for track limits | 921 / 927 (99.4%) |
| `compound` | Only laps on a specific tyre compound | varies |

### What it's useful for

- Clean pace analysis without noise from pit/SC/outlier laps
- Compound-specific performance comparisons
- Representative lap time averages for driver ranking

---

## Size Summary (per race)

| Data Source | Rows | CSV Size | Export flag |
|---|---|---|---|
| `laps.csv` | ~900 | ~180 KB | `--export` |
| `results.csv` | 20 | ~5 KB | `--export` |
| `weather.csv` | ~178 | ~8 KB | `--export` |
| `track_status.csv` | ~20 | ~400 B | `--export` |
| `race_control_messages.csv` | ~113 | ~9 KB | `--export` |
| `circuit_info.csv` | ~14 | ~1 KB | `--export` |
| `car_data/` (20 drivers) | ~768,000 | ~52 MB | `--export --telemetry` |
| `pos_data/` (20 drivers) | ~791,000 | ~55 MB | `--export --telemetry` |
| `telemetry/` (20 drivers) | ~920,000 | ~180 MB | `--merged-telemetry` |
| Filtered laps | 38–921 | <1 MB | `--filter --export` |
| **Total (core only)** | | **~200 KB** | |
| **Total (with raw telemetry)** | | **~108 MB** | |
| **Total (with merged telemetry)** | | **~288 MB** | |
| **Full season (everything)** | | **~6.8 GB** | |
