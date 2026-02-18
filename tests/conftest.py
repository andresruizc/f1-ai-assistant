"""Pytest configuration and shared fixtures."""

import pytest
import pandas as pd
from unittest.mock import Mock


@pytest.fixture
def sample_laps_df():
    """Create a minimal laps DataFrame for testing."""
    return pd.DataFrame({
        "Driver": ["VER", "VER", "VER", "NOR", "NOR", "NOR"],
        "DriverNumber": ["1", "1", "1", "4", "4", "4"],
        "LapNumber": [1, 2, 3, 1, 2, 3],
        "LapTime": [
            pd.Timedelta(seconds=95),
            pd.Timedelta(seconds=88),
            pd.Timedelta(seconds=87.5),
            pd.Timedelta(seconds=96),
            pd.Timedelta(seconds=89),
            pd.Timedelta(seconds=88.2),
        ],
        "Sector1Time": [pd.NaT] * 6,
        "Sector2Time": [pd.NaT] * 6,
        "Sector3Time": [pd.NaT] * 6,
        "Compound": ["MEDIUM", "MEDIUM", "MEDIUM", "SOFT", "SOFT", "SOFT"],
        "TyreLife": [1, 2, 3, 1, 2, 3],
        "Position": [1.0, 1.0, 1.0, 2.0, 2.0, 2.0],
        "Stint": [1, 1, 1, 1, 1, 1],
        "PitInTime": [pd.NaT] * 6,
        "PitOutTime": [pd.NaT] * 6,
        "FreshTyre": [True] * 6,
        "IsPersonalBest": [False, True, True, False, True, True],
        "Time": [
            pd.Timedelta(seconds=95),
            pd.Timedelta(seconds=183),
            pd.Timedelta(seconds=270.5),
            pd.Timedelta(seconds=96),
            pd.Timedelta(seconds=185),
            pd.Timedelta(seconds=273.2),
        ],
        "TrackStatus": ["1"] * 6,
    })


@pytest.fixture
def mock_race_state(sample_laps_df):
    """Mock RaceState for testing tools and agent."""
    state = Mock()
    state.total_laps = 52
    state.event_name = "British Grand Prix"
    state.circuit_name = "Silverstone"
    state.country = "United Kingdom"
    state.year = 2024
    state.drivers = {
        "VER": {"name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3671C6", "grid_position": 1},
        "NOR": {"name": "Lando Norris", "team": "McLaren", "color": "#FF8000", "grid_position": 4},
    }
    state.laps = sample_laps_df
    return state
