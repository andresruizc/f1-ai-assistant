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


def _rotate_arrays(x, y, deg, cx, cy):
    """Rotate arrays of x/y coordinates around (cx, cy) by deg degrees."""
    rad = np.radians(deg)
    cos_r, sin_r = np.cos(rad), np.sin(rad)
    dx, dy = x - cx, y - cy
    return cx + dx * cos_r - dy * sin_r, cy + dx * sin_r + dy * cos_r


def build_replay_data(
    session,
    sample_interval: float = 2.0,
) -> dict:
    """Pre-compute all driver positions + telemetry on a common time grid.

    Returns a single ``meta`` dict containing everything needed for replay:
      - frames: dict[int, list[dict]]  — frame_index → list of driver dicts
        Each driver dict: driver, x, y, speed, throttle, brake, gear, drs, color
      - time_grid, race_start, race_end, total_frames
      - track_x, track_y  (high-res rotated circuit from fastest lap)
      - x_range, y_range
      - driver_map, team_map, driver_colors
      - lap_lookup, position_lookup, track_status_lookup
      - compound_lookup  — per-driver compound at each session time
      - drs_zones  — list of DRS detection zones (start_x, start_y, end_x, end_y)
    """
    results = session.results
    laps = session.laps
    pos_data = session.pos_data
    car_data = session.car_data

    driver_map: dict[str, str] = {}
    team_map: dict[str, str] = {}
    headshot_map: dict[str, str] = {}
    for _, row in results.iterrows():
        num = str(row["DriverNumber"])
        code = str(row["Abbreviation"])
        team = str(row.get("TeamName", ""))
        driver_map[num] = code
        team_map[code] = team
        url = str(row.get("HeadshotUrl", "")) if pd.notna(row.get("HeadshotUrl")) else ""
        if url:
            headshot_map[code] = url

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

    # ── Build compound lookup (driver → list of (session_time, compound, tyre_life)) ──
    compound_lookup = _build_compound_lookup(laps)

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

        # Interpolate full telemetry channels from car_data
        speed_interp = np.full(total_frames, np.nan)
        throttle_interp = np.full(total_frames, np.nan)
        brake_interp = np.full(total_frames, np.nan)
        gear_interp = np.full(total_frames, np.nan)
        drs_interp = np.full(total_frames, np.nan)

        if isinstance(car_data, dict) and driver_num in car_data:
            cd = car_data[driver_num].copy()
            cd["SessionTimeS"] = _td_to_secs(cd["SessionTime"])
            cd = cd.sort_values("SessionTimeS").dropna(subset=["SessionTimeS"])
            if not cd.empty:
                ct = cd["SessionTimeS"].values
                if "Speed" in cd.columns:
                    vals = pd.to_numeric(cd["Speed"], errors="coerce").values
                    speed_interp = np.interp(time_grid, ct, vals, left=np.nan, right=np.nan)
                if "Throttle" in cd.columns:
                    vals = pd.to_numeric(cd["Throttle"], errors="coerce").values
                    throttle_interp = np.interp(time_grid, ct, vals, left=np.nan, right=np.nan)
                if "Brake" in cd.columns:
                    vals = pd.to_numeric(cd["Brake"], errors="coerce").values
                    brake_interp = np.interp(time_grid, ct, vals, left=np.nan, right=np.nan)
                if "nGear" in cd.columns:
                    vals = pd.to_numeric(cd["nGear"], errors="coerce").values
                    gear_interp = np.interp(time_grid, ct, vals, left=np.nan, right=np.nan)
                if "DRS" in cd.columns:
                    vals = pd.to_numeric(cd["DRS"], errors="coerce").values
                    drs_interp = np.interp(time_grid, ct, vals, left=np.nan, right=np.nan)

        # Apply rotation once during build
        if rotation_deg != 0:
            cx_all = np.nanmean(x_interp)
            cy_all = np.nanmean(y_interp)
            x_rot, y_rot = _rotate_arrays(x_interp, y_interp, rotation_deg, cx_all, cy_all)
        else:
            x_rot, y_rot = x_interp, y_interp

        for i in range(total_frames):
            if np.isnan(x_rot[i]):
                continue
            frames[i].append({
                "driver": code,
                "x": float(x_rot[i]),
                "y": float(y_rot[i]),
                "speed": _safe_float(speed_interp[i]),
                "throttle": _safe_float(throttle_interp[i]),
                "brake": _safe_float(brake_interp[i]),
                "gear": _safe_int(gear_interp[i]),
                "drs": _safe_int(drs_interp[i]),
                "color": color,
            })
            all_x.append(float(x_rot[i]))
            all_y.append(float(y_rot[i]))

    # ── High-res track outline from fastest lap telemetry ──
    track_x, track_y = _build_hires_track(session, rotation_deg)

    # If hi-res failed, fall back to raw pos_data approach
    if not track_x:
        track_x, track_y = _build_fallback_track(
            pos_data, driver_map, laps, race_start, race_end, rotation_deg,
        )

    # ── Corner markers (rotated) ──
    corner_data = None
    if corners is not None and not corners.empty:
        cx_c = np.mean(all_x) if all_x else 0
        cy_c = np.mean(all_y) if all_y else 0
        if rotation_deg != 0:
            rx, ry = _rotate_arrays(
                corners["X"].values.astype(float),
                corners["Y"].values.astype(float),
                rotation_deg, cx_c, cy_c,
            )
            corner_data = {"x": rx.tolist(), "y": ry.tolist(), "numbers": corners["Number"].tolist()}
        else:
            corner_data = {
                "x": corners["X"].tolist(),
                "y": corners["Y"].tolist(),
                "numbers": corners["Number"].tolist(),
            }

    pad = 800
    x_arr = np.array(all_x)
    y_arr = np.array(all_y)

    # ── Build retirement lookup from results ──
    retired_drivers: dict[str, str] = {}
    for _, row in results.iterrows():
        code = str(row["Abbreviation"])
        status = str(row.get("Status", ""))
        if status and status not in ("Finished", "+1 Lap", "+2 Laps", "+3 Laps") and "Lap" not in status:
            retired_drivers[code] = status

    # ── DRS zones: detect from fastest lap telemetry ──
    drs_zones = _build_drs_zones(session, rotation_deg)

    # ── Weather timeline ──
    weather_timeline = _build_weather_timeline(session, race_start)

    # ── Sector times per driver per lap ──
    sector_lookup = _build_sector_lookup(laps)

    # ── Pit stop events ──
    pit_events = _build_pit_events(laps)

    # ── Race control messages ──
    rc_messages = _build_race_control(session, race_start)

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
        "headshot_map": headshot_map,
        "lap_lookup": _build_lap_lookup(laps),
        "position_lookup": _build_position_lookup(laps),
        "track_status_lookup": _build_track_status_lookup(session),
        "compound_lookup": compound_lookup,
        "cumtime_lookup": _build_cumtime_lookup(laps),
        "retired_drivers": retired_drivers,
        "track_x": track_x,
        "track_y": track_y,
        "corner_data": corner_data,
        "drs_zones": drs_zones,
        "weather_timeline": weather_timeline,
        "sector_lookup": sector_lookup,
        "pit_events": pit_events,
        "rc_messages": rc_messages,
        "x_range": [float(x_arr.min()) - pad, float(x_arr.max()) + pad],
        "y_range": [float(y_arr.min()) - pad, float(y_arr.max()) + pad],
        "total_laps": int(laps["LapNumber"].max()) if not laps.empty else 0,
    }

    logger.info("Replay ready: {} frames, {} drivers, {} track pts",
                total_frames, len(driver_map), len(track_x))
    return meta


def _safe_float(v) -> float:
    if np.isnan(v):
        return 0.0
    return round(float(v), 1)


def _safe_int(v) -> int:
    if np.isnan(v):
        return 0
    return int(round(float(v)))


# ── High-res track from telemetry ──────────────────────────────────

def _build_hires_track(session, rotation_deg: float) -> tuple[list, list]:
    """Use the fastest lap's telemetry X/Y for a high-res circuit outline."""
    try:
        fastest = session.laps.pick_fastest()
        tel = fastest.get_telemetry()
        if tel.empty or "X" not in tel.columns or "Y" not in tel.columns:
            return [], []

        x = tel["X"].values.astype(float)
        y = tel["Y"].values.astype(float)

        if rotation_deg != 0:
            cx, cy = np.nanmean(x), np.nanmean(y)
            x, y = _rotate_arrays(x, y, rotation_deg, cx, cy)

        # Downsample to ~600 points for smooth but fast rendering
        step = max(1, len(x) // 600)
        return x[::step].tolist(), y[::step].tolist()
    except Exception as e:
        logger.warning("Failed to build hi-res track: {}", e)
        return [], []


def _build_fallback_track(pos_data, driver_map, laps, race_start, race_end, rotation_deg):
    """Fallback: use raw position data from first driver."""
    first_code = list(driver_map.values())[0] if driver_map else None
    if not first_code:
        return [], []
    first_num = [k for k, v in driver_map.items() if v == first_code][0]
    if first_num not in pos_data:
        return [], []

    pos = pos_data[first_num].copy()
    pos["SessionTimeS"] = _td_to_secs(pos["SessionTime"])
    pos = pos.sort_values("SessionTimeS").dropna(subset=["SessionTimeS", "X", "Y"])
    lap_dur = (race_end - race_start) / max(1, laps["LapNumber"].max())
    n = int(lap_dur * 4)
    ox = pos["X"].values[:n].copy().astype(float)
    oy = pos["Y"].values[:n].copy().astype(float)
    if rotation_deg != 0:
        cx, cy = ox.mean(), oy.mean()
        ox, oy = _rotate_arrays(ox, oy, rotation_deg, cx, cy)
    return ox.tolist(), oy.tolist()


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


def _build_compound_lookup(laps: pd.DataFrame) -> dict[str, list[tuple[float, str, int]]]:
    """driver → list of (session_time, compound, tyre_life) sorted by time."""
    lookup: dict[str, list[tuple[float, str, int]]] = {}
    for driver in laps["Driver"].unique():
        d = laps[laps["Driver"] == driver].sort_values("LapNumber")
        entries = []
        for _, row in d.iterrows():
            t = _to_float(row["Time"])
            compound = str(row.get("Compound", "UNKNOWN"))
            life = int(row["TyreLife"]) if pd.notna(row.get("TyreLife")) else 0
            if t is not None:
                entries.append((t, compound, life))
        lookup[str(driver)] = entries
    return lookup


def _build_cumtime_lookup(laps: pd.DataFrame) -> dict[str, list[tuple[int, float]]]:
    """driver → list of (lap_number, cumulative_session_time) for gap calculation."""
    lookup: dict[str, list[tuple[int, float]]] = {}
    for driver in laps["Driver"].unique():
        d = laps[laps["Driver"] == driver].sort_values("LapNumber")
        entries = []
        for _, row in d.iterrows():
            t = _to_float(row["Time"])
            if t is not None:
                entries.append((int(row["LapNumber"]), t))
        lookup[str(driver)] = entries
    return lookup


def _build_drs_zones(session, rotation_deg: float) -> list[dict]:
    """Extract DRS zones from the lap with most DRS usage."""
    try:
        best_tel = None
        best_count = 0

        # Try fastest lap first, then scan a few laps for DRS data
        candidates = []
        try:
            candidates.append(session.laps.pick_fastest())
        except Exception:
            pass
        # Also check some mid-race laps from the leader
        leader_laps = session.laps.pick_drivers(
            str(session.results.iloc[0]["Abbreviation"])
        ).sort_values("LapNumber")
        for _, lap in leader_laps.iloc[len(leader_laps)//3:len(leader_laps)//3+10].iterrows():
            candidates.append(lap)

        for lap in candidates:
            try:
                tel = lap.get_telemetry()
                if "DRS" not in tel.columns:
                    continue
                n = int((pd.to_numeric(tel["DRS"], errors="coerce") >= 10).sum())
                if n > best_count:
                    best_count = n
                    best_tel = tel
            except Exception:
                continue

        if best_tel is None or best_count < 10:
            return []

        x = best_tel["X"].values.astype(float)
        y = best_tel["Y"].values.astype(float)
        drs = pd.to_numeric(best_tel["DRS"], errors="coerce").values

        if rotation_deg != 0:
            cx, cy = np.nanmean(x), np.nanmean(y)
            x, y = _rotate_arrays(x, y, rotation_deg, cx, cy)

        zones: list[dict] = []
        in_zone = False
        zone_x: list[float] = []
        zone_y: list[float] = []
        for i in range(len(drs)):
            if drs[i] >= 10 and not np.isnan(x[i]):
                if not in_zone:
                    in_zone = True
                    zone_x, zone_y = [], []
                zone_x.append(float(x[i]))
                zone_y.append(float(y[i]))
            else:
                if in_zone and len(zone_x) > 5:
                    step = max(1, len(zone_x) // 30)
                    zones.append({"x": zone_x[::step], "y": zone_y[::step]})
                in_zone = False
        if in_zone and len(zone_x) > 5:
            step = max(1, len(zone_x) // 30)
            zones.append({"x": zone_x[::step], "y": zone_y[::step]})
        logger.info("DRS zones found: {} zones ({} total pts)", len(zones), best_count)
        return zones
    except Exception as e:
        logger.warning("Failed to build DRS zones: {}", e)
        return []


def _build_weather_timeline(session, race_start: float) -> list[dict]:
    """Build weather snapshots indexed by session time."""
    w = session.weather_data
    if w is None or w.empty:
        return []
    entries = []
    for _, row in w.iterrows():
        t = _to_float(row["Time"])
        if t is None or t < race_start - 300:
            continue
        entries.append({
            "t": round(t - race_start, 1),
            "airTemp": round(float(row.get("AirTemp", 0)), 1),
            "trackTemp": round(float(row.get("TrackTemp", 0)), 1),
            "humidity": round(float(row.get("Humidity", 0)), 0),
            "rainfall": bool(row.get("Rainfall", False)),
            "windSpeed": round(float(row.get("WindSpeed", 0)), 1),
            "windDir": round(float(row.get("WindDirection", 0)), 0),
        })
    return entries


def _build_sector_lookup(laps: pd.DataFrame) -> dict[str, dict[int, dict]]:
    """driver → {lap_number: {s1, s2, s3, pb}}"""
    lookup: dict[str, dict[int, dict]] = {}
    best_s1, best_s2, best_s3 = float("inf"), float("inf"), float("inf")

    for _, row in laps.sort_values(["LapNumber"]).iterrows():
        driver = str(row["Driver"])
        lap_num = int(row["LapNumber"])
        s1 = _to_float(row.get("Sector1Time"))
        s2 = _to_float(row.get("Sector2Time"))
        s3 = _to_float(row.get("Sector3Time"))
        if s1 is not None and s1 < best_s1:
            best_s1 = s1
        if s2 is not None and s2 < best_s2:
            best_s2 = s2
        if s3 is not None and s3 < best_s3:
            best_s3 = s3
        if driver not in lookup:
            lookup[driver] = {}
        lookup[driver][lap_num] = {
            "s1": round(s1, 3) if s1 else None,
            "s2": round(s2, 3) if s2 else None,
            "s3": round(s3, 3) if s3 else None,
            "pb": bool(row.get("IsPersonalBest", False)),
        }

    # Tag session-best sectors
    for driver_laps in lookup.values():
        for lap_data in driver_laps.values():
            lap_data["s1_best"] = lap_data["s1"] is not None and abs(lap_data["s1"] - best_s1) < 0.01
            lap_data["s2_best"] = lap_data["s2"] is not None and abs(lap_data["s2"] - best_s2) < 0.01
            lap_data["s3_best"] = lap_data["s3"] is not None and abs(lap_data["s3"] - best_s3) < 0.01
    return lookup


def _build_pit_events(laps: pd.DataFrame) -> dict[str, list[dict]]:
    """driver → list of {lap, in_time, out_time}"""
    pit_laps = laps[laps["PitInTime"].notna() | laps["PitOutTime"].notna()]
    result: dict[str, list[dict]] = {}
    for _, row in pit_laps.iterrows():
        driver = str(row["Driver"])
        if driver not in result:
            result[driver] = []
        pit_in = _to_float(row.get("PitInTime"))
        pit_out = _to_float(row.get("PitOutTime"))
        result[driver].append({
            "lap": int(row["LapNumber"]),
            "in_t": pit_in,
            "out_t": pit_out,
        })
    return result


def _build_race_control(session, race_start: float) -> list[dict]:
    """Race control messages with elapsed time."""
    rcm = session.race_control_messages
    if rcm is None or rcm.empty:
        return []

    session_start = session.t0_date
    entries = []
    for _, row in rcm.iterrows():
        raw_time = row["Time"]
        if pd.isna(raw_time):
            continue
        if isinstance(raw_time, pd.Timedelta):
            t = raw_time.total_seconds()
        elif hasattr(raw_time, "timestamp"):
            t = (raw_time - session_start).total_seconds()
        else:
            continue
        entries.append({
            "t": round(t - race_start, 1),
            "cat": str(row.get("Category", "")),
            "msg": str(row.get("Message", "")),
            "flag": str(row.get("Flag", "")) if pd.notna(row.get("Flag")) else "",
            "lap": int(row["Lap"]) if pd.notna(row.get("Lap")) else 0,
        })
    return sorted(entries, key=lambda x: x["t"])


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


def get_current_compound(driver: str, session_time: float, compound_lookup: dict) -> tuple[str, int]:
    entries = compound_lookup.get(driver, [])
    compound, life = "UNKNOWN", 0
    for t, c, l in entries:
        if session_time >= t:
            compound, life = c, l
        else:
            break
    return compound, life


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
    compound_lookup: dict | None = None,
    frame_drivers: list[dict] | None = None,
    cumtime_lookup: dict | None = None,
    retired_drivers: dict | None = None,
) -> list[dict]:
    """Build standings with compound, speed, gap-to-leader and interval."""
    standings = []
    speed_map = {}
    if frame_drivers:
        speed_map = {d["driver"]: d for d in frame_drivers}
    retired = retired_drivers or {}

    for driver in drivers:
        pos = get_current_position(driver, session_time, pos_lookup)
        lap = get_current_lap(driver, session_time, lap_lookup)
        compound, tyre_life = ("", 0)
        if compound_lookup:
            compound, tyre_life = get_current_compound(driver, session_time, compound_lookup)

        drv_data = speed_map.get(driver, {})

        last_known_time = None
        if cumtime_lookup:
            entries = cumtime_lookup.get(driver, [])
            if entries:
                last_known_time = entries[-1][1]
        is_retired = (driver in retired
                      and last_known_time is not None
                      and session_time > last_known_time + 120)

        cum_time = None
        if cumtime_lookup:
            for lap_num, t in reversed(cumtime_lookup.get(driver, [])):
                if t <= session_time:
                    cum_time = t
                    break

        standings.append({
            "driver": driver,
            "position": pos,
            "lap": lap,
            "team": team_map.get(driver, ""),
            "compound": compound,
            "tyre_life": tyre_life,
            "speed": drv_data.get("speed", 0),
            "cum_time": cum_time,
            "retired": is_retired,
        })

    standings.sort(key=lambda x: (x["retired"], x["position"] is None, x["position"] or 99))

    # Compute gaps
    leader = standings[0] if standings else None
    leader_lap = leader["lap"] if leader else 0
    leader_cum = leader["cum_time"] if leader else None
    prev_cum = leader_cum

    for i, s in enumerate(standings):
        if i == 0 or s["position"] is None:
            s["gap"] = ""
            s["interval"] = ""
        elif s["lap"] < leader_lap:
            diff = leader_lap - s["lap"]
            s["gap"] = f"+{diff} LAP{'S' if diff > 1 else ''}"
            s["interval"] = s["gap"]
        elif leader_cum is not None and s["cum_time"] is not None:
            gap_secs = s["cum_time"] - leader_cum
            s["gap"] = f"+{abs(gap_secs):.1f}s" if gap_secs > 0.05 else ""
            if prev_cum is not None and i > 0:
                int_secs = s["cum_time"] - prev_cum
                s["interval"] = f"+{abs(int_secs):.1f}s" if int_secs > 0.05 else ""
            else:
                s["interval"] = s["gap"]
        else:
            s["gap"] = ""
            s["interval"] = ""

        if s["cum_time"] is not None:
            prev_cum = s["cum_time"]

    for s in standings:
        del s["cum_time"]

    return standings
