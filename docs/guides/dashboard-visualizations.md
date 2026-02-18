# How the Dashboard Visualizations Work

> Last updated: 2025-02-18
>
> This document explains, chart by chart, how each visualization in the Streamlit dashboard is built from raw CSV data. It covers the pandas operation, the Plotly chart type, and the F1 insight each one reveals.

---

## The Core Idea

Every visualization follows the same three-step pattern:

```
1. LOAD    →  Read a DataFrame (laps.csv, weather.csv, telemetry, etc.)
2. TRANSFORM  →  pandas operations: filter, group, aggregate, compute new columns
3. RENDER  →  Map columns to Plotly chart axes (x, y, color, size, hover)
```

The "magic" is step 2 — choosing the right pandas operation to turn raw rows into insight.

---

## Page 1: Overview

### Grid vs Finish Position (Bar Chart)

**What you see**: A bar per driver showing how many positions they gained or lost.

**The data**:

```
results.csv:
  Abbreviation  GridPosition  Position
  NOR           1             1
  VER           3             2
  RUS           5             3
  ANT           8             4         ← gained 4 positions
```

**The pandas operation**:

```python
results["Positions Gained"] = results["GridPosition"] - results["Position"]
```

That's it. One subtraction per driver. `GridPosition 8 - Position 4 = +4` means ANT gained 4 places.

**The Plotly chart**:

```python
go.Bar(x=[driver], y=[positions_gained], marker_color=team_color)
```

Each driver gets a bar. Height = positions gained. Positive = good race. Negative = lost places. Color = team.

**F1 insight**: Instantly reveals who had a great race start, who benefited from strategy, and who lost out.

---

### Weather Timeline (Line Chart)

**What you see**: Air temp and track temp over the race duration.

**The data**:

```
weather.csv:
  Time       AirTemp  TrackTemp  Humidity  Rainfall
  1234.5     18.3     22.1       72.0      True
  1264.8     18.2     21.9       73.0      True
  ...
```

**The pandas operation**:

```python
# Convert session time from seconds to minutes for readable x-axis
weather["Time"] = weather["Time"].dt.total_seconds() / 60
```

**The Plotly chart**:

```python
go.Scatter(x=weather["Time"], y=weather["AirTemp"], name="Air Temp")
go.Scatter(x=weather["Time"], y=weather["TrackTemp"], name="Track Temp")
```

Two line traces on the same figure. x = session time in minutes, y = temperature.

**F1 insight**: Track temp affects tyre grip and degradation. A sudden drop in track temp (rain) explains why everyone pitted for intermediates.

---

## Page 2: Standings & Gaps

### Standings at Any Lap (Computed from laps.csv)

**What you see**: A ranked list of drivers with their gap to the leader, at any lap you select with the slider.

**The data**:

```
laps.csv (filtered to LapNumber == 43):
  Driver  Position  Time(seconds)
  NOR     1         6087.123       ← leader
  PIA     2         6089.895
  VER     3         6090.860
```

**The pandas operation**:

```python
# Filter to the selected lap
lap_data = laps[laps["LapNumber"] == selected_lap]

# Sort by position
lap_data = lap_data.sort_values("Position")

# Compute gap: each driver's cumulative time minus the leader's
leader_time = lap_data.iloc[0]["Time"]
lap_data["Gap"] = lap_data["Time"] - leader_time

# Result: NOR +0.000s, PIA +2.772s, VER +3.737s
```

**Key concept**: The `Time` column in `laps.csv` is the **cumulative session time** when the driver crossed the start/finish line on that lap. It's NOT the lap time — it's the total elapsed time. So subtracting the leader's time gives you the gap.

**F1 insight**: This is how the TV timing tower works. The gap tells you how close a battle is. Under 1 second = DRS range.

---

### Position History (Multi-Line Chart)

**What you see**: One line per driver showing their position (P1, P2, ...) over every lap.

**The pandas operation**:

```python
for driver in selected_drivers:
    d_laps = laps[laps["Driver"] == driver].sort_values("LapNumber")
    # x = LapNumber, y = Position
```

No transformation needed — just filter and plot directly.

**The Plotly chart**:

```python
go.Scatter(x=d_laps["LapNumber"], y=d_laps["Position"],
           mode="lines+markers", name=driver)

# Invert y-axis so P1 is at the top
fig.update_layout(yaxis=dict(autorange="reversed"))
```

**Important detail**: `autorange="reversed"` flips the y-axis so position 1 is at the top. Without this, the leader would be at the bottom.

**F1 insight**: Crossing lines = overtakes. A sudden position drop for many drivers at the same lap = pit stop window or safety car.

---

### Gap to Leader Over Race (Line Chart)

**What you see**: How each driver's gap to the leader evolved lap by lap.

**The pandas operation**:

```python
for each driver:
    for each lap:
        # Find the leader's time at this lap
        all_drivers_this_lap = laps[laps["LapNumber"] == lap_num]
        leader_time = all_drivers_this_lap["Time"].min()  # smallest time = leader

        # This driver's gap
        gap = driver_time_at_this_lap - leader_time
```

**Key concept**: At every lap, we find the driver with the smallest cumulative time (the leader) and compute everyone else's gap. This is an O(drivers × laps) operation — roughly 20 × 57 = 1,140 lookups.

**F1 insight**: A growing gap means one driver is faster. A collapsing gap means a chase. A sudden spike = pit stop (driver falls behind during pit). A flat line for everyone = safety car (everyone bunched up).

---

## Page 3: Strategy

### Tyre Strategy Timeline (Stacked Horizontal Bar)

**What you see**: One horizontal row per driver. Coloured segments represent stints on different tyre compounds.

**The pandas operation**:

```python
for driver in all_drivers:
    d_laps = laps[laps["Driver"] == driver]

    for stint_num, stint_group in d_laps.groupby("Stint"):
        compound = stint_group["Compound"].iloc[0]    # "INTERMEDIATE", "MEDIUM", etc.
        start_lap = stint_group["LapNumber"].min()     # first lap of this stint
        end_lap = stint_group["LapNumber"].max()       # last lap of this stint
        duration = end_lap - start_lap + 1             # how many laps
```

**The key pandas concept**: `groupby("Stint")`. The `Stint` column increments by 1 every time the driver pits. So grouping by it gives you each continuous run on a tyre set.

**The Plotly chart**:

```python
go.Bar(
    y=[driver],                    # which row (driver name)
    x=[duration],                  # width (number of laps)
    base=[start_lap - 1],          # where the segment starts
    orientation="h",               # horizontal bar
    marker_color=COMPOUND_COLORS[compound]  # red=soft, yellow=medium, etc.
)
```

The `base` parameter is the trick — it positions each bar segment at the correct lap number along the x-axis, creating a Gantt-chart effect.

**F1 insight**: Compare strategies at a glance. Long stints = conservative. Short stints = aggressive. If one driver pits earlier than their rival and comes out ahead, they pulled off an undercut.

---

### Tyre Degradation (Scatter+Line)

**What you see**: Lap time vs tyre life, with one line per stint. An upward slope means degradation.

**The pandas operation**:

```python
d_laps = laps[laps["Driver"] == driver].sort_values("LapNumber")

# Remove noise: exclude lap 1 and NaN lap times
clean = d_laps[(d_laps["LapTimeSeconds"].notna()) & (d_laps["LapNumber"] > 1)]

# Group by stint — each stint is a separate degradation curve
for stint_num, group in clean.groupby("Stint"):
    compound = group["Compound"].iloc[0]
    # x = TyreLife (laps on this tyre set)
    # y = LapTimeSeconds (how fast the lap was)
```

**Key concept**: `TyreLife` is NOT the same as `LapNumber`. TyreLife resets to 1 after each pit stop. So if a driver pits on lap 30, lap 31 has TyreLife=1. This gives each stint its own x-axis starting from 1.

**F1 insight**: The slope is the degradation rate. Steep slope = tyres falling off quickly → need to pit soon. Flat line = tyres holding up → can stay out longer. Comparing slopes between compounds tells you which tyre worked better at this track.

---

## Page 4: Pace Analysis

### Lap Times with Filters (Scatter+Line)

**What you see**: Lap times for selected drivers, optionally filtered to show only clean/representative laps.

**The pandas operation (filtering)**:

```python
# "Quick laps" filter — the most commonly used
quick = session.laps.pick_quicklaps()
# Internally: keeps laps where LapTime < 1.07 × fastest_lap
# This removes: pit laps, safety car laps, lap 1, outliers

# "Green flag" filter
green = session.laps.pick_track_status("1")
# Internally: keeps only laps where TrackStatus == "1" (green)
```

**Without filter**: 927 laps with massive scatter (80s to 180s due to SC, pits, rain).
**With "quick" filter**: 38 clean laps — you can now see the actual pace.

**F1 insight**: Filters are essential because raw F1 data is noisy. A pit out-lap is 30+ seconds slower than a racing lap. A safety car lap is 40+ seconds slower. Without filtering, any average or comparison is meaningless.

---

### Pace by Compound (Box Plot)

**What you see**: One box per tyre compound showing the distribution of lap times.

**The pandas operation**:

```python
quick_laps = loader.get_quicklaps(session)  # representative laps only

for compound in quick_laps["Compound"].unique():
    subset = quick_laps[quick_laps["Compound"] == compound]
    # Box plot of subset["LapTimeSeconds"]
```

**The Plotly chart**:

```python
go.Box(y=subset["LapTimeSeconds"], name=compound, boxmean=True)
```

A box plot shows: median (line), interquartile range (box), whiskers (range), and mean (dashed line when `boxmean=True`).

**F1 insight**: Softs should be fastest (lowest box), hards slowest (highest box). The box width (variance) tells you consistency. If intermediates have a huge box, conditions were changing and lap times varied wildly.

---

### Sector Times Comparison (Grouped Bar)

**What you see**: Three grouped bars (S1, S2, S3) per driver, showing average sector time.

**The pandas operation**:

```python
quick = loader.get_quicklaps(session)

# Convert sector times to seconds
for col in ["Sector1Time", "Sector2Time", "Sector3Time"]:
    quick[col] = quick[col].dt.total_seconds()

# Group by driver, compute mean of each sector
sector_data = quick[quick["Driver"].isin(selected_drivers)].groupby("Driver")[sector_cols].mean()

# Result:
#         Sector1  Sector2  Sector3
# NOR     28.5     17.2     36.4
# VER     28.8     17.1     36.7
```

**Key concept**: `groupby("Driver").mean()` collapses many laps per driver into a single average per sector. Using quick laps only ensures the average isn't skewed by pit/SC laps.

**F1 insight**: Shows where each driver is strong. "VER is faster in S2 (the twisty section) but NOR is faster in S3 (the long straight)" → VER has better mechanical grip, NOR has a top-speed advantage.

---

## Page 5: Telemetry

### Full Telemetry Panel (4-Row Subplot)

**What you see**: Speed, throttle, brake, and gear traces plotted against distance around the lap.

**The data**: This uses **merged per-lap telemetry** — `get_lap_telemetry(session, driver, lap)` which returns ~640 rows with all car + GPS data merged.

**The pandas operation**: None! The merged telemetry already has all the columns we need. We just plot them directly.

**The Plotly chart**:

```python
fig = make_subplots(rows=4, cols=1, shared_xaxes=True)

fig.add_trace(go.Scatter(x=tel["Distance"], y=tel["Speed"]),    row=1, col=1)
fig.add_trace(go.Scatter(x=tel["Distance"], y=tel["Throttle"]), row=2, col=1)
fig.add_trace(go.Scatter(x=tel["Distance"], y=tel["Brake"]),    row=3, col=1)
fig.add_trace(go.Scatter(x=tel["Distance"], y=tel["nGear"]),    row=4, col=1)
```

**Key design decision**: x-axis is `Distance` (meters around the lap), not time. This makes the trace spatially meaningful — you can see "at 2,000m (turn 5) the driver brakes" and compare two drivers at the same point on track.

**Key Plotly feature**: `shared_xaxes=True` in `make_subplots` means all 4 panels share the same x-axis. When you zoom into one, they all zoom together. This is critical for correlating: "the speed drops (panel 1) exactly where the brake comes on (panel 3) and the gear drops from 7 to 3 (panel 4)."

**F1 insight**: This is the same view F1 engineers use. You can see braking points, throttle application smoothness, DRS activation zones, and gear selection through corners. Comparing two drivers shows who brakes later, who gets on the power earlier, who carries more speed through corners.

---

### Speed Delta (Filled Line Chart)

**What you see**: The speed difference between two drivers at every point around the lap. Positive = driver A is faster.

**The pandas operation**:

```python
# Merge the two telemetry traces on Distance
merged = pd.merge_asof(
    tel_a[["Distance", "Speed"]].rename(columns={"Speed": "Speed_A"}).sort_values("Distance"),
    tel_b[["Distance", "Speed"]].rename(columns={"Speed": "Speed_B"}).sort_values("Distance"),
    on="Distance",
    direction="nearest",
)
merged["Delta"] = merged["Speed_A"] - merged["Speed_B"]
```

**Key pandas concept**: `merge_asof` is a fuzzy join. Because the two drivers' telemetry samples don't fall at exactly the same distance values, a regular merge wouldn't work. `merge_asof` matches each row from A to the **nearest** row in B by distance. `direction="nearest"` means it picks the closest match on either side.

**The Plotly chart**:

```python
go.Scatter(x=merged["Distance"], y=merged["Delta"], fill="tozeroy")
```

`fill="tozeroy"` shades the area between the line and zero. Green area above = driver A faster. Red area below = driver B faster.

**F1 insight**: Shows exactly where on the track one driver has an advantage. "VER is 15 km/h faster at the end of the main straight (DRS)" vs "NOR carries 8 km/h more through turn 6 (better mechanical balance)."

---

### Gap to Car Ahead (Line Chart)

**What you see**: The physical gap (in meters) to the car directly in front, throughout the lap.

**The data**: The `DistanceToDriverAhead` column from merged telemetry. This is one of the 4 computed columns that only exists in the merged telemetry.

**The pandas operation**: Direct plot — no transformation needed.

**F1 insight**: If the gap closes from 50m to 10m through a corner sequence, the chasing driver is catching through that section. If it opens up on the straight, the car ahead has better straight-line speed. If `DriverAhead` changes mid-lap, an overtake happened.

---

## Page 6: Track Map

### Racing Lines (Scatter on X, Y)

**What you see**: The circuit outline drawn from GPS coordinates, with one coloured line per driver.

**The data**: Merged telemetry's `X` and `Y` columns — these are track-local GPS coordinates.

**The pandas operation**: None — we use the raw X, Y values.

**The Plotly chart**:

```python
go.Scatter(x=tel["X"], y=tel["Y"], mode="lines",
           line=dict(color=team_color, width=3))

# Critical: force equal aspect ratio so the track isn't distorted
fig.update_layout(xaxis=dict(scaleanchor="y", visible=False),
                  yaxis=dict(visible=False))
```

**Key Plotly detail**: `scaleanchor="y"` locks the x and y axes to the same scale. Without this, the circuit would be stretched horizontally or vertically, making turns look wrong.

**F1 insight**: Comparing racing lines reveals cornering technique. Does one driver take a wider entry? A tighter apex? You can see this in the slight divergence of the lines through corners.

---

### Speed Heatmap (Scatter with Color)

**What you see**: The circuit outline where each point is coloured by speed — red/orange at high speed, blue/purple at low speed.

**The pandas operation**: None — direct from telemetry.

**The Plotly chart**:

```python
go.Scatter(
    x=tel["X"], y=tel["Y"],
    mode="markers",
    marker=dict(
        size=4,
        color=tel["Speed"],              # colour mapped to speed
        colorscale="Turbo",              # blue→green→yellow→red spectrum
        cmin=tel["Speed"].quantile(0.05), # ignore extreme outliers
        cmax=tel["Speed"].quantile(0.95),
    ),
)
```

**Key Plotly concept**: Setting `color=tel["Speed"]` with a `colorscale` turns a scatter plot into a heatmap. Each point's colour represents its speed value. The `cmin`/`cmax` based on quantiles (5th and 95th percentile) prevents outliers from washing out the colour range.

**F1 insight**: Immediately shows the fast and slow parts of the circuit. The darkest blue spots are the heaviest braking zones. The brightest red spots are the fastest straights.

---

### Throttle & Brake Zones (Colour-Categorized Scatter)

**What you see**: The circuit drawn with three colours: green (full throttle), red (braking), yellow (coasting).

**The pandas operation**:

```python
# Classify each telemetry point into one of three zones
zone = pd.Series("Coast", index=tel.index)          # default: coasting
zone[tel["Throttle"] > 80] = "Full Throttle"         # >80% throttle = full power
zone[tel["Brake"].astype(int) > 0] = "Braking"       # any brake = braking

# Note: braking overrides throttle (some trail-braking has both)
```

**Key concept**: The classification is simple thresholding. The order matters — braking is checked last so it overrides coasting and throttle. This handles trail-braking (simultaneously on throttle and brake entering a corner).

**F1 insight**: The ratio of green to red is the "power vs braking" character of the circuit. A circuit with lots of red = heavy braking track (street circuit). Lots of green = power-sensitive track (long straights). The yellow coasting zones are often mid-corner where the driver is waiting to get back on the power.

---

## Summary of Techniques Used

| Technique | pandas operation | Where used |
|---|---|---|
| **Simple subtraction** | `col_A - col_B` | Grid vs finish, gap to leader |
| **Filter** | `df[df["Column"] == value]` | Lap filtering, driver selection |
| **GroupBy + aggregate** | `df.groupby("X").mean()` | Sector comparison, stint summary |
| **GroupBy + iterate** | `for key, group in df.groupby("X")` | Strategy timeline, degradation curves |
| **Time-based join** | `pd.merge_asof(A, B, on="Distance")` | Speed delta comparison |
| **Thresholding** | `series > value` | Throttle/brake zone classification |
| **Colour mapping** | `marker=dict(color=series, colorscale=...)` | Speed heatmap |
| **Shared subplots** | `make_subplots(shared_xaxes=True)` | Telemetry panel (4 traces) |
| **Aspect ratio lock** | `xaxis=dict(scaleanchor="y")` | Track map (prevents distortion) |
| **Axis inversion** | `yaxis=dict(autorange="reversed")` | Position chart (P1 at top) |

---

## Plotly Chart Types Cheat Sheet

| Chart | Plotly class | Best for |
|---|---|---|
| Line chart | `go.Scatter(mode="lines")` | Time series (weather, gaps, telemetry) |
| Scatter + line | `go.Scatter(mode="markers+lines")` | Lap times (see individual points + trend) |
| Bar chart | `go.Bar` | Comparisons (sector times, positions gained) |
| Horizontal bar | `go.Bar(orientation="h")` | Gantt/timeline (strategy), rankings (gaps) |
| Box plot | `go.Box` | Distributions (pace by compound, tyre life) |
| Pie / donut | `go.Pie(hole=0.4)` | Proportions (compound usage) |
| Filled area | `go.Scatter(fill="tozeroy")` | Deltas (speed difference, brake zones) |
| Coloured scatter | `go.Scatter(marker=dict(color=..., colorscale=...))` | Heatmaps on track (speed, gear) |
| Multi-panel | `make_subplots(rows=N)` | Correlated traces (speed + throttle + brake + gear) |
