"""Shared session state helpers for the Streamlit dashboard."""

from __future__ import annotations

import streamlit as st

from src.data_loader import F1DataLoader


def get_loader(year: int = 2025) -> F1DataLoader:
    """Return a cached F1DataLoader instance for the given year."""
    key = f"loader_{year}"
    if key not in st.session_state:
        st.session_state[key] = F1DataLoader(year=year)
    return st.session_state[key]


def get_session(year: int, round_number: int):
    """Return a cached FastF1 session, loading it if needed."""
    key = f"session_{year}_{round_number}"
    if key not in st.session_state:
        loader = get_loader(year)
        st.session_state[key] = loader.load_race(round_number)
    return st.session_state[key]


# Team colours aligned with 2025 liveries
TEAM_COLORS: dict[str, str] = {
    "McLaren": "#FF8000",
    "Red Bull Racing": "#3671C6",
    "Mercedes": "#27F4D2",
    "Ferrari": "#E8002D",
    "Aston Martin": "#229971",
    "Alpine": "#0093CC",
    "Williams": "#64C4FF",
    "Racing Bulls": "#6692FF",
    "Kick Sauber": "#52E252",
    "Haas F1 Team": "#B6BABD",
}


def team_color(team_name: str) -> str:
    """Return the hex colour for a team, with a grey fallback."""
    return TEAM_COLORS.get(team_name, "#888888")
