"""Race replay engine — pre-computes all driver positions on a common time grid.

Optimised for fast frame lookups: positions are stored in a dict keyed by
frame index for O(1) access during animation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from loguru import logger


def _td_to_secs(series: pd.Series) -> pd.Series:
    if pd.api.types.is_timedelta64_dtype(series):
        return series.dt.total_seconds()
    return pd.to_numeric(series, errors="coerce")


def _to_float(val) -> float | None:
    if pd.isna(val):
        return None
    if isinstance(val, pd.Timedelta):
        return val.total_seconds()
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def build_replay_data(
    session,
    sample_interval: float = 2.0,
) -> dict:
    """Pre-compute all driver positions on a common time grid.

    Returns a single ``meta`` dict containing everything needed for replay:
      - frames: dict[int, list[dict]]  — frame_index → list of driver dicts
      - time_grid, race_start, race_end, total_frames
      - track_outline_x, track_outline_y  (rotated)
      - x_range, y_range
      - driver_map, team_map, driver_colors
      - lap_lookup, position_lookup, track_status_lookup
    """
    results = session.results
    laps = session.laps
    pos_data = session.pos_data
    car_data = session.car_data

    driver_map: dict[str, str] = {}
    team_map: dict[str, str] = {}
    for _, row in results.iterrows():
        num = str(row["DriverNumber"])
        code = str(row["Abbreviation"])
        team = str(row.get("TeamName", ""))
        driver_map[num] = code
        team_map[code] = team

    lap_times = laps.copy()
    lap_times["TimeS"] = _td_to_secs(lap_times["Time"])
    lap_times["LapStartTimeS"] = _td_to_secs(lap_times["LapStartTime"])

    race_start = float(lap_times["LapStartTimeS"].min())
    race_end = float(lap_times["TimeS"].max())

    time_grid = np.arange(race_start, race_end, sample_interval)
    total_frames = len(time_grid)
    logger.info(
        "Building replay: {:.0f}s → {:.0f}s, {} frames @ {:.1f}s",
        race_start, race_end, total_frames, sample_interval,
    )

    # ── Rotation from circuit info ──
    try:
        ci = session.get_circuit_info()
        rotation_deg = float(ci.rotation) if hasattr(ci, "rotation") and ci.rotation else 0.0
        corners = ci.corners
    except Exception:
        rotation_deg = 0.0
        corners = None

    # ── Resolve team colours once ──
    from src.dashboard.state import team_color
    driver_colors: dict[str, str] = {}
    for code, team in team_map.items():
        driver_colors[code] = team_color(team)

    # ── Interpolate all drivers ──
    frames: dict[int, list[dict]] = {i: [] for i in range(total_frames)}
    all_x: list[float] = []
    all_y: list[float] = []

    for driver_num, pos_df in pos_data.items():
        code = driver_map.get(str(driver_num), str(driver_num))
        color = driver_colors.get(code, "#888888")

        pos = pos_df.copy()
        pos["SessionTimeS"] = _td_to_secs(pos["SessionTime"])
        pos = pos.sort_values("SessionTimeS").dropna(subset=["SessionTimeS", "X", "Y"])
        if pos.empty:
            continue

        t = pos["SessionTimeS"].values
        x_interp = np.interp(time_grid, t, pos["X"].values, left=np.nan, right=np.nan)
        y_interp = np.interp(time_grid, t, pos["Y"].values, left=np.nan, right=np.nan)

        speed_interp = np.full(total_frames, np.nan)
        if isinstance(car_data, dict) and driver_num in car_data:
            cd = car_data[driver_num].copy()
            cd["SessionTimeS"] = _td_to_secs(cd["SessionTime"])
            cd = cd.sort_values("SessionTimeS").dropna(subset=["SessionTimeS", "Speed"])
            if not cd.empty:
                speed_interp = np.interp(
                    time_grid, cd["SessionTimeS"].values, cd["Speed"].values,
                    left=np.nan, right=np.nan,
                )

        # Apply rotation once during build
        if rotation_deg != 0:
            cx_all = np.nanmean(x_interp)
            cy_all = np.nanmean(y_interp)
            rad = np.radians(rotation_deg)
            cos_r, sin_r = np.cos(rad), np.sin(rad)
            dx = x_interp - cx_all
            dy = y_interp - cy_all
            x_rot = cx_all + dx * cos_r - dy * sin_r
            y_rot = cy_all + dx * sin_r + dy * cos_r
        else:
            x_rot = x_interp
            y_rot = y_interp

        for i in range(total_frames):
            if np.isnan(x_rot[i]):
                continue
            frames[i].append({
                "driver": code,
                "x": float(x_rot[i]),
                "y": float(y_rot[i]),
                "speed": float(speed_interp[i]) if not np.isnan(speed_interp[i]) else 0.0,
                "color": color,
            })
            all_x.append(float(x_rot[i]))
            all_y.append(float(y_rot[i]))

    # ── Track outline (one driver's full path, rotated, downsampled) ──
    first_code = list(driver_map.values())[0] if driver_map else None
    outline_x, outline_y = [], []
    if first_code:
        first_num = [k for k, v in driver_map.items() if v == first_code][0]
        if first_num in pos_data:
            pos = pos_data[first_num].copy()
            pos["SessionTimeS"] = _td_to_secs(pos["SessionTime"])
            pos = pos.sort_values("SessionTimeS").dropna(subset=["SessionTimeS", "X", "Y"])
            # Take only ~1 lap worth of points (lap avg ~90s at ~4Hz = ~360 pts)
            lap_dur = (race_end - race_start) / max(1, laps["LapNumber"].max())
            samples_per_lap = int(lap_dur * 4)
            ox = pos["X"].values[:samples_per_lap].copy()
            oy = pos["Y"].values[:samples_per_lap].copy()
            if rotation_deg != 0:
                cx, cy = ox.mean(), oy.mean()
                rad = np.radians(rotation_deg)
                dx, dy = ox - cx, oy - cy
                ox = cx + dx * np.cos(rad) - dy * np.sin(rad)
                oy = cy + dx * np.sin(rad) + dy * np.cos(rad)
            outline_x = ox.tolist()
            outline_y = oy.tolist()

    # ── Corner markers (rotated) ──
    corner_data = None
    if corners is not None and not corners.empty and rotation_deg != 0:
        cx_c = np.mean(all_x) if all_x else 0
        cy_c = np.mean(all_y) if all_y else 0
        rad = np.radians(rotation_deg)
        corner_data = {
            "x": (cx_c + (corners["X"].values - cx_c) * np.cos(rad)
                  - (corners["Y"].values - cy_c) * np.sin(rad)).tolist(),
            "y": (cy_c + (corners["X"].values - cx_c) * np.sin(rad)
                  + (corners["Y"].values - cy_c) * np.cos(rad)).tolist(),
            "numbers": corners["Number"].tolist(),
        }
    elif corners is not None and not corners.empty:
        corner_data = {
            "x": corners["X"].tolist(),
            "y": corners["Y"].tolist(),
            "numbers": corners["Number"].tolist(),
        }

    pad = 300
    x_arr = np.array(all_x)
    y_arr = np.array(all_y)

    meta = {
        "frames": frames,
        "time_grid": time_grid,
        "race_start": race_start,
        "race_end": race_end,
        "total_frames": total_frames,
        "sample_interval": sample_interval,
        "driver_map": driver_map,
        "team_map": team_map,
        "driver_colors": driver_colors,
        "lap_lookup": _build_lap_lookup(laps),
        "position_lookup": _build_position_lookup(laps),
        "track_status_lookup": _build_track_status_lookup(session),
        "track_outline_x": outline_x,
        "track_outline_y": outline_y,
        "corner_data": corner_data,
        "x_range": [float(x_arr.min()) - pad, float(x_arr.max()) + pad],
        "y_range": [float(y_arr.min()) - pad, float(y_arr.max()) + pad],
        "total_laps": int(laps["LapNumber"].max()) if not laps.empty else 0,
    }

    logger.info("Replay ready: {} frames, {} drivers", total_frames, len(driver_map))
    return meta


# ── Lookup builders ──────────────────────────────────────────────────

def _build_lap_lookup(laps: pd.DataFrame) -> dict[str, list[tuple[float, int]]]:
    lookup: dict[str, list[tuple[float, int]]] = {}
    for driver in laps["Driver"].unique():
        d = laps[laps["Driver"] == driver].sort_values("LapNumber")
        entries = []
        for _, row in d.iterrows():
            t = _to_float(row["Time"])
            if t is not None:
                entries.append((t, int(row["LapNumber"])))
        lookup[str(driver)] = entries
    return lookup


def _build_position_lookup(laps: pd.DataFrame) -> dict[str, list[tuple[float, int]]]:
    lookup: dict[str, list[tuple[float, int]]] = {}
    for driver in laps["Driver"].unique():
        d = laps[laps["Driver"] == driver].sort_values("LapNumber")
        entries = []
        for _, row in d.iterrows():
            t = _to_float(row["Time"])
            pos = row["Position"]
            if t is not None and pd.notna(pos):
                entries.append((t, int(pos)))
        lookup[str(driver)] = entries
    return lookup


def _build_track_status_lookup(session) -> list[tuple[float, str, str]]:
    ts = session.track_status
    if ts is None or ts.empty:
        return []
    status_names = {
        "1": "Green", "2": "Yellow", "4": "Safety Car",
        "5": "Red Flag", "6": "VSC", "7": "VSC Ending",
    }
    entries = []
    for _, row in ts.iterrows():
        t = _to_float(row["Time"])
        if t is None:
            continue
        code = str(row["Status"])
        name = status_names.get(code, code)
        entries.append((t, code, name))
    return sorted(entries)


# ── Query helpers ────────────────────────────────────────────────────

def get_current_lap(driver: str, session_time: float, lap_lookup: dict) -> int:
    entries = lap_lookup.get(driver, [])
    lap = 0
    for t, lap_num in entries:
        if session_time >= t:
            lap = lap_num
        else:
            break
    return lap if lap > 0 else 1


def get_current_position(driver: str, session_time: float, pos_lookup: dict) -> int | None:
    entries = pos_lookup.get(driver, [])
    pos = None
    for t, p in entries:
        if session_time >= t:
            pos = p
        else:
            break
    return pos


def get_current_track_status(session_time: float, ts_lookup: list) -> tuple[str, str]:
    code, name = "1", "Green"
    for t, c, n in ts_lookup:
        if session_time >= t:
            code, name = c, n
        else:
            break
    return code, name


def get_standings_at_time(
    session_time: float,
    drivers: list[str],
    pos_lookup: dict,
    lap_lookup: dict,
    team_map: dict,
) -> list[dict]:
    standings = []
    for driver in drivers:
        pos = get_current_position(driver, session_time, pos_lookup)
        lap = get_current_lap(driver, session_time, lap_lookup)
        standings.append({
            "driver": driver,
            "position": pos,
            "lap": lap,
            "team": team_map.get(driver, ""),
        })
    standings.sort(key=lambda x: (x["position"] is None, x["position"] or 99))
    return standings
