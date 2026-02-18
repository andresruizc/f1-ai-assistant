"""F1 data loader — download, cache, and explore 2025 season race data via FastF1.

Usage as a library:
    from src.data_loader import F1DataLoader
    loader = F1DataLoader(year=2025)
    schedule = loader.get_schedule()
    session = loader.load_race(round_number=1)
    loader.print_race_summary(session)

Usage as CLI (download all races):
    python -m src.data_loader              # download all 2025 races
    python -m src.data_loader --round 5    # download only round 5
    python -m src.data_loader --info       # show schedule without downloading
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import fastf1
import pandas as pd
from loguru import logger

from src.utils.config import settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _td_to_seconds(td: pd.Timedelta | None) -> float | None:
    """Convert pd.Timedelta to seconds, returning None for NaT."""
    if pd.notna(td):
        return round(td.total_seconds(), 3)
    return None


def _format_lap_time(seconds: float | None) -> str:
    """Format seconds as M:SS.mmm, or '—' if None."""
    if seconds is None:
        return "—"
    mins = int(seconds // 60)
    secs = seconds - mins * 60
    return f"{mins}:{secs:06.3f}"


def _safe_str(val: Any) -> str:
    """Convert a value to string, handling NaN/NaT gracefully."""
    if pd.isna(val):
        return "—"
    return str(val)


def _make_csv_friendly(df: pd.DataFrame) -> pd.DataFrame:
    """Convert a DataFrame to a CSV-friendly format.

    - Timedelta columns → float seconds (NaT → NaN)
    - datetime64 columns → ISO strings
    """
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_timedelta64_dtype(out[col]):
            out[col] = out[col].apply(
                lambda x: round(x.total_seconds(), 3) if pd.notna(x) else None
            )
        elif pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = out[col].astype(str).replace("NaT", "")
    return out


# ---------------------------------------------------------------------------
# F1DataLoader
# ---------------------------------------------------------------------------

class F1DataLoader:
    """Download, cache and explore F1 race sessions for a given season.

    Attributes:
        year: The season year.
        cache_dir: Path to the FastF1 HTTP cache directory.
        schedule: The full season event schedule (loaded lazily).
    """

    def __init__(self, year: int = 2025, cache_dir: str | None = None) -> None:
        self.year = year
        self.cache_dir = cache_dir or settings.get("fastf1", {}).get(
            "cache_dir", "data/.fastf1_cache"
        )
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(self.cache_dir)
        logger.info("FastF1 cache enabled at {}", self.cache_dir)

        self._schedule: pd.DataFrame | None = None
        self._sessions: dict[int, fastf1.core.Session] = {}

    # ------------------------------------------------------------------
    # Schedule
    # ------------------------------------------------------------------

    def get_schedule(self) -> pd.DataFrame:
        """Return the full season event schedule.

        Columns include: RoundNumber, Country, Location, OfficialEventName,
        EventDate, EventFormat, Session1-5 names and dates, etc.
        """
        if self._schedule is None:
            logger.info("Fetching {} season schedule...", self.year)
            self._schedule = fastf1.get_event_schedule(self.year)
            logger.info("Schedule loaded: {} events", len(self._schedule))
        return self._schedule

    def get_race_rounds(self) -> list[dict[str, Any]]:
        """Return a list of race-round dicts with key info.

        Each dict has: round, country, location, event_name, date, event_format.
        Filters out testing events (RoundNumber == 0).
        """
        schedule = self.get_schedule()
        races = schedule[schedule["RoundNumber"] > 0].copy()
        result = []
        for _, row in races.iterrows():
            result.append({
                "round": int(row["RoundNumber"]),
                "country": str(row["Country"]),
                "location": str(row["Location"]),
                "event_name": str(row["OfficialEventName"]),
                "date": str(row["EventDate"].date()) if pd.notna(row["EventDate"]) else "—",
                "event_format": str(row["EventFormat"]),
            })
        return result

    def print_schedule(self) -> None:
        """Print a formatted table of the season schedule."""
        races = self.get_race_rounds()
        print(f"\n{'='*80}")
        print(f"  {self.year} F1 SEASON SCHEDULE — {len(races)} rounds")
        print(f"{'='*80}")
        print(f"  {'Rnd':<5} {'Date':<12} {'Country':<20} {'Event'}")
        print(f"  {'-'*5} {'-'*12} {'-'*20} {'-'*40}")
        for r in races:
            print(f"  {r['round']:<5} {r['date']:<12} {r['country']:<20} {r['event_name']}")
        print()

    # ------------------------------------------------------------------
    # Session loading
    # ------------------------------------------------------------------

    def load_race(self, round_number: int) -> fastf1.core.Session:
        """Load a race session for the given round (cached after first load).

        Args:
            round_number: 1-based round number in the season.

        Returns:
            A fully loaded fastf1 Session object.

        Raises:
            ValueError: If the round number is not in the schedule.
            RuntimeError: If the session fails to load (e.g. race hasn't happened).
        """
        if round_number in self._sessions:
            logger.debug("Returning cached session for round {}", round_number)
            return self._sessions[round_number]

        schedule = self.get_schedule()
        valid_rounds = schedule[schedule["RoundNumber"] > 0]["RoundNumber"].tolist()
        if round_number not in valid_rounds:
            raise ValueError(
                f"Round {round_number} not found in {self.year} schedule. "
                f"Valid rounds: {valid_rounds}"
            )

        event = schedule[schedule["RoundNumber"] == round_number].iloc[0]
        event_name = event["OfficialEventName"]
        logger.info(
            "Loading race session: Round {} — {} ({})",
            round_number, event_name, event["Country"],
        )

        try:
            session = fastf1.get_session(self.year, round_number, "R")
            session.load()
        except Exception as exc:
            raise RuntimeError(
                f"Failed to load Round {round_number} ({event_name}): {exc}"
            ) from exc

        self._sessions[round_number] = session
        logger.info(
            "Session loaded: {} laps, {} drivers",
            int(session.laps["LapNumber"].max()) if not session.laps.empty else 0,
            session.laps["Driver"].nunique() if not session.laps.empty else 0,
        )
        return session

    def download_all_races(self, *, stop_on_error: bool = False) -> dict[int, fastf1.core.Session]:
        """Download (or load from cache) all race sessions in the season.

        Args:
            stop_on_error: If True, raise on the first failure.
                           If False (default), log the error and continue.

        Returns:
            Dict mapping round_number -> loaded Session.
        """
        races = self.get_race_rounds()
        total = len(races)
        loaded = 0
        failed = 0

        print(f"\nDownloading {total} race sessions for {self.year}...\n")

        for race in races:
            rnd = race["round"]
            try:
                self.load_race(rnd)
                loaded += 1
                print(f"  [{loaded}/{total}] ✓ Round {rnd:>2}: {race['event_name']}")
            except Exception as exc:
                failed += 1
                msg = f"  [{loaded + failed}/{total}] ✗ Round {rnd:>2}: {race['event_name']} — {exc}"
                print(msg)
                logger.error("Failed to load round {}: {}", rnd, exc)
                if stop_on_error:
                    raise

        print(f"\nDone: {loaded} loaded, {failed} failed out of {total} rounds.\n")
        return dict(self._sessions)

    # ------------------------------------------------------------------
    # Data exploration — session level
    # ------------------------------------------------------------------

    def get_race_summary(self, session: fastf1.core.Session) -> dict[str, Any]:
        """Extract key facts from a loaded race session.

        Returns a dict with: event_name, circuit, country, date, total_laps,
        num_drivers, winner, podium, fastest_lap, dnfs.
        """
        laps = session.laps
        results = session.results

        total_laps = int(laps["LapNumber"].max()) if not laps.empty else 0
        num_drivers = laps["Driver"].nunique() if not laps.empty else 0

        # Winner & podium from results
        podium = []
        winner = "—"
        if not results.empty:
            top3 = results.sort_values("Position").head(3)
            for _, row in top3.iterrows():
                entry = {
                    "position": int(row["Position"]) if pd.notna(row["Position"]) else None,
                    "driver": _safe_str(row["Abbreviation"]),
                    "name": _safe_str(row.get("FullName", row["Abbreviation"])),
                    "team": _safe_str(row.get("TeamName", "—")),
                    "status": _safe_str(row.get("Status", "—")),
                }
                podium.append(entry)
            if podium:
                winner = f"{podium[0]['name']} ({podium[0]['driver']})"

        # Fastest lap
        valid_laps = laps[laps["LapTime"].notna() & (laps["LapNumber"] > 1)].copy()
        fastest_lap: dict[str, Any] = {}
        if not valid_laps.empty:
            fastest_idx = valid_laps["LapTime"].idxmin()
            fl = valid_laps.loc[fastest_idx]
            fl_seconds = _td_to_seconds(fl["LapTime"])
            fastest_lap = {
                "driver": str(fl["Driver"]),
                "lap": int(fl["LapNumber"]),
                "time": fl_seconds,
                "time_str": _format_lap_time(fl_seconds),
            }

        # DNFs: drivers who didn't finish all laps
        dnfs = []
        if not results.empty:
            for _, row in results.iterrows():
                status = str(row.get("Status", ""))
                if status and status not in ("Finished", "") and "Lap" not in status:
                    dnfs.append({
                        "driver": _safe_str(row["Abbreviation"]),
                        "status": status,
                    })

        event = session.event
        return {
            "event_name": str(event["EventName"]),
            "circuit": str(event["Location"]),
            "country": str(event["Country"]),
            "date": str(event["EventDate"].date()) if pd.notna(event.get("EventDate")) else "—",
            "total_laps": total_laps,
            "num_drivers": num_drivers,
            "winner": winner,
            "podium": podium,
            "fastest_lap": fastest_lap,
            "dnfs": dnfs,
        }

    def print_race_summary(self, session: fastf1.core.Session) -> None:
        """Print a human-readable summary of a race."""
        s = self.get_race_summary(session)
        print(f"\n{'='*60}")
        print(f"  {s['event_name']} — {s['country']}")
        print(f"  {s['circuit']} | {s['date']}")
        print(f"{'='*60}")
        print(f"  Laps: {s['total_laps']}  |  Drivers: {s['num_drivers']}")
        print(f"  Winner: {s['winner']}")
        if s["podium"]:
            print(f"\n  Podium:")
            for p in s["podium"]:
                print(f"    P{p['position']}: {p['name']} ({p['driver']}) — {p['team']}")
        if s["fastest_lap"]:
            fl = s["fastest_lap"]
            print(f"\n  Fastest Lap: {fl['driver']} — {fl['time_str']} (lap {fl['lap']})")
        if s["dnfs"]:
            print(f"\n  DNFs ({len(s['dnfs'])}):")
            for d in s["dnfs"]:
                print(f"    {d['driver']}: {d['status']}")
        print()

    # ------------------------------------------------------------------
    # Data exploration — laps
    # ------------------------------------------------------------------

    def get_laps_df(self, session: fastf1.core.Session) -> pd.DataFrame:
        """Return the session's laps DataFrame with cleaned-up columns.

        Adds a 'LapTimeSeconds' column (float or NaN) for easy analysis.
        """
        laps = session.laps.copy()
        laps["LapTimeSeconds"] = laps["LapTime"].apply(
            lambda x: x.total_seconds() if pd.notna(x) else float("nan")
        )
        return laps

    def get_drivers(self, session: fastf1.core.Session) -> list[dict[str, str]]:
        """Return the list of drivers in the session with code, name, team."""
        results = session.results
        drivers = []
        for _, row in results.iterrows():
            drivers.append({
                "code": _safe_str(row["Abbreviation"]),
                "number": _safe_str(row["DriverNumber"]),
                "name": _safe_str(row.get("FullName", row["Abbreviation"])),
                "team": _safe_str(row.get("TeamName", "—")),
                "grid": int(row["GridPosition"]) if pd.notna(row.get("GridPosition")) else None,
                "position": int(row["Position"]) if pd.notna(row.get("Position")) else None,
                "status": _safe_str(row.get("Status", "—")),
            })
        return drivers

    def get_driver_laps(
        self,
        session: fastf1.core.Session,
        driver_code: str,
    ) -> pd.DataFrame:
        """Return all laps for a specific driver, sorted by LapNumber.

        Includes the computed LapTimeSeconds column.
        """
        laps = self.get_laps_df(session)
        driver_laps = laps[laps["Driver"] == driver_code].sort_values("LapNumber").copy()
        if driver_laps.empty:
            logger.warning("No laps found for driver '{}' in this session", driver_code)
        return driver_laps

    def get_stint_summary(
        self,
        session: fastf1.core.Session,
        driver_code: str,
    ) -> list[dict[str, Any]]:
        """Breakdown of stints for a driver: compound, laps, avg pace, degradation.

        Excludes lap 1 and pit in/out laps from pace calculations.
        """
        laps = self.get_driver_laps(session, driver_code)
        if laps.empty:
            return []

        stints = []
        for stint_num, group in laps.groupby("Stint"):
            compound = str(group["Compound"].iloc[0]) if pd.notna(group["Compound"].iloc[0]) else "—"
            start_lap = int(group["LapNumber"].min())
            end_lap = int(group["LapNumber"].max())
            num_laps = end_lap - start_lap + 1

            # Clean laps: exclude lap 1 and NaT times
            clean = group[
                (group["LapTime"].notna())
                & (group["LapNumber"] > 1)
            ]
            times_sec = clean["LapTimeSeconds"].dropna()

            avg_pace = round(float(times_sec.mean()), 3) if not times_sec.empty else None
            best_pace = round(float(times_sec.min()), 3) if not times_sec.empty else None

            stints.append({
                "stint": int(stint_num),
                "compound": compound,
                "start_lap": start_lap,
                "end_lap": end_lap,
                "num_laps": num_laps,
                "avg_pace": avg_pace,
                "avg_pace_str": _format_lap_time(avg_pace),
                "best_lap": best_pace,
                "best_lap_str": _format_lap_time(best_pace),
            })

        return stints

    def get_pit_stops(
        self,
        session: fastf1.core.Session,
        driver_code: str,
    ) -> list[dict[str, Any]]:
        """List pit stops for a driver: lap, compound change, stint numbers."""
        laps = self.get_driver_laps(session, driver_code)
        if laps.empty:
            return []

        stops = []
        prev_stint = None
        prev_compound = None

        for _, row in laps.iterrows():
            stint = int(row["Stint"]) if pd.notna(row.get("Stint")) else None
            compound = str(row["Compound"]) if pd.notna(row.get("Compound")) else None

            if prev_stint is not None and stint is not None and stint > prev_stint:
                stops.append({
                    "lap": int(row["LapNumber"]),
                    "from_compound": prev_compound,
                    "to_compound": compound,
                    "new_stint": stint,
                })

            prev_stint = stint
            prev_compound = compound

        return stops

    # ------------------------------------------------------------------
    # Per-lap telemetry (merged car_data + pos_data + computed fields)
    # ------------------------------------------------------------------

    def get_lap_telemetry(
        self,
        session: fastf1.core.Session,
        driver_code: str,
        lap_number: int,
    ) -> pd.DataFrame:
        """Get merged telemetry for a specific driver and lap.

        This calls FastF1's lap.get_telemetry() which merges car_data and
        pos_data and adds computed columns not available in either:
          - Distance: meters traveled from lap start
          - RelativeDistance: 0.0–1.0 fraction of lap completed
          - DriverAhead: three-letter code of the car directly ahead
          - DistanceToDriverAhead: gap in meters to the car in front

        Returns an empty DataFrame if the lap is not found.
        """
        driver_laps = session.laps.pick_drivers(driver_code)
        lap_row = driver_laps[driver_laps["LapNumber"] == lap_number]

        if lap_row.empty:
            logger.warning("No lap {} found for driver {}", lap_number, driver_code)
            return pd.DataFrame()

        try:
            telemetry = lap_row.iloc[0].get_telemetry()
            telemetry["Driver"] = driver_code
            telemetry["LapNumber"] = lap_number
            return telemetry
        except Exception as exc:
            logger.warning(
                "Could not get telemetry for {} lap {}: {}", driver_code, lap_number, exc
            )
            return pd.DataFrame()

    def get_driver_telemetry(
        self,
        session: fastf1.core.Session,
        driver_code: str,
        laps: list[int] | None = None,
    ) -> pd.DataFrame:
        """Get merged telemetry for all (or specific) laps of a driver.

        Each row is tagged with Driver and LapNumber so you can filter/group.

        Args:
            session: A loaded FastF1 session.
            driver_code: Three-letter driver code.
            laps: Optional list of lap numbers. None = all laps.

        Returns:
            A single DataFrame with all laps concatenated.
        """
        driver_laps = session.laps.pick_drivers(driver_code).sort_values("LapNumber")
        if driver_laps.empty:
            logger.warning("No laps found for driver {}", driver_code)
            return pd.DataFrame()

        if laps is not None:
            driver_laps = driver_laps[driver_laps["LapNumber"].isin(laps)]

        frames = []
        for _, lap_row in driver_laps.iterrows():
            lap_num = int(lap_row["LapNumber"])
            try:
                tel = lap_row.get_telemetry()
                tel["Driver"] = driver_code
                tel["LapNumber"] = lap_num
                frames.append(tel)
            except Exception:
                logger.debug("Skipping telemetry for {} lap {}", driver_code, lap_num)
                continue

        if not frames:
            return pd.DataFrame()

        return pd.concat(frames, ignore_index=True)

    def export_lap_telemetry(
        self,
        session: fastf1.core.Session,
        driver_code: str,
        lap_number: int,
        output_dir: str | Path | None = None,
    ) -> Path | None:
        """Export merged telemetry for a single lap to CSV.

        Saved as: {output_dir}/telemetry/{driver}_{lap:02d}.csv
        """
        tel = self.get_lap_telemetry(session, driver_code, lap_number)
        if tel.empty:
            return None

        out = self._output_dir_for_session(session, output_dir) / "telemetry"
        out.mkdir(parents=True, exist_ok=True)

        filename = f"{driver_code}_lap{lap_number:02d}.csv"
        csv_path = out / filename
        friendly = _make_csv_friendly(tel)
        friendly.to_csv(csv_path, index=False)
        logger.info("Exported telemetry: {}", csv_path)
        return csv_path

    def export_driver_telemetry(
        self,
        session: fastf1.core.Session,
        driver_code: str,
        output_dir: str | Path | None = None,
        laps: list[int] | None = None,
    ) -> Path | None:
        """Export merged telemetry for all laps of a driver to a single CSV.

        Saved as: {output_dir}/telemetry/{driver}_all_laps.csv
        Each row has Driver and LapNumber columns for filtering.
        """
        tel = self.get_driver_telemetry(session, driver_code, laps=laps)
        if tel.empty:
            return None

        out = self._output_dir_for_session(session, output_dir) / "telemetry"
        out.mkdir(parents=True, exist_ok=True)

        filename = f"{driver_code}_all_laps.csv"
        csv_path = out / filename
        friendly = _make_csv_friendly(tel)
        friendly.to_csv(csv_path, index=False)

        num_laps = tel["LapNumber"].nunique()
        logger.info("Exported telemetry for {} ({} laps, {} rows): {}", driver_code, num_laps, len(tel), csv_path)
        print(f"    telemetry/{filename} ({num_laps} laps, {len(tel)} rows)")
        return csv_path

    # ------------------------------------------------------------------
    # Smart lap filtering
    # ------------------------------------------------------------------

    def get_quicklaps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return only representative fast laps (no pit in/out, no lap 1, no SC).

        FastF1's pick_quicklaps() uses a threshold-based filter: it excludes
        laps slower than 107% of the fastest lap (configurable). This removes
        pit laps, safety car laps, lap 1, and outliers in one call.
        """
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        quick = laps.pick_quicklaps()
        quick = quick.copy()
        quick["LapTimeSeconds"] = quick["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return quick

    def get_clean_laps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return laps without pit in-laps and out-laps.

        Removes laps where the driver entered or exited the pit lane.
        More inclusive than pick_quicklaps — keeps SC laps and lap 1.
        """
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        clean = laps.pick_wo_box()
        clean = clean.copy()
        clean["LapTimeSeconds"] = clean["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return clean

    def get_accurate_laps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return only laps where FastF1 considers timing data reliable.

        Filters on the IsAccurate flag — removes laps with interpolated
        or estimated timing.
        """
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        accurate = laps.pick_accurate()
        accurate = accurate.copy()
        accurate["LapTimeSeconds"] = accurate["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return accurate

    def get_laps_by_compound(
        self, session: fastf1.core.Session, compound: str, driver_code: str | None = None,
    ) -> pd.DataFrame:
        """Return only laps on a specific tyre compound.

        Args:
            compound: One of SOFT, MEDIUM, HARD, INTERMEDIATE, WET.
        """
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        filtered = laps.pick_compounds(compound)
        filtered = filtered.copy()
        filtered["LapTimeSeconds"] = filtered["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return filtered

    def get_green_flag_laps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return only laps run under green flag conditions.

        Excludes safety car, VSC, yellow, and red flag laps.
        """
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        green = laps.pick_track_status("1")
        green = green.copy()
        green["LapTimeSeconds"] = green["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return green

    def get_box_laps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return only pit in-laps and out-laps."""
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        box = laps.pick_box_laps()
        box = box.copy()
        box["LapTimeSeconds"] = box["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return box

    def get_valid_laps(self, session: fastf1.core.Session, driver_code: str | None = None) -> pd.DataFrame:
        """Return laps that were not deleted for track limits."""
        laps = session.laps
        if driver_code:
            laps = laps.pick_drivers(driver_code)
        valid = laps.pick_not_deleted()
        valid = valid.copy()
        valid["LapTimeSeconds"] = valid["LapTime"].apply(
            lambda x: round(x.total_seconds(), 3) if pd.notna(x) else float("nan")
        )
        return valid

    def print_lap_filter_summary(self, session: fastf1.core.Session) -> None:
        """Print a summary of how many laps pass each filter."""
        total = len(session.laps)
        event = session.event
        print(f"\n{'='*60}")
        print(f"  Lap Filters — {event['EventName']} {self.year}")
        print(f"{'='*60}")
        print(f"  {'Filter':<30} {'Laps':>6} {'%':>7}")
        print(f"  {'-'*30} {'-'*6} {'-'*7}")

        filters = [
            ("All laps", session.laps),
            ("Accurate only", session.laps.pick_accurate()),
            ("Without pit in/out", session.laps.pick_wo_box()),
            ("Quick laps (rep. pace)", session.laps.pick_quicklaps()),
            ("Not deleted", session.laps.pick_not_deleted()),
            ("Green flag only", session.laps.pick_track_status("1")),
            ("Pit in/out laps only", session.laps.pick_box_laps()),
        ]
        for name, df in filters:
            count = len(df)
            pct = (count / total * 100) if total > 0 else 0
            print(f"  {name:<30} {count:>6} {pct:>6.1f}%")
        print()

    def get_weather_summary(self, session: fastf1.core.Session) -> dict[str, Any]:
        """Summarise weather conditions during the race."""
        wd = session.weather_data
        if wd is None or wd.empty:
            return {"available": False}

        return {
            "available": True,
            "air_temp_min": round(float(wd["AirTemp"].min()), 1),
            "air_temp_max": round(float(wd["AirTemp"].max()), 1),
            "track_temp_min": round(float(wd["TrackTemp"].min()), 1),
            "track_temp_max": round(float(wd["TrackTemp"].max()), 1),
            "humidity_avg": round(float(wd["Humidity"].mean()), 1),
            "rainfall": bool(wd["Rainfall"].any()),
            "samples": len(wd),
        }

    def get_track_status_events(self, session: fastf1.core.Session) -> list[dict[str, str]]:
        """Return a list of track status changes (safety car, VSC, red flag, etc.)."""
        status_map = {
            "1": "Green",
            "2": "Yellow",
            "4": "Safety Car",
            "5": "Red Flag",
            "6": "VSC",
            "7": "VSC Ending",
        }
        ts = session.track_status
        if ts is None or ts.empty:
            return []

        events = []
        for _, row in ts.iterrows():
            code = str(row["Status"])
            events.append({
                "status_code": code,
                "status": status_map.get(code, f"Unknown ({code})"),
                "message": _safe_str(row.get("Message", "")),
            })
        return events

    # ------------------------------------------------------------------
    # Data shape inspection (for understanding the raw DataFrames)
    # ------------------------------------------------------------------

    def inspect_dataframes(self, session: fastf1.core.Session) -> dict[str, dict[str, Any]]:
        """Return shape, columns, and dtypes for all key DataFrames in a session.

        Useful for understanding what data is available and its structure.
        """
        dfs = {
            "laps": session.laps,
            "results": session.results,
            "weather_data": session.weather_data,
            "track_status": session.track_status,
        }
        info = {}
        for name, df in dfs.items():
            if df is None or df.empty:
                info[name] = {"available": False, "rows": 0, "columns": []}
                continue
            info[name] = {
                "available": True,
                "rows": len(df),
                "cols": len(df.columns),
                "columns": list(df.columns),
                "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
                "sample_values": {
                    col: _safe_str(df[col].iloc[0]) for col in df.columns[:10]
                },
            }
        return info

    def print_dataframe_info(self, session: fastf1.core.Session) -> None:
        """Print a formatted overview of all DataFrames in the session."""
        info = self.inspect_dataframes(session)
        event = session.event
        print(f"\n{'='*70}")
        print(f"  DataFrame Inspection — {event['EventName']} {self.year}")
        print(f"{'='*70}")

        for name, meta in info.items():
            if not meta["available"]:
                print(f"\n  {name}: (empty or not available)")
                continue
            print(f"\n  {name}: {meta['rows']} rows × {meta['cols']} columns")
            print(f"  {'Column':<25} {'Dtype':<25} {'Sample Value'}")
            print(f"  {'-'*25} {'-'*25} {'-'*25}")
            for col in meta["columns"]:
                dtype = meta["dtypes"].get(col, "—")
                sample = meta.get("sample_values", {}).get(col, "—")
                # Truncate long sample values
                sample_str = str(sample)[:40]
                print(f"  {col:<25} {dtype:<25} {sample_str}")
        print()

    # ------------------------------------------------------------------
    # CSV export
    # ------------------------------------------------------------------

    def _output_dir_for_session(
        self, session: fastf1.core.Session, output_dir: str | Path | None = None,
    ) -> Path:
        """Resolve the output directory for a session export."""
        if output_dir is not None:
            return Path(output_dir)
        event = session.event
        round_num = int(event["RoundNumber"])
        location = str(event["Location"]).lower().replace(" ", "_")
        return Path("data") / "exports" / str(self.year) / f"round_{round_num:02d}_{location}"

    def _export_df(self, df: pd.DataFrame, path: Path, name: str) -> str | None:
        """Export a single DataFrame to CSV. Returns a summary string or None."""
        if df is None or df.empty:
            logger.debug("Skipping {} (empty)", name)
            return None
        friendly = _make_csv_friendly(df)
        friendly.to_csv(path, index=False)
        logger.debug("Exported {}", path)
        return f"{path.name} ({len(df)} rows)"

    def export_race_to_csv(
        self,
        session: fastf1.core.Session,
        output_dir: str | Path | None = None,
        *,
        include_telemetry: bool = False,
    ) -> Path:
        """Export all DataFrames from a race session to CSV files.

        Creates a folder structure like:
            data/exports/2025/round_01_melbourne/
                laps.csv                 # always
                results.csv              # always
                weather.csv              # always
                track_status.csv         # always
                race_control_messages.csv # always
                circuit_info.csv         # always
                car_data/                # --telemetry only
                    VER.csv
                    NOR.csv
                    ...
                pos_data/                # --telemetry only
                    VER.csv
                    NOR.csv
                    ...

        All Timedelta columns are converted to float seconds.

        Args:
            session: A loaded FastF1 session.
            output_dir: Override the output directory.
            include_telemetry: If True, also export car_data and pos_data
                               per driver (warning: very large files).

        Returns:
            Path to the output directory.
        """
        out = self._output_dir_for_session(session, output_dir)
        out.mkdir(parents=True, exist_ok=True)

        event = session.event
        round_num = int(event["RoundNumber"])
        exported: list[str] = []

        # --- Core DataFrames (always exported) ---
        core_dfs: dict[str, pd.DataFrame | None] = {
            "laps": session.laps,
            "results": session.results,
            "weather": session.weather_data,
            "track_status": session.track_status,
            "race_control_messages": session.race_control_messages,
        }
        for name, df in core_dfs.items():
            result = self._export_df(df, out / f"{name}.csv", name)
            if result:
                exported.append(result)

        # --- Circuit info (corners + rotation) ---
        try:
            ci = session.get_circuit_info()
            corners_df = ci.corners.copy()
            corners_df["Rotation"] = ci.rotation
            result = self._export_df(corners_df, out / "circuit_info.csv", "circuit_info")
            if result:
                exported.append(result)
        except Exception as exc:
            logger.debug("Could not export circuit_info: {}", exc)

        # --- Telemetry (opt-in, per-driver) ---
        if include_telemetry:
            driver_map = self._build_driver_number_map(session)

            # Car data (speed, RPM, throttle, brake, gear, DRS)
            car_dir = out / "car_data"
            car_dir.mkdir(exist_ok=True)
            car_data = session.car_data
            if isinstance(car_data, dict):
                total_car_rows = 0
                for driver_num, df in car_data.items():
                    code = driver_map.get(str(driver_num), str(driver_num))
                    result = self._export_df(df, car_dir / f"{code}.csv", f"car_data/{code}")
                    if result:
                        total_car_rows += len(df)
                exported.append(f"car_data/ ({len(car_data)} drivers, {total_car_rows} rows)")

            # Position data (X, Y, Z GPS coordinates)
            pos_dir = out / "pos_data"
            pos_dir.mkdir(exist_ok=True)
            pos_data = session.pos_data
            if isinstance(pos_data, dict):
                total_pos_rows = 0
                for driver_num, df in pos_data.items():
                    code = driver_map.get(str(driver_num), str(driver_num))
                    result = self._export_df(df, pos_dir / f"{code}.csv", f"pos_data/{code}")
                    if result:
                        total_pos_rows += len(df)
                exported.append(f"pos_data/ ({len(pos_data)} drivers, {total_pos_rows} rows)")

        logger.info(
            "Exported Round {} ({}) → {}",
            round_num, event["EventName"], out,
        )
        print(f"  Exported to {out}/")
        for item in exported:
            print(f"    {item}")

        return out

    def export_all_races_to_csv(
        self,
        output_dir: str | Path | None = None,
        *,
        include_telemetry: bool = False,
    ) -> list[Path]:
        """Export all loaded race sessions to CSV.

        Sessions must be loaded first (via load_race or download_all_races).

        Returns:
            List of output directory paths.
        """
        if not self._sessions:
            logger.warning("No sessions loaded. Call load_race() or download_all_races() first.")
            return []

        paths = []
        for rnd in sorted(self._sessions):
            session = self._sessions[rnd]
            path = self.export_race_to_csv(
                session, output_dir=output_dir, include_telemetry=include_telemetry,
            )
            paths.append(path)

        print(f"\nExported {len(paths)} races to CSV.")
        return paths

    def export_merged_telemetry(
        self,
        session: fastf1.core.Session,
        output_dir: str | Path | None = None,
        *,
        driver_code: str | None = None,
        lap_number: int | None = None,
    ) -> Path:
        """Export merged per-lap telemetry to CSV (car + pos + computed fields).

        Modes:
          - driver + lap: single file  telemetry/{DRIVER}_lap{NN}.csv
          - driver only:  single file  telemetry/{DRIVER}_all_laps.csv
          - neither:      one file per driver in telemetry/

        Returns the telemetry output directory.
        """
        out = self._output_dir_for_session(session, output_dir) / "telemetry"
        out.mkdir(parents=True, exist_ok=True)
        event = session.event

        if driver_code and lap_number:
            self.export_lap_telemetry(session, driver_code, lap_number, output_dir=self._output_dir_for_session(session, output_dir))
        elif driver_code:
            self.export_driver_telemetry(session, driver_code, output_dir=self._output_dir_for_session(session, output_dir))
        else:
            drivers = [str(row["Abbreviation"]) for _, row in session.results.iterrows()]
            total = len(drivers)
            print(f"\n  Exporting merged telemetry for {total} drivers...")
            for i, code in enumerate(drivers, 1):
                self.export_driver_telemetry(session, code, output_dir=self._output_dir_for_session(session, output_dir))
                logger.debug("Merged telemetry [{}/{}]: {}", i, total, code)

        logger.info("Merged telemetry export for {} → {}", event["EventName"], out)
        return out

    def apply_lap_filter(
        self,
        session: fastf1.core.Session,
        filter_name: str,
        driver_code: str | None = None,
        compound: str | None = None,
    ) -> pd.DataFrame:
        """Apply a named lap filter and return the filtered DataFrame.

        Args:
            filter_name: One of 'quick', 'clean', 'accurate', 'green', 'box', 'valid'.
            driver_code: Optional driver code to scope the filter.
            compound: Required when filter_name is 'compound'.

        Returns:
            Filtered laps DataFrame with LapTimeSeconds column.
        """
        filter_map = {
            "quick": self.get_quicklaps,
            "clean": self.get_clean_laps,
            "accurate": self.get_accurate_laps,
            "green": self.get_green_flag_laps,
            "box": self.get_box_laps,
            "valid": self.get_valid_laps,
        }

        if filter_name == "compound":
            if not compound:
                raise ValueError("--compound is required when using --filter compound")
            return self.get_laps_by_compound(session, compound.upper(), driver_code)

        if filter_name not in filter_map:
            raise ValueError(
                f"Unknown filter '{filter_name}'. "
                f"Valid filters: {', '.join(list(filter_map.keys()) + ['compound'])}"
            )

        return filter_map[filter_name](session, driver_code)

    def export_filtered_laps(
        self,
        session: fastf1.core.Session,
        filter_name: str,
        driver_code: str | None = None,
        compound: str | None = None,
        output_dir: str | Path | None = None,
    ) -> Path:
        """Export filtered laps to CSV.

        Saved as: {output_dir}/laps_filtered_{filter_name}.csv
        """
        filtered = self.apply_lap_filter(session, filter_name, driver_code, compound)
        out = self._output_dir_for_session(session, output_dir)
        out.mkdir(parents=True, exist_ok=True)

        suffix = filter_name
        if compound and filter_name == "compound":
            suffix = f"compound_{compound.lower()}"
        if driver_code:
            suffix = f"{driver_code}_{suffix}"

        filename = f"laps_filtered_{suffix}.csv"
        path = out / filename
        friendly = _make_csv_friendly(filtered)
        friendly.to_csv(path, index=False)

        print(f"  Exported {filename} ({len(filtered)} laps)")
        logger.info("Filtered laps ({}) → {}", filter_name, path)
        return path

    def _build_driver_number_map(self, session: fastf1.core.Session) -> dict[str, str]:
        """Map driver numbers (str) to three-letter codes for file naming."""
        mapping: dict[str, str] = {}
        if session.results is not None and not session.results.empty:
            for _, row in session.results.iterrows():
                num = str(row.get("DriverNumber", ""))
                code = str(row.get("Abbreviation", num))
                if num:
                    mapping[num] = code
        return mapping


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _run_session_actions(
    loader: F1DataLoader,
    session: fastf1.core.Session,
    args: Any,
) -> None:
    """Run all requested actions (inspect, export, filter, telemetry) on a session."""
    loader.print_race_summary(session)

    if args.inspect:
        loader.print_dataframe_info(session)

    if args.filter_summary:
        loader.print_lap_filter_summary(session)

    if args.filter:
        filtered = loader.apply_lap_filter(
            session, args.filter,
            driver_code=args.driver,
            compound=args.compound,
        )
        count = len(filtered)
        total = len(session.laps)
        pct = (count / total * 100) if total > 0 else 0
        driver_msg = f" for {args.driver}" if args.driver else ""
        compound_msg = f" ({args.compound.upper()})" if args.compound else ""
        print(f"  Filter '{args.filter}'{compound_msg}{driver_msg}: {count}/{total} laps ({pct:.1f}%)")

        if args.export:
            loader.export_filtered_laps(
                session, args.filter,
                driver_code=args.driver,
                compound=args.compound,
            )

    if args.export:
        loader.export_race_to_csv(session, include_telemetry=args.telemetry)

    if args.merged_telemetry:
        loader.export_merged_telemetry(
            session,
            driver_code=args.driver,
            lap_number=args.lap,
        )


def main() -> None:
    """CLI entry point for downloading and exploring F1 data."""
    import argparse

    parser = argparse.ArgumentParser(
        description="F1 Data Loader — download and explore 2025 season race data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  f1-data-loader --info                              Show season schedule
  f1-data-loader --round 1                           Load round 1 and print summary
  f1-data-loader --round 1 --export                  Export core CSVs for round 1
  f1-data-loader --round 1 --export --telemetry      Also export raw car/pos data
  f1-data-loader --round 1 --merged-telemetry        Export merged per-lap telemetry
  f1-data-loader --round 1 --merged-telemetry --driver VER
                                                     Merged telemetry for one driver
  f1-data-loader --round 1 --merged-telemetry --driver VER --lap 43
                                                     Single lap merged telemetry
  f1-data-loader --round 1 --filter-summary          Print lap filter statistics
  f1-data-loader --round 1 --filter quick            Show quick-lap count
  f1-data-loader --round 1 --filter quick --export   Export quick laps to CSV
  f1-data-loader --round 1 --filter compound --compound HARD --driver VER
                                                     VER's hard-compound laps
""",
    )
    parser.add_argument(
        "--year", type=int, default=2025, help="Season year (default: 2025)"
    )
    parser.add_argument(
        "--round", type=int, default=None, dest="round_number",
        help="Download only this round number"
    )
    parser.add_argument(
        "--info", action="store_true",
        help="Show schedule without downloading sessions"
    )
    parser.add_argument(
        "--inspect", action="store_true",
        help="Inspect DataFrame structures after loading"
    )
    parser.add_argument(
        "--export", action="store_true",
        help="Export DataFrames to CSV files in data/exports/"
    )
    parser.add_argument(
        "--telemetry", action="store_true",
        help="Include raw car_data and pos_data per driver in export (large)"
    )
    parser.add_argument(
        "--merged-telemetry", action="store_true",
        help="Export merged per-lap telemetry (car + GPS + computed fields)"
    )
    parser.add_argument(
        "--driver", type=str, default=None,
        help="Driver code to scope telemetry/filter to (e.g. VER, NOR)"
    )
    parser.add_argument(
        "--lap", type=int, default=None,
        help="Lap number for single-lap telemetry export (requires --driver)"
    )
    parser.add_argument(
        "--filter", type=str, default=None,
        choices=["quick", "clean", "accurate", "green", "box", "valid", "compound"],
        help="Apply a lap filter: quick, clean, accurate, green, box, valid, compound"
    )
    parser.add_argument(
        "--compound", type=str, default=None,
        help="Tyre compound for --filter compound (SOFT, MEDIUM, HARD, INTERMEDIATE, WET)"
    )
    parser.add_argument(
        "--filter-summary", action="store_true",
        help="Print a summary table of all lap filters"
    )
    parser.add_argument(
        "--cache-dir", type=str, default=None,
        help="Override FastF1 cache directory"
    )
    args = parser.parse_args()

    # --- Validation ---
    if args.lap and not args.driver:
        parser.error("--lap requires --driver")
    if args.lap and not args.merged_telemetry:
        parser.error("--lap requires --merged-telemetry")
    if args.filter == "compound" and not args.compound:
        parser.error("--filter compound requires --compound")

    loader = F1DataLoader(year=args.year, cache_dir=args.cache_dir)

    loader.print_schedule()

    if args.info:
        return

    if args.round_number is not None:
        session = loader.load_race(args.round_number)
        _run_session_actions(loader, session, args)
    else:
        sessions = loader.download_all_races()
        for _rnd, session in sorted(sessions.items()):
            _run_session_actions(loader, session, args)


if __name__ == "__main__":
    main()
