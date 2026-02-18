"""Race data endpoints — schedules, load, standings, position history, track status, drivers."""

import fastf1
from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel

from src.api.services import RaceService
from src.utils.config import settings

router = APIRouter()


class LoadRaceRequest(BaseModel):
    year: int
    round_number: int


@router.get("/schedules/{year}")
async def get_schedule(year: int) -> list[dict]:
    """Return list of races for a given year.

    Returns:
        List of dicts with round number, name, and country.
    """
    min_year = settings.get("fastf1", {}).get("min_year", 2018)
    max_year = settings.get("fastf1", {}).get("max_year", 2025)

    if year < min_year or year > max_year:
        raise HTTPException(
            status_code=400,
            detail=f"Year must be between {min_year} and {max_year}",
        )

    try:
        schedule = fastf1.get_event_schedule(year)
        races = []
        for _, row in schedule.iterrows():
            round_num = int(row["RoundNumber"])
            if round_num == 0:
                continue  # Skip pre-season testing
            races.append({
                "round": round_num,
                "name": str(row.get("EventName", "")),
                "country": str(row.get("Country", "")),
                "location": str(row.get("Location", "")),
            })
        return races
    except Exception as e:
        logger.error("Failed to get schedule for {}: {}", year, e)
        raise HTTPException(status_code=500, detail=f"Could not load schedule: {e}")


@router.post("/load")
async def load_race(request: LoadRaceRequest) -> dict:
    """Load a race session from FastF1. Returns session metadata.

    This is slow on first load (~10-30s) because FastF1 downloads data.
    Subsequent loads of the same race are cached.
    """
    try:
        service = RaceService.get_instance()
        metadata = await service.load_race(request.year, request.round_number)
        return metadata
    except Exception as e:
        logger.error("Failed to load race: {}", e)
        raise HTTPException(status_code=500, detail=f"Could not load race data: {e}")


@router.get("/standings")
async def get_standings(lap: int = Query(..., ge=1, description="Lap number")) -> list[dict]:
    """Get race standings as of a specific lap."""
    service = RaceService.get_instance()
    if not service.is_loaded:
        raise HTTPException(status_code=400, detail="No race loaded.")
    return service.race_state.get_standings(lap)


@router.get("/position-history")
async def get_position_history(
    lap: int = Query(..., ge=1, description="Up to this lap"),
) -> dict:
    """Get position history for all drivers up to a specific lap (for charts)."""
    service = RaceService.get_instance()
    if not service.is_loaded:
        raise HTTPException(status_code=400, detail="No race loaded.")
    return service.race_state.get_position_history(lap)


@router.get("/track-status")
async def get_track_status(
    lap: int = Query(..., ge=1, description="As of this lap"),
) -> dict:
    """Get current track status and weather."""
    service = RaceService.get_instance()
    if not service.is_loaded:
        raise HTTPException(status_code=400, detail="No race loaded.")

    track = service.race_state.get_track_status(lap)
    weather = service.race_state.get_weather(lap)

    return {"status": track["current"], "history": track["history"], "weather": weather}


@router.get("/drivers")
async def get_drivers() -> list[dict]:
    """Get list of drivers with team info and colors."""
    service = RaceService.get_instance()
    if not service.is_loaded:
        raise HTTPException(status_code=400, detail="No race loaded.")

    return [
        {
            "code": code,
            "name": info["name"],
            "team": info["team"],
            "color": info["color"],
        }
        for code, info in service.race_state.drivers.items()
    ]
