# Race Data Intelligence Guide

> Last updated: 2025-02-18
>
> **Audience**: AI agents and developers building insights, visualisations, and analysis features on top of F1 race data. This document describes what data is available, how datasets relate to each other, what questions can be answered, and the practical limitations.

---

## Data Inventory

We have **10 distinct datasets** for every race. They fall into three tiers based on granularity:

### Tier 1 — Lap-level (one row per driver per lap)

| Dataset | File | Rows per race | Key columns |
|---|---|---|---|
| **Laps** | `laps.csv` | ~900 | `Driver`, `LapNumber`, `LapTime`, `Position`, `Compound`, `Stint`, `Sector1/2/3Time`, `TrackStatus` |
| **Filtered laps** | `laps_filtered_*.csv` | varies | Same as laps, but pre-filtered by quality criteria |

### Tier 2 — Event/session-level (one row per event or per driver)

| Dataset | File | Rows per race | Key columns |
|---|---|---|---|
| **Results** | `results.csv` | 20 | `Abbreviation`, `Position`, `GridPosition`, `Status`, `Points`, `Time` |
| **Weather** | `weather.csv` | ~178 | `AirTemp`, `TrackTemp`, `Humidity`, `Rainfall`, `WindSpeed` |
| **Track status** | `track_status.csv` | ~20 | `Status` (1=green, 2=yellow, 4=SC, 5=red, 6=VSC, 7=VSC ending) |
| **Race control** | `race_control_messages.csv` | ~113 | `Category`, `Message`, `Flag`, `Scope`, `Sector`, `Lap` |
| **Circuit info** | `circuit_info.csv` | ~14 | `X`, `Y`, `Number`, `Angle`, `Distance`, `Rotation` |

### Tier 3 — High-frequency telemetry (~2-4 Hz, hundreds of thousands of rows)

| Dataset | File | Rows per driver | Key columns |
|---|---|---|---|
| **Car telemetry** | `car_data/{DRIVER}.csv` | ~38,000 | `Speed`, `RPM`, `Throttle`, `Brake`, `nGear`, `DRS` |
| **GPS position** | `pos_data/{DRIVER}.csv` | ~39,500 | `X`, `Y`, `Z`, `Status` (OnTrack/OffTrack) |
| **Merged telemetry** | `telemetry/{DRIVER}_all_laps.csv` | ~46,000 | All car + GPS columns plus `Distance`, `RelativeDistance`, `DriverAhead`, `DistanceToDriverAhead`, `LapNumber` |

---

## How Datasets Relate to Each Other

### The time axis

Every dataset has a time reference, but the column names and formats differ:

| Dataset | Time column | Format | What it represents |
|---|---|---|---|
| `laps.csv` | `Time` | float seconds | Cumulative session time at lap completion |
| `laps.csv` | `LapStartTime` | float seconds | Session time when the lap began |
| `laps.csv` | `LapStartDate` | ISO datetime | Absolute wall-clock time when the lap began |
| `weather.csv` | `Time` | float seconds | Session time of the weather sample |
| `track_status.csv` | `Time` | float seconds | Session time of the status change |
| `race_control_messages.csv` | `Time` | ISO datetime | Absolute wall-clock time |
| `car_data/*.csv` | `SessionTime` | float seconds | Session time of the telemetry sample |
| `pos_data/*.csv` | `SessionTime` | float seconds | Session time of the GPS sample |
| `telemetry/*.csv` | `SessionTime` | float seconds | Session time of the merged sample |

**To cross-reference**: use session time (float seconds) as the common axis. For example, to find the weather at the time VER completed lap 30, find the `weather.csv` row with `Time` closest to VER's `Time` value on lap 30 in `laps.csv`.

### The driver axis

| Dataset | Driver identifier | Format |
|---|---|---|
| `laps.csv` | `Driver` | Three-letter code (`VER`, `NOR`) |
| `laps.csv` | `DriverNumber` | Car number as string (`1`, `4`) |
| `results.csv` | `Abbreviation` | Three-letter code |
| `results.csv` | `DriverNumber` | Car number |
| `car_data/` | filename | `{CODE}.csv` |
| `pos_data/` | filename | `{CODE}.csv` |
| `telemetry/` | filename | `{CODE}_all_laps.csv` or `{CODE}_lap{NN}.csv` |
| `race_control_messages.csv` | `RacingNumber` | Car number (only for driver-specific messages) |

**To cross-reference**: use the three-letter driver code as the primary key. Map between code and number via `results.csv`.

### Entity-relationship summary

```
results.csv (1 per driver)
  │
  ├── laps.csv (N laps per driver)
  │     │
  │     ├── car_data/{DRIVER}.csv (M samples per lap, via SessionTime range)
  │     ├── pos_data/{DRIVER}.csv (M samples per lap, via SessionTime range)
  │     └── telemetry/{DRIVER}_all_laps.csv (M samples per lap, via LapNumber)
  │
  ├── weather.csv (time-correlated, not driver-specific)
  ├── track_status.csv (time-correlated, not driver-specific)
  └── race_control_messages.csv (time-correlated, sometimes driver-specific)

circuit_info.csv (static, race-level — corner geometry)
```

---

## Race Reconstruction Capabilities

### What can be fully reconstructed

| Capability | Data source | Granularity | Notes |
|---|---|---|---|
| **Race standings at any lap** | `laps.csv` → `Position` | Per lap | Available for 99%+ of laps. Some NaN on lap 1 for early retirements |
| **Gaps between drivers** | `laps.csv` → `Time` | Per lap | Subtract cumulative session times: `Time_P2 - Time_P1 = gap in seconds` |
| **Overtake detection** | `laps.csv` → `Position` | Per lap | Compare `Position` between consecutive laps: decrease = gained position |
| **Full tyre strategy** | `laps.csv` → `Stint`, `Compound`, `TyreLife`, `FreshTyre` | Per lap | Stint number increments at pit stops. Compound tells you which tyre |
| **Pit stop timing** | `laps.csv` → `PitInTime`, `PitOutTime` | Per stop | `PitOutTime - PitInTime` = stationary + pit lane time |
| **Sector performance** | `laps.csv` → `Sector1/2/3Time` | Per lap | Where time is gained/lost within a lap |
| **Speed traps** | `laps.csv` → `SpeedI1`, `SpeedI2`, `SpeedFL`, `SpeedST` | Per lap | Maximum speeds at specific track points |
| **Weather timeline** | `weather.csv` | ~every 30s | Air/track temp, humidity, rainfall, wind |
| **Track incidents** | `track_status.csv` + `race_control_messages.csv` | Event-based | Safety cars, VSC, red flags, DRS windows, sector flags, penalties |
| **Car position on track** | `pos_data/{DRIVER}.csv` | ~2.2 Hz | X, Y, Z GPS coordinates — can animate all 20 cars |
| **Car behaviour** | `car_data/{DRIVER}.csv` | ~3.7 Hz | Speed, throttle, brake, gear, DRS state |
| **Racing line** | `pos_data` + `circuit_info.csv` | ~2.2 Hz | GPS traces overlaid on corner positions |
| **DNFs and retirements** | `results.csv` → `Status` + `laps.csv` | Per driver | `Status` != "Finished" + last completed lap number |

### What can be inferred (requires computation)

| Insight | Method | Confidence |
|---|---|---|
| **Sub-lap race position** | Cross-reference all drivers' `pos_data` GPS at same `SessionTime` → compute track-order | High (GPS data is dense) |
| **Exact overtake location** | Find where `DriverAhead` changes in merged telemetry, or where GPS positions swap | High |
| **Tyre degradation rate** | Fit linear/polynomial regression to `LapTimeSeconds` over `TyreLife` within a stint | Medium (confounded by fuel, traffic, track evolution) |
| **Fuel effect on pace** | Laps get faster over a stint even on degrading tyres — separate fuel effect from tyre deg | Medium |
| **Undercut/overcut success** | Compare gap before and after a pit stop sequence between two drivers | High |
| **DRS effect on speed** | Compare `Speed` in DRS zone with `DRS` column on vs off | High |
| **Braking consistency** | Standard deviation of braking points (from `Distance` where `Brake` goes True) across laps | High |
| **Driver error detection** | Off-track status in `pos_data`, deleted laps, sudden speed drops | Medium |

### What we CANNOT determine

| Limitation | Why |
|---|---|
| **Exact race position between lap boundaries** | `Position` updates only at lap completion. Can be approximated from GPS but requires computation |
| **Radio messages** | Not available in FastF1 data |
| **Penalty decisions reasoning** | Race control messages give the fact, not the reasoning |
| **Car setup** | Not publicly available |
| **Fuel load** | Not directly measured; can only estimate from lap time trends |
| **Tyre temperature** | Not available in public telemetry |
| **Aerodynamic downforce** | Not directly measurable from available data |

---

## Position Tracking Deep Dive

Position tracking is critical for race reconstruction. Here's exactly what we have at each granularity:

### Lap-level positions (laps.csv)

- **Column**: `Position` (float, 1-indexed)
- **Coverage**: 921 out of 927 laps have position data (99.4%) for Round 1
- **Updates**: position is recorded at the **end** of each lap as the driver crosses the start/finish line
- **Missing data**: some early-lap positions are NaN when drivers retire during lap 1 before completing it

**Computing gaps from laps.csv**:

```python
# Standings at lap 30
lap_30 = laps[laps["LapNumber"] == 30].sort_values("Position")
leader_time = lap_30.iloc[0]["Time"]
lap_30["GapToLeader"] = lap_30["Time"] - leader_time

# Result:
# P1: NOR  +0.000s
# P2: PIA  +2.772s
# P3: VER  +3.737s
```

### High-frequency GPS positions (pos_data)

- **Sampling**: ~2.2 Hz (every ~440ms) per driver
- **Columns**: `X`, `Y`, `Z` in track-local coordinates
- **Coverage**: continuous from session start to retirement/finish
- **Usage**: can place all 20 cars on a track map at any given timestamp

**Computing track order from GPS**:

To determine race positions between lap boundaries, you need to:
1. Pick a `SessionTime` value
2. Find the nearest row for each driver in their `pos_data`
3. Compute each driver's distance along the track (using `circuit_info` reference points)
4. Account for which lap each driver is on (a driver 1 lap ahead is ahead regardless of track position)

### Merged telemetry positions

- **Columns**: `DriverAhead`, `DistanceToDriverAhead`
- **Sampling**: ~3.7 Hz per driver per lap
- **What it tells you**: at every moment during a lap, which car is directly ahead and the gap in meters
- **Limitation**: only shows the car directly in front, not the full field order

---

## Strategy Analysis Reference

### Detecting pit stops

A pit stop occurs when `Stint` increments between consecutive laps for a driver.

```python
# For each driver, find stint transitions
for i in range(1, len(driver_laps)):
    if driver_laps.iloc[i]["Stint"] > driver_laps.iloc[i-1]["Stint"]:
        pit_lap = driver_laps.iloc[i]["LapNumber"]
        old_compound = driver_laps.iloc[i-1]["Compound"]
        new_compound = driver_laps.iloc[i]["Compound"]
```

### Pit stop duration

- `PitInTime`: session time when car entered the pit lane
- `PitOutTime`: session time when car exited the pit lane
- **Total pit time**: `PitOutTime(lap N+1) - PitInTime(lap N)` (includes pit lane drive, stop, and drive-out)
- **Note**: `PitInTime` appears on the in-lap and `PitOutTime` on the out-lap

### Tyre performance windows

| Compound | Typical life (laps) | Pace characteristic |
|---|---|---|
| SOFT | 10-20 | Fast initially, degrades quickly |
| MEDIUM | 20-35 | Balanced pace and durability |
| HARD | 30-50 | Slow initially, very consistent |
| INTERMEDIATE | 20-40 | For damp tracks, overheats on dry |
| WET | N/A | For heavy rain, massive pace deficit on dry |

To measure degradation: plot `LapTimeSeconds` vs `TyreLife` within a single stint, excluding the out-lap and any safety car laps.

---

## Lap Filtering for Clean Analysis

Raw lap data contains significant noise. The following filters are available both programmatically and via CLI:

| Filter | What it removes | When to use |
|---|---|---|
| **quick** | Pit laps, SC laps, lap 1, outliers (>107% of fastest) | Race pace analysis, driver comparisons |
| **clean** | Pit in-laps and out-laps only | Moderate filtering — keeps SC laps and lap 1 |
| **accurate** | Laps with interpolated/estimated timing | When timing precision matters |
| **green** | SC, VSC, yellow, red flag laps | Pure racing pace without neutralisations |
| **box** | Everything except pit laps (inverse filter) | Pit stop analysis |
| **valid** | Deleted laps (track limits) | When track limits matter (qualifying analysis) |
| **compound** | All laps not on specified compound | Compound-specific pace comparison |

### Filter coverage (Round 1 — Australian GP 2025)

| Filter | Laps kept | Percentage | Explanation |
|---|---|---|---|
| All laps | 927 | 100.0% | Raw data |
| Accurate only | 568 | 61.3% | Many laps have interpolated timing in a rain race |
| Without pit in/out | 795 | 85.8% | 132 pit laps removed (6-7 stops per driver) |
| Quick laps | 38 | 4.1% | Very low because of rain/SC — only 38 laps were within 107% of fastest |
| Not deleted | 921 | 99.4% | Only 6 laps deleted for track limits |
| Green flag only | 557 | 60.1% | ~40% of the race was under SC/VSC |
| Pit in/out only | 132 | 14.2% | The inverse of "without pit in/out" |

**Important**: these percentages vary dramatically between races. A dry race with no safety cars will have much higher quick-lap and green-flag percentages.

### Combining filters

Filters can be chained programmatically:

```python
# Strictest: accurate + green flag + no pit laps
clean = loader.get_accurate_laps(session, "VER")
representative = clean[(clean["TrackStatus"] == "1") & clean["PitInTime"].isna() & clean["PitOutTime"].isna()]
```

---

## Merged Telemetry Deep Dive

The merged telemetry is the richest per-lap dataset. It combines `car_data` and `pos_data` via **time-based interpolation** (not a key join).

### How the merge works

1. **Slices both datasets** to the lap's time window (`LapStartDate` to `LapStartDate + LapTime`)
2. **Uses `car_data` timestamps as the base** (higher frequency: ~3.7 Hz)
3. **Linearly interpolates `pos_data`** (X, Y, Z) onto the `car_data` timestamps
4. **Computes 4 derived columns** that exist in neither raw source

### Computed columns

| Column | Type | How it's computed | What it means |
|---|---|---|---|
| `Distance` | float (meters) | Cumulative integral of speed over time | How far the car has traveled from the start of this lap |
| `RelativeDistance` | float (0.0–1.0) | `Distance / total_lap_distance` | Fraction of the lap completed (0.0 = start/finish, 1.0 = next crossing) |
| `DriverAhead` | str | Cross-references all drivers' GPS at each timestamp | Three-letter code of the car directly in front on track |
| `DistanceToDriverAhead` | float (meters) | Track-distance gap to the car ahead | Physical gap — NOT a time gap. Divide by speed for approximate time |

### Typical dimensions

| Metric | Value |
|---|---|
| Rows per lap | ~640 |
| Columns | 20 |
| Rows per driver (full race) | ~46,000 |
| Rows for all 20 drivers | ~920,000 |
| CSV size per driver | ~9 MB |
| CSV size for all drivers | ~180 MB |

### All columns in merged telemetry

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
| `Distance` | computed | float | Meters from lap start |
| `RelativeDistance` | computed | float | 0.0 to 1.0 fraction of lap |
| `DriverAhead` | computed | str | Car directly ahead (three-letter code) |
| `DistanceToDriverAhead` | computed | float | Gap in meters to car ahead |
| `Driver` | added | str | Driver code (added during export) |
| `LapNumber` | added | int | Lap number (added during export) |

---

## Cross-Reference Patterns for AI Agents

These are common patterns an AI agent should use when answering questions about race data.

### "Who was leading at lap N?"

```
laps.csv → filter LapNumber == N → sort by Position → first row
```

### "What was the gap between driver A and driver B at lap N?"

```
laps.csv → filter LapNumber == N, Driver in [A, B]
gap = Time_A - Time_B (positive = A is behind)
```

### "What was the weather when it started raining?"

```
weather.csv → find first row where Rainfall == True
→ get the Time value
→ cross-reference with laps.csv to find which lap that corresponds to
```

### "Why did the safety car come out on lap X?"

```
race_control_messages.csv → filter Lap == X, Category == 'SafetyCar'
→ also check Category == 'Flag' near that time for yellow/double yellow
→ check RacingNumber to see if a specific driver was involved
```

### "How did VER's pace change after pitting?"

```
laps.csv → filter Driver == VER
→ identify stint boundary (where Stint increments)
→ compare LapTime in last 3 laps of old stint vs first 3 laps of new stint
→ also note Compound change
```

### "Where on track did the overtake happen?"

```
telemetry/{DRIVER}_all_laps.csv → filter LapNumber == N
→ find where DriverAhead changes (or DistanceToDriverAhead drops to near-zero)
→ get the X, Y coordinates and Distance at that point
→ cross-reference with circuit_info.csv corners to identify the location
```

### "What was VER's average speed through turn 3?"

```
telemetry/VER_all_laps.csv → filter LapNumber == N
→ circuit_info.csv → find Distance for corner 3 and corner 4
→ filter telemetry where Distance is between corner 3 and corner 4
→ compute mean of Speed column
```

### "Did the rain affect the tyre strategy?"

```
weather.csv → find Rainfall transitions (False → True, True → False)
→ get session times of rain start/end
→ laps.csv → find Compound changes near those times
→ compare whether drivers switched to INTERMEDIATE/WET shortly after rain onset
```

### "Which driver gained the most positions?"

```
results.csv → compute GridPosition - Position for each driver
→ sort descending → highest value = most positions gained
```

### "What's the optimal pit window for a medium tyre?"

```
laps.csv → filter Compound == MEDIUM, use quick-lap filter
→ group by TyreLife → compute mean LapTimeSeconds
→ find the TyreLife where degradation curve steepens (inflection point)
```

---

## Data Quality Notes

These are important for any agent or algorithm processing this data:

1. **Position column can be NaN** — especially on lap 1 for drivers who retire before completing it. Always handle `NaN` in position data.

2. **LapTime can be NaN** — pit in-laps often have no recorded LapTime. Use `Sector1Time + Sector2Time + Sector3Time` as a fallback, or exclude these laps.

3. **Lap 1 is always an outlier** — includes standing start time (grid → line 1). Typically 30-60 seconds slower than a normal lap. Always exclude from pace calculations.

4. **Safety car laps are 30-50% slower** — check `TrackStatus` column or use the `green` filter. SC pace is ~160-180 km/h vs ~310+ km/h racing speed.

5. **Wet races have extreme variance** — the Australian GP 2025 (Round 1) is a rain race. Only 4.1% of laps qualify as "quick" (within 107% of fastest). Dry races typically have 40-60% quick laps.

6. **Timedelta → float conversion** — all exported CSVs have times in float seconds (not `pd.Timedelta`). `NaT` values become empty strings in datetime columns and `NaN` in numeric columns.

7. **Driver retirement** — when a driver retires, their laps stop. The last completed lap is their final entry in `laps.csv`. Check `results.csv` → `Status` for the reason.

8. **Telemetry gaps** — occasionally telemetry has gaps (car in garage, technical issues). The `Source` column shows `interpolation` for estimated values.

9. **Track status vs race control** — `track_status.csv` gives simplified codes (1-7). `race_control_messages.csv` gives detailed per-sector flags, DRS status, and driver-specific messages. Use both together for full context.

10. **Circuit coordinates** — `circuit_info.csv` and `pos_data` use the same coordinate system. The `Rotation` value in `circuit_info.csv` should be applied when rendering the track map so it appears in the conventional TV orientation.

---

## Size Reference

### Per race

| Dataset | Rows | CSV size | Export flag |
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
| Filtered laps (varies) | 38–921 | <1 MB | `--filter --export` |

### Totals

| Scope | Without telemetry | With raw telemetry | With merged telemetry | Everything |
|---|---|---|---|---|
| **1 race** | ~200 KB | ~108 MB | ~180 MB | ~288 MB |
| **24 races** | ~5 MB | ~2.5 GB | ~4.3 GB | ~6.8 GB |
