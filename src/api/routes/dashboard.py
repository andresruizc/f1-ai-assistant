"""Dashboard API endpoints for the React frontend.

Exposes all data that the Streamlit dashboard computes, serialised as JSON
so the React frontend can render charts and the race replay animation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from src.api.services import RaceService
from src.dashboard.state import TEAM_COLORS, team_color

router = APIRouter()


def _td(v) -> float | None:
    if pd.isna(v):
        return None
    if isinstance(v, pd.Timedelta):
        return round(v.total_seconds(), 3)
    try:
        return round(float(v), 3)
    except (TypeError, ValueError):
        return None


def _ensure_loaded() -> RaceService:
    svc = RaceService.get_instance()
    if not svc.is_loaded:
        raise HTTPException(400, "No race loaded. POST /api/race/load first.")
    return svc


# ------------------------------------------------------------------
# Overview
# ------------------------------------------------------------------

@router.get("/overview")
async def overview():
    """Race results, podium, fastest lap, retirements."""
    svc = _ensure_loaded()
    s = svc.race_state.session
    results = s.results
    laps = s.laps

    rows = []
    for _, r in results.iterrows():
        code = str(r["Abbreviation"])
        rows.append({
            "position": int(r["Position"]) if pd.notna(r.get("Position")) else None,
            "driver": code,
            "name": str(r.get("FullName", code)),
            "team": str(r.get("TeamName", "")),
            "color": team_color(str(r.get("TeamName", ""))),
            "grid": int(r["GridPosition"]) if pd.notna(r.get("GridPosition")) else None,
            "status": str(r.get("Status", "")),
            "points": float(r["Points"]) if pd.notna(r.get("Points")) else 0,
            "headshot": str(r.get("HeadshotUrl", "")) if pd.notna(r.get("HeadshotUrl")) else "",
        })

    fastest = None
    if not laps.empty and "LapTime" in laps.columns:
        valid = laps.dropna(subset=["LapTime"])
        if not valid.empty:
            fl = valid.loc[valid["LapTime"].idxmin()]
            fastest = {
                "driver": str(fl["Driver"]),
                "lap": int(fl["LapNumber"]),
                "time": _td(fl["LapTime"]),
            }

    return {"results": rows, "fastest_lap": fastest, "total_laps": svc.race_state.total_laps}


# ------------------------------------------------------------------
# Strategy
# ------------------------------------------------------------------

@router.get("/strategy")
async def strategy():
    """Tyre stints for every driver."""
    svc = _ensure_loaded()
    laps = svc.race_state.laps

    stints: dict[str, list] = {}
    for driver in laps["Driver"].unique():
        dl = laps[laps["Driver"] == driver].sort_values("LapNumber")
        driver_stints = []
        current = None
        for _, row in dl.iterrows():
            compound = str(row.get("Compound", "UNKNOWN"))
            stint_num = int(row["Stint"]) if pd.notna(row.get("Stint")) else 0
            lap_n = int(row["LapNumber"])
            if current is None or current["stint"] != stint_num:
                if current is not None:
                    driver_stints.append(current)
                current = {
                    "stint": stint_num,
                    "compound": compound,
                    "start_lap": lap_n,
                    "end_lap": lap_n,
                    "laps": 1,
                }
            else:
                current["end_lap"] = lap_n
                current["laps"] += 1
        if current:
            driver_stints.append(current)
        stints[str(driver)] = driver_stints

    drivers_info = {}
    for code, info in svc.race_state.drivers.items():
        drivers_info[code] = {"team": info["team"], "color": team_color(info["team"])}

    return {"stints": stints, "drivers": drivers_info, "total_laps": svc.race_state.total_laps}


# ------------------------------------------------------------------
# Pace
# ------------------------------------------------------------------

@router.get("/pace")
async def pace(
    driver: str | None = Query(None),
    filter_type: str = Query("all"),
):
    """Lap times for pace analysis. Optional driver filter and lap filter."""
    svc = _ensure_loaded()
    laps = svc.race_state.laps.copy()

    if filter_type == "quicklaps":
        laps = svc.race_state.session.laps.pick_quicklaps()
    elif filter_type == "accurate":
        laps = svc.race_state.session.laps.pick_accurate()
    elif filter_type == "wo_box":
        laps = svc.race_state.session.laps.pick_wo_box()

    if driver:
        laps = laps[laps["Driver"] == driver]

    rows = []
    for _, row in laps.iterrows():
        lt = _td(row.get("LapTime"))
        if lt is None or lt <= 0:
            continue
        rows.append({
            "driver": str(row["Driver"]),
            "lap": int(row["LapNumber"]),
            "time": lt,
            "compound": str(row.get("Compound", "UNKNOWN")),
            "tyre_life": int(row["TyreLife"]) if pd.notna(row.get("TyreLife")) else 0,
            "team": svc.race_state.drivers.get(str(row["Driver"]), {}).get("team", ""),
        })

    return {"laps": rows}


# ------------------------------------------------------------------
# Telemetry
# ------------------------------------------------------------------

@router.get("/telemetry")
async def telemetry(
    driver: str = Query(...),
    lap: int = Query(...),
):
    """Merged car + position telemetry for a single lap."""
    svc = _ensure_loaded()
    session = svc.race_state.session

    driver_laps = session.laps.pick_drivers(driver)
    lap_data = driver_laps[driver_laps["LapNumber"] == lap]
    if lap_data.empty:
        raise HTTPException(404, f"No data for {driver} lap {lap}")

    try:
        tel = lap_data.iloc[0].get_telemetry()
    except Exception as e:
        raise HTTPException(500, f"Telemetry error: {e}")

    cols = ["Distance", "Speed", "Throttle", "Brake", "nGear", "DRS"]
    available = [c for c in cols if c in tel.columns]
    result = []
    step = max(1, len(tel) // 500)
    for i in range(0, len(tel), step):
        row = tel.iloc[i]
        entry = {}
        for c in available:
            v = row[c]
            entry[c.lower()] = float(v) if pd.notna(v) else None
        result.append(entry)

    return {"telemetry": result, "driver": driver, "lap": lap}


@router.get("/telemetry-compare")
async def telemetry_compare(
    drivers: str = Query(..., description="Comma-separated driver codes"),
    lap: int = Query(...),
):
    """Telemetry for multiple drivers on the same lap, resampled to common distance grid."""
    svc = _ensure_loaded()
    session = svc.race_state.session
    driver_list = [d.strip() for d in drivers.split(",") if d.strip()]

    if len(driver_list) > 4:
        raise HTTPException(400, "Maximum 4 drivers for comparison")

    all_traces = {}
    for drv in driver_list:
        dlaps = session.laps.pick_drivers(drv)
        lap_row = dlaps[dlaps["LapNumber"] == lap]
        if lap_row.empty:
            continue
        try:
            tel = lap_row.iloc[0].get_telemetry()
        except Exception:
            continue

        cols = ["Distance", "Speed", "Throttle", "Brake", "nGear", "DRS"]
        available = [c for c in cols if c in tel.columns]
        step = max(1, len(tel) // 500)
        points = []
        for i in range(0, len(tel), step):
            row = tel.iloc[i]
            entry = {}
            for c in available:
                v = row[c]
                entry[c.lower()] = float(v) if pd.notna(v) else None
            points.append(entry)
        color = svc.race_state.drivers.get(drv, {}).get("color", "#888")
        from src.dashboard.state import team_color as _tc
        team = svc.race_state.drivers.get(drv, {}).get("team", "")
        all_traces[drv] = {
            "points": points,
            "color": _tc(team),
            "team": team,
        }

    return {"traces": all_traces, "lap": lap}


# ------------------------------------------------------------------
# Track map (static GPS outline)
# ------------------------------------------------------------------

@router.get("/track-map")
async def track_map(driver: str = Query("", description="Optional driver for GPS")):
    """Circuit outline from GPS + corner positions."""
    svc = _ensure_loaded()
    session = svc.race_state.session

    try:
        ci = session.get_circuit_info()
        rotation = float(ci.rotation) if hasattr(ci, "rotation") and ci.rotation else 0.0
        corners_data = None
        if ci.corners is not None and not ci.corners.empty:
            corners_data = {
                "x": ci.corners["X"].tolist(),
                "y": ci.corners["Y"].tolist(),
                "numbers": [int(n) for n in ci.corners["Number"]],
            }
    except Exception:
        rotation = 0.0
        corners_data = None

    target = driver if driver else str(session.results.iloc[0]["Abbreviation"])
    dl = session.laps.pick_drivers(target)
    if dl.empty:
        return {"outline": None, "corners": corners_data, "rotation": rotation}

    try:
        fastest = dl.pick_fastest()
        tel = fastest.get_telemetry()
        outline = {"x": tel["X"].tolist(), "y": tel["Y"].tolist()}
    except Exception:
        outline = None

    return {"outline": outline, "corners": corners_data, "rotation": rotation}


# ------------------------------------------------------------------
# Replay data (pre-computed animation frames)
# ------------------------------------------------------------------

@router.get("/replay")
async def replay_data(interval: float = Query(4.0, ge=1.0, le=10.0)):
    """Pre-computed replay frames with full telemetry per driver.

    Each frame includes per-driver: x, y, speed, throttle, brake, gear, drs.
    Standings include compound, tyre life, speed, and gap to leader.
    Track outline is high-res from fastest lap telemetry (~600 points).
    """
    svc = _ensure_loaded()
    session = svc.race_state.session

    from src.dashboard.replay_engine import (
        build_replay_data,
        get_current_track_status,
        get_standings_at_time,
    )

    meta = build_replay_data(session, sample_interval=interval)

    time_grid = meta["time_grid"]
    drivers_list = list(meta["driver_map"].values())
    race_start = meta["race_start"]

    pit_events = meta.get("pit_events", {})

    def _is_in_pit(driver: str, session_time: float) -> bool:
        for pe in pit_events.get(driver, []):
            pit_in = pe.get("in_t")
            pit_out = pe.get("out_t")
            if pit_in and pit_out and pit_in <= session_time <= pit_out:
                return True
            if pit_in and not pit_out and pit_in <= session_time <= pit_in + 30:
                return True
        return False

    frames_out = {}
    for i in range(meta["total_frames"]):
        drv = meta["frames"].get(i, [])
        if not drv:
            continue

        t = float(time_grid[i])
        elapsed = t - race_start

        _, status_name = get_current_track_status(t, meta["track_status_lookup"])
        stnd = get_standings_at_time(
            t, drivers_list,
            meta["position_lookup"], meta["lap_lookup"], meta["team_map"],
            compound_lookup=meta["compound_lookup"],
            frame_drivers=drv,
            cumtime_lookup=meta["cumtime_lookup"],
            retired_drivers=meta["retired_drivers"],
        )
        leader_lap = stnd[0]["lap"] if stnd else 1

        frames_out[str(i)] = {
            "drivers": drv,
            "elapsed": round(elapsed, 1),
            "lap": leader_lap,
            "status": status_name,
            "standings": [
                {
                    "p": s["position"] or idx + 1, "d": s["driver"], "l": s["lap"],
                    "compound": s["compound"], "tyreLife": s["tyre_life"],
                    "speed": round(s["speed"]), "gap": s["gap"],
                    "interval": s["interval"],
                    "retired": s.get("retired", False),
                    "inPit": _is_in_pit(s["driver"], t),
                }
                for idx, s in enumerate(stnd[:20])
            ],
        }

    return {
        "frames": frames_out,
        "total_frames": meta["total_frames"],
        "total_laps": meta["total_laps"],
        "race_start": meta["race_start"],
        "race_end": meta["race_end"],
        "sample_interval": meta["sample_interval"],
        "track_outline": {
            "x": meta["track_x"],
            "y": meta["track_y"],
        },
        "corners": meta["corner_data"],
        "drs_zones": meta.get("drs_zones", []),
        "weather": meta.get("weather_timeline", []),
        "sectors": meta.get("sector_lookup", {}),
        "rc_messages": meta.get("rc_messages", []),
        "x_range": meta["x_range"],
        "y_range": meta["y_range"],
        "drivers": {
            code: {
                "team": meta["team_map"].get(code, ""),
                "color": meta["driver_colors"].get(code, "#888"),
                "headshot": meta.get("headshot_map", {}).get(code, ""),
            }
            for code in drivers_list
        },
    }


# ------------------------------------------------------------------
# Position history (all laps, for the full race line chart)
# ------------------------------------------------------------------

@router.get("/position-history-full")
async def position_history_full():
    """Position of every driver at every lap (for position chart over full race)."""
    svc = _ensure_loaded()
    laps = svc.race_state.laps

    result = {}
    for driver in laps["Driver"].unique():
        dl = laps[laps["Driver"] == driver].sort_values("LapNumber")
        result[str(driver)] = [
            {"lap": int(r["LapNumber"]), "position": int(r["Position"]) if pd.notna(r.get("Position")) else None}
            for _, r in dl.iterrows()
        ]

    drivers_info = {}
    for code, info in svc.race_state.drivers.items():
        drivers_info[code] = {"team": info["team"], "color": team_color(info["team"])}

    return {"positions": result, "drivers": drivers_info, "total_laps": svc.race_state.total_laps}
