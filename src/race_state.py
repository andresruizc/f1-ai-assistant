"""Loads a FastF1 session and builds a structured, queryable race state.

Core design: everything is queryable "as of lap N" — filter the laps DataFrame
to LapNumber <= current_lap before answering any question.
"""

from typing import Any

import fastf1
import numpy as np
import pandas as pd
from loguru import logger

from src.utils.config import settings


def _td_to_seconds(td: pd.Timedelta | None) -> float | None:
    """Convert a Timedelta to seconds, returning None for NaT."""
    if pd.notna(td):
        return round(td.total_seconds(), 3)
    return None


def _format_lap_time(seconds: float | None) -> str | None:
    """Format seconds as M:SS.mmm string."""
    if seconds is None:
        return None
    mins = int(seconds // 60)
    secs = seconds - mins * 60
    return f"{mins}:{secs:06.3f}"


class RaceState:
    """Holds all processed race data and exposes query methods.

    Every query method accepts an as_of_lap parameter that filters data
    to only include information up to that lap.
    """

    def __init__(self, year: int, round_number: int) -> None:
        """Load a FastF1 race session and prepare data structures.

        Args:
            year: Season year (e.g. 2024).
            round_number: Round number within the season.
        """
        cache_dir = settings.get("fastf1", {}).get("cache_dir", "data/.fastf1_cache")
        fastf1.Cache.enable_cache(cache_dir)

        logger.info("Loading FastF1 session: year={}, round={}", year, round_number)
        self.session = fastf1.get_session(year, round_number, "R")
        self.session.load()
        logger.info("Session loaded successfully")

        self.laps: pd.DataFrame = self.session.laps
        self.results: pd.DataFrame = self.session.results
        self.weather_data: pd.DataFrame = self.session.weather_data
        self.track_status_data: pd.DataFrame = self.session.track_status

        self.total_laps: int = int(self.laps["LapNumber"].max())
        self.event_name: str = str(self.session.event["EventName"])
        self.circuit_name: str = str(self.session.event["Location"])
        self.country: str = str(self.session.event["Country"])
        self.year: int = year

        # Driver info mapping: code -> {name, team, color}
        self.drivers: dict[str, dict[str, str]] = {}
        try:
            color_map = fastf1.plotting.get_driver_color_mapping(self.session)
        except Exception:
            color_map = {}

        for _, row in self.results.iterrows():
            code = str(row["Abbreviation"])
            self.drivers[code] = {
                "name": str(row.get("FullName", code)),
                "team": str(row.get("TeamName", "Unknown")),
                "color": color_map.get(code, "#CCCCCC"),
                "grid_position": int(row["GridPosition"]) if pd.notna(row.get("GridPosition")) else None,
            }

        # Precompute cumulative times for gap calculations
        self._cumulative_times = self._compute_cumulative_times()

        logger.info(
            "Race state ready: {} {} — {} laps, {} drivers",
            self.event_name,
            self.year,
            self.total_laps,
            len(self.drivers),
        )

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def get_metadata(self) -> dict[str, Any]:
        """Return session metadata for the frontend."""
        drivers_list = [
            {
                "code": code,
                "name": info["name"],
                "team": info["team"],
                "color": info["color"],
            }
            for code, info in self.drivers.items()
        ]
        return {
            "total_laps": self.total_laps,
            "circuit": self.circuit_name,
            "country": self.country,
            "event_name": self.event_name,
            "year": self.year,
            "drivers": drivers_list,
        }

    # ------------------------------------------------------------------
    # Standings
    # ------------------------------------------------------------------

    def get_standings(self, as_of_lap: int) -> list[dict[str, Any]]:
        """Current positions with driver, team, tyre, gap to leader.

        Args:
            as_of_lap: Only consider data up to this lap number.
        """
        lap_data = self.laps[self.laps["LapNumber"] == as_of_lap].copy()
        if lap_data.empty:
            return []

        lap_data = lap_data.sort_values("Position")
        standings = []
        leader_cum_time = None

        for _, row in lap_data.iterrows():
            driver = str(row["Driver"])
            cum_time = self._cumulative_times.get(driver, {}).get(as_of_lap)

            if leader_cum_time is None and cum_time is not None:
                leader_cum_time = cum_time

            gap = None
            if cum_time is not None and leader_cum_time is not None:
                gap = round(cum_time - leader_cum_time, 3)

            standings.append({
                "position": int(row["Position"]) if pd.notna(row["Position"]) else None,
                "driver": driver,
                "team": self.drivers.get(driver, {}).get("team", "Unknown"),
                "compound": str(row["Compound"]) if pd.notna(row.get("Compound")) else None,
                "tyre_age": int(row["TyreLife"]) if pd.notna(row.get("TyreLife")) else None,
                "gap_to_leader": gap,
                "last_lap_time": _td_to_seconds(row["LapTime"]),
                "last_lap_time_str": _format_lap_time(_td_to_seconds(row["LapTime"])),
            })

        return standings

    # ------------------------------------------------------------------
    # Driver info
    # ------------------------------------------------------------------

    def get_driver_info(self, driver_code: str, as_of_lap: int) -> dict[str, Any]:
        """Detailed info for a single driver as of the given lap."""
        driver_laps = self.laps[
            (self.laps["Driver"] == driver_code) & (self.laps["LapNumber"] <= as_of_lap)
        ]
        if driver_laps.empty:
            return {"error": f"No data for driver {driver_code} up to lap {as_of_lap}"}

        current_lap = driver_laps[driver_laps["LapNumber"] == as_of_lap]
        if current_lap.empty:
            current_lap = driver_laps.iloc[[-1]]
        current = current_lap.iloc[0]

        # Recent lap times (last 3)
        recent = driver_laps.tail(3)
        recent_times = [
            {"lap": int(r["LapNumber"]), "time": _td_to_seconds(r["LapTime"])}
            for _, r in recent.iterrows()
        ]

        # Best lap
        valid_laps = driver_laps[driver_laps["LapTime"].notna()]
        best_time = _td_to_seconds(valid_laps["LapTime"].min()) if not valid_laps.empty else None

        # Pit stop count
        pit_stops = driver_laps[driver_laps["PitInTime"].notna()]

        return {
            "driver": driver_code,
            "name": self.drivers.get(driver_code, {}).get("name", driver_code),
            "team": self.drivers.get(driver_code, {}).get("team", "Unknown"),
            "position": int(current["Position"]) if pd.notna(current["Position"]) else None,
            "compound": str(current["Compound"]) if pd.notna(current.get("Compound")) else None,
            "tyre_age": int(current["TyreLife"]) if pd.notna(current.get("TyreLife")) else None,
            "stint": int(current["Stint"]) if pd.notna(current.get("Stint")) else None,
            "total_pit_stops": len(pit_stops),
            "recent_lap_times": recent_times,
            "best_lap_time": best_time,
            "best_lap_time_str": _format_lap_time(best_time),
            "grid_position": self.drivers.get(driver_code, {}).get("grid_position"),
        }

    # ------------------------------------------------------------------
    # Lap times
    # ------------------------------------------------------------------

    def get_lap_times(
        self, driver_code: str, as_of_lap: int, last_n: int | None = 5
    ) -> dict[str, Any]:
        """Lap time history for a driver.

        Args:
            driver_code: Three-letter driver code.
            as_of_lap: Only consider laps up to this number.
            last_n: Number of recent laps to return. None = all laps.
        """
        driver_laps = self.laps[
            (self.laps["Driver"] == driver_code) & (self.laps["LapNumber"] <= as_of_lap)
        ].copy()

        if last_n is not None:
            driver_laps = driver_laps.tail(last_n)

        laps_list = []
        valid_times = []
        for _, row in driver_laps.iterrows():
            t = _td_to_seconds(row["LapTime"])
            laps_list.append({
                "lap": int(row["LapNumber"]),
                "time": t,
                "time_str": _format_lap_time(t),
                "compound": str(row["Compound"]) if pd.notna(row.get("Compound")) else None,
            })
            if t is not None:
                valid_times.append(t)

        avg_pace = round(sum(valid_times) / len(valid_times), 3) if valid_times else None
        best = round(min(valid_times), 3) if valid_times else None

        return {
            "driver": driver_code,
            "laps": laps_list,
            "average_pace": avg_pace,
            "average_pace_str": _format_lap_time(avg_pace),
            "best_lap": best,
            "best_lap_str": _format_lap_time(best),
        }

    # ------------------------------------------------------------------
    # Pit stops
    # ------------------------------------------------------------------

    def get_pit_stops(self, driver_code: str, as_of_lap: int) -> list[dict[str, Any]]:
        """List of pit stops for a driver up to the given lap."""
        driver_laps = self.laps[
            (self.laps["Driver"] == driver_code) & (self.laps["LapNumber"] <= as_of_lap)
        ].sort_values("LapNumber")

        stops = []
        prev_stint = None
        prev_compound = None

        for _, row in driver_laps.iterrows():
            stint = int(row["Stint"]) if pd.notna(row.get("Stint")) else None
            compound = str(row["Compound"]) if pd.notna(row.get("Compound")) else None

            if prev_stint is not None and stint is not None and stint > prev_stint:
                stops.append({
                    "lap": int(row["LapNumber"]),
                    "from_compound": prev_compound,
                    "to_compound": compound,
                    "stint_number": stint,
                })

            prev_stint = stint
            prev_compound = compound

        return stops

    # ------------------------------------------------------------------
    # Stint summary
    # ------------------------------------------------------------------

    def get_stints(self, driver_code: str, as_of_lap: int) -> list[dict[str, Any]]:
        """Stint breakdown for a driver."""
        driver_laps = self.laps[
            (self.laps["Driver"] == driver_code) & (self.laps["LapNumber"] <= as_of_lap)
        ].sort_values("LapNumber")

        if driver_laps.empty:
            return []

        stints = []
        for stint_num, group in driver_laps.groupby("Stint"):
            compound = group["Compound"].iloc[0] if pd.notna(group["Compound"].iloc[0]) else None
            start_lap = int(group["LapNumber"].min())
            end_lap = int(group["LapNumber"].max())
            num_laps = end_lap - start_lap + 1

            # Average pace excluding lap 1 and outliers
            valid = group[(group["LapTime"].notna()) & (group["LapNumber"] > 1)]
            if not valid.empty:
                times = valid["LapTime"].apply(lambda x: x.total_seconds())
                avg = round(times.mean(), 3)
                best = round(times.min(), 3)
            else:
                avg = None
                best = None

            # Degradation: linear fit of lap time vs tyre life
            deg_rate = self._compute_degradation(valid)

            stints.append({
                "stint": int(stint_num),
                "compound": str(compound) if compound else None,
                "start_lap": start_lap,
                "end_lap": end_lap,
                "num_laps": num_laps,
                "average_pace": avg,
                "average_pace_str": _format_lap_time(avg),
                "best_lap": best,
                "best_lap_str": _format_lap_time(best),
                "degradation_rate": deg_rate,
            })

        return stints

    # ------------------------------------------------------------------
    # Tyre degradation
    # ------------------------------------------------------------------

    def get_tyre_degradation(self, driver_code: str, as_of_lap: int) -> dict[str, Any]:
        """Degradation rate for the driver's current stint."""
        driver_laps = self.laps[
            (self.laps["Driver"] == driver_code) & (self.laps["LapNumber"] <= as_of_lap)
        ].sort_values("LapNumber")

        if driver_laps.empty:
            return {"error": f"No data for {driver_code}"}

        current_stint = driver_laps["Stint"].iloc[-1]
        stint_laps = driver_laps[driver_laps["Stint"] == current_stint]
        valid = stint_laps[(stint_laps["LapTime"].notna()) & (stint_laps["LapNumber"] > 1)]

        deg_rate = self._compute_degradation(valid)
        severity = "low"
        if deg_rate is not None:
            if deg_rate >= 0.10:
                severity = "high"
            elif deg_rate >= 0.05:
                severity = "medium"

        compound = str(stint_laps["Compound"].iloc[0]) if pd.notna(stint_laps["Compound"].iloc[0]) else None

        return {
            "driver": driver_code,
            "stint": int(current_stint),
            "compound": compound,
            "stint_laps": len(stint_laps),
            "degradation_rate": deg_rate,
            "severity": severity,
        }

    # ------------------------------------------------------------------
    # Gaps
    # ------------------------------------------------------------------

    def get_gap_to_driver(
        self, driver_a: str, driver_b: str, as_of_lap: int, last_n: int = 5
    ) -> dict[str, Any]:
        """Gap between two drivers and trend."""
        cum_a = self._cumulative_times.get(driver_a, {})
        cum_b = self._cumulative_times.get(driver_b, {})

        time_a = cum_a.get(as_of_lap)
        time_b = cum_b.get(as_of_lap)

        if time_a is None or time_b is None:
            return {
                "driver_a": driver_a,
                "driver_b": driver_b,
                "gap": None,
                "ahead": None,
                "trend": None,
            }

        gap = round(time_a - time_b, 3)
        ahead = driver_b if gap > 0 else driver_a

        # Trend over last N laps
        gaps = []
        for lap in range(max(1, as_of_lap - last_n + 1), as_of_lap + 1):
            a = cum_a.get(lap)
            b = cum_b.get(lap)
            if a is not None and b is not None:
                gaps.append(a - b)

        trend = None
        rate = None
        if len(gaps) >= 2:
            delta = gaps[-1] - gaps[0]
            rate = round(delta / (len(gaps) - 1), 3)
            if abs(delta) < 0.1:
                trend = "stable"
            elif delta > 0:
                trend = "increasing"
            else:
                trend = "decreasing"

        return {
            "driver_a": driver_a,
            "driver_b": driver_b,
            "gap": abs(gap),
            "ahead": ahead,
            "trend": trend,
            "rate_per_lap": rate,
        }

    # ------------------------------------------------------------------
    # Track status
    # ------------------------------------------------------------------

    def get_track_status(self, as_of_lap: int) -> dict[str, Any]:
        """Current track status and history of changes."""
        status_map = {
            "1": "Green",
            "2": "Yellow",
            "4": "Safety Car",
            "5": "Red Flag",
            "6": "VSC",
            "7": "VSC Ending",
        }

        # Map track status changes to approximate lap numbers
        history = []
        if not self.track_status_data.empty:
            for _, row in self.track_status_data.iterrows():
                code = str(row["Status"])
                status_name = status_map.get(code, f"Unknown ({code})")
                msg = str(row.get("Message", ""))
                # Approximate lap from session time
                lap_approx = self._time_to_lap(row["Time"]) if pd.notna(row.get("Time")) else None
                if lap_approx is not None and lap_approx <= as_of_lap:
                    history.append({
                        "lap": lap_approx,
                        "status": status_name,
                        "message": msg,
                    })

        current = history[-1]["status"] if history else "Green"
        return {"current": current, "history": history}

    # ------------------------------------------------------------------
    # Weather
    # ------------------------------------------------------------------

    def get_weather(self, as_of_lap: int) -> dict[str, Any]:
        """Weather conditions at the given lap."""
        if self.weather_data.empty:
            return {"error": "No weather data available"}

        # Find the weather sample closest to the lap completion time
        lap_rows = self.laps[self.laps["LapNumber"] == as_of_lap]
        if lap_rows.empty:
            return {"error": f"No lap data for lap {as_of_lap}"}

        lap_time = lap_rows["Time"].dropna().iloc[0] if not lap_rows["Time"].dropna().empty else None
        if lap_time is None:
            # Fallback: use the latest weather sample
            weather_row = self.weather_data.iloc[-1]
        else:
            idx = (self.weather_data["Time"] - lap_time).abs().idxmin()
            weather_row = self.weather_data.loc[idx]

        return {
            "air_temp": round(float(weather_row["AirTemp"]), 1) if pd.notna(weather_row.get("AirTemp")) else None,
            "track_temp": round(float(weather_row["TrackTemp"]), 1) if pd.notna(weather_row.get("TrackTemp")) else None,
            "humidity": round(float(weather_row["Humidity"]), 1) if pd.notna(weather_row.get("Humidity")) else None,
            "wind_speed": round(float(weather_row["WindSpeed"]), 1) if pd.notna(weather_row.get("WindSpeed")) else None,
            "rainfall": bool(weather_row.get("Rainfall", False)),
        }

    # ------------------------------------------------------------------
    # Race summary
    # ------------------------------------------------------------------

    def get_race_summary(self, as_of_lap: int) -> dict[str, Any]:
        """Key events: pit stops, safety cars, retirements, position changes from grid."""
        # Collect pit stops
        all_pits = []
        for driver in self.drivers:
            for stop in self.get_pit_stops(driver, as_of_lap):
                all_pits.append({"driver": driver, **stop})

        # Safety car laps
        track = self.get_track_status(as_of_lap)
        sc_events = [e for e in track["history"] if e["status"] in ("Safety Car", "VSC", "Red Flag")]

        # Retirements — drivers who stopped completing laps
        retirements = []
        for driver in self.drivers:
            driver_laps = self.laps[
                (self.laps["Driver"] == driver) & (self.laps["LapNumber"] <= as_of_lap)
            ]
            if not driver_laps.empty:
                last_lap = int(driver_laps["LapNumber"].max())
                if last_lap < as_of_lap:
                    retirements.append({"driver": driver, "last_lap": last_lap})

        # Position changes from grid
        standings = self.get_standings(as_of_lap)
        movers = []
        for entry in standings:
            grid = self.drivers.get(entry["driver"], {}).get("grid_position")
            if grid is not None and entry["position"] is not None:
                change = grid - entry["position"]
                if abs(change) >= 2:
                    movers.append({
                        "driver": entry["driver"],
                        "grid": grid,
                        "current": entry["position"],
                        "change": change,
                    })

        return {
            "lap": as_of_lap,
            "total_laps": self.total_laps,
            "pit_stops": all_pits,
            "safety_cars": sc_events,
            "retirements": retirements,
            "position_movers": sorted(movers, key=lambda x: abs(x["change"]), reverse=True),
        }

    # ------------------------------------------------------------------
    # Strategy options
    # ------------------------------------------------------------------

    def get_strategy_options(self, driver_code: str, as_of_lap: int) -> dict[str, Any]:
        """Available compounds and when competitors might pit."""
        stints = self.get_stints(driver_code, as_of_lap)
        used_compounds = {s["compound"] for s in stints if s["compound"]}
        all_compounds = {"SOFT", "MEDIUM", "HARD"}
        available = list(all_compounds - used_compounds) or list(all_compounds)

        # Competitors' tyre states
        standings = self.get_standings(as_of_lap)
        competitor_tyres = []
        for entry in standings:
            if entry["driver"] != driver_code:
                competitor_tyres.append({
                    "driver": entry["driver"],
                    "compound": entry["compound"],
                    "tyre_age": entry["tyre_age"],
                    "position": entry["position"],
                })

        remaining_laps = self.total_laps - as_of_lap

        return {
            "driver": driver_code,
            "remaining_laps": remaining_laps,
            "available_compounds": sorted(available),
            "used_compounds": sorted(used_compounds),
            "competitor_tyres": competitor_tyres,
        }

    # ------------------------------------------------------------------
    # Position history (for charts)
    # ------------------------------------------------------------------

    def get_position_history(self, as_of_lap: int) -> dict[str, list[int | None]]:
        """Position at each lap for all drivers, up to as_of_lap."""
        history: dict[str, list[int | None]] = {}
        for driver in self.drivers:
            positions = []
            for lap in range(1, as_of_lap + 1):
                lap_row = self.laps[
                    (self.laps["Driver"] == driver) & (self.laps["LapNumber"] == lap)
                ]
                if not lap_row.empty and pd.notna(lap_row.iloc[0]["Position"]):
                    positions.append(int(lap_row.iloc[0]["Position"]))
                else:
                    positions.append(None)
            history[driver] = positions
        return history

    # ------------------------------------------------------------------
    # Compare drivers
    # ------------------------------------------------------------------

    def compare_drivers(self, driver_a: str, driver_b: str, as_of_lap: int) -> dict[str, Any]:
        """Head-to-head comparison of two drivers."""
        info_a = self.get_driver_info(driver_a, as_of_lap)
        info_b = self.get_driver_info(driver_b, as_of_lap)
        gap = self.get_gap_to_driver(driver_a, driver_b, as_of_lap)
        pace_a = self.get_lap_times(driver_a, as_of_lap, last_n=5)
        pace_b = self.get_lap_times(driver_b, as_of_lap, last_n=5)

        return {
            "driver_a": info_a,
            "driver_b": info_b,
            "gap": gap,
            "pace_comparison": {
                driver_a: {
                    "avg_last_5": pace_a["average_pace"],
                    "avg_last_5_str": pace_a["average_pace_str"],
                },
                driver_b: {
                    "avg_last_5": pace_b["average_pace"],
                    "avg_last_5_str": pace_b["average_pace_str"],
                },
            },
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_cumulative_times(self) -> dict[str, dict[int, float]]:
        """Precompute cumulative race time per driver per lap."""
        result: dict[str, dict[int, float]] = {}
        for driver in self.laps["Driver"].unique():
            driver_laps = self.laps[self.laps["Driver"] == driver].sort_values("LapNumber")
            cumulative = 0.0
            times: dict[int, float] = {}
            for _, row in driver_laps.iterrows():
                if pd.notna(row["LapTime"]):
                    cumulative += row["LapTime"].total_seconds()
                    times[int(row["LapNumber"])] = round(cumulative, 3)
            result[str(driver)] = times
        return result

    def _compute_degradation(self, valid_laps: pd.DataFrame) -> float | None:
        """Compute tyre degradation rate (seconds per lap) via linear regression."""
        if len(valid_laps) < 3:
            return None
        try:
            x = valid_laps["TyreLife"].values.astype(float)
            y = valid_laps["LapTime"].apply(lambda t: t.total_seconds()).values
            if len(x) < 3 or np.isnan(x).any() or np.isnan(y).any():
                return None
            coeffs = np.polyfit(x, y, 1)
            return round(float(coeffs[0]), 4)
        except Exception:
            return None

    def _time_to_lap(self, session_time: pd.Timedelta) -> int | None:
        """Approximate which lap a session timestamp corresponds to."""
        try:
            completed = self.laps[self.laps["Time"].notna()].copy()
            if completed.empty:
                return None
            idx = (completed["Time"] - session_time).abs().idxmin()
            return int(completed.loc[idx, "LapNumber"])
        except Exception:
            return None
