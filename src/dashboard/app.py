"""F1 Race Dashboard — Streamlit entry point.

Run with:
    uv run streamlit run src/dashboard/app.py
    uv run f1-dashboard
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

# Ensure project root is on sys.path so `src.*` imports work
_project_root = str(Path(__file__).resolve().parents[2])
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from src.dashboard.state import get_loader  # noqa: E402


def main() -> None:
    """CLI entry point — launches Streamlit."""
    import subprocess

    app_path = str(Path(__file__).resolve())
    subprocess.run(
        ["streamlit", "run", app_path, "--server.headless", "true"],
        cwd=_project_root,
    )


# ── Page config ──────────────────────────────────────────────────────
st.set_page_config(
    page_title="F1 Race Dashboard",
    page_icon="🏎️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Sidebar: race selector ───────────────────────────────────────────
st.sidebar.title("F1 Race Dashboard")
year = st.sidebar.selectbox("Season", [2025, 2024, 2023], index=0)

loader = get_loader(year)
races = loader.get_race_rounds()
race_options = {f"R{r['round']:02d} — {r['country']}: {r['event_name']}": r["round"] for r in races}

selected_race = st.sidebar.selectbox("Race", list(race_options.keys()))
round_number = race_options[selected_race]

if st.sidebar.button("Load Race", type="primary", width="stretch"):
    with st.spinner(f"Loading Round {round_number}..."):
        from src.dashboard.state import get_session
        get_session(year, round_number)
    st.sidebar.success("Race loaded!")

session_key = f"session_{year}_{round_number}"
session_loaded = session_key in st.session_state

if not session_loaded:
    st.title("F1 Race Dashboard")
    st.info("Select a race from the sidebar and click **Load Race** to get started.")
    st.stop()

# ── Navigation ───────────────────────────────────────────────────────
session = st.session_state[session_key]

page = st.sidebar.radio(
    "View",
    ["Race Replay", "Overview", "Standings & Gaps", "Strategy", "Pace Analysis", "Telemetry", "Track Map"],
    index=0,
)

# ── Load pages ───────────────────────────────────────────────────────
if page == "Race Replay":
    from src.dashboard.pages.replay import render
    render(loader, session, year)
elif page == "Overview":
    from src.dashboard.pages.overview import render
    render(loader, session, year)
elif page == "Standings & Gaps":
    from src.dashboard.pages.standings import render
    render(loader, session, year)
elif page == "Strategy":
    from src.dashboard.pages.strategy import render
    render(loader, session, year)
elif page == "Pace Analysis":
    from src.dashboard.pages.pace import render
    render(loader, session, year)
elif page == "Telemetry":
    from src.dashboard.pages.telemetry import render
    render(loader, session, year)
elif page == "Track Map":
    from src.dashboard.pages.track_map import render
    render(loader, session, year)
