"""Strategy page — stint timelines, pit stops, compound usage."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.dashboard.state import team_color

COMPOUND_COLORS = {
    "SOFT": "#FF3333",
    "MEDIUM": "#FFD700",
    "HARD": "#EEEEEE",
    "INTERMEDIATE": "#39B54A",
    "WET": "#3366FF",
}


def render(loader, session, year: int) -> None:
    event = session.event
    laps = session.laps.copy()
    results = session.results

    st.title(f"Strategy — {event['EventName']}")

    if laps.empty:
        st.warning("No lap data available.")
        return

    # ── Stint timeline chart ──
    st.subheader("Tyre Strategy Timeline")

    drivers_sorted = (
        results.sort_values("Position")["Abbreviation"].tolist()
        if not results.empty
        else sorted(laps["Driver"].unique())
    )

    fig = go.Figure()

    for i, driver in enumerate(drivers_sorted):
        d_laps = laps[laps["Driver"] == driver].sort_values("LapNumber")
        if d_laps.empty:
            continue

        for stint_num, stint_group in d_laps.groupby("Stint"):
            compound = str(stint_group["Compound"].iloc[0]) if pd.notna(stint_group["Compound"].iloc[0]) else "UNKNOWN"
            start = int(stint_group["LapNumber"].min())
            end = int(stint_group["LapNumber"].max())
            color = COMPOUND_COLORS.get(compound, "#888888")

            fig.add_trace(go.Bar(
                y=[driver],
                x=[end - start + 1],
                base=[start - 1],
                orientation="h",
                marker_color=color,
                marker_line=dict(color="rgba(0,0,0,0.3)", width=1),
                showlegend=False,
                hovertemplate=(
                    f"{driver} — Stint {int(stint_num)}<br>"
                    f"{compound}<br>"
                    f"Laps {start}–{end} ({end - start + 1} laps)"
                    f"<extra></extra>"
                ),
            ))

    for compound, color in COMPOUND_COLORS.items():
        fig.add_trace(go.Bar(
            y=[None], x=[None],
            marker_color=color, name=compound,
            showlegend=True,
        ))

    fig.update_layout(
        xaxis_title="Lap",
        barmode="stack",
        height=max(400, len(drivers_sorted) * 28),
        margin=dict(l=0, r=0, t=30, b=0),
        yaxis=dict(autorange="reversed"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
    )
    st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Driver detail ──
    st.subheader("Driver Strategy Detail")
    selected_driver = st.selectbox("Driver", drivers_sorted)

    if selected_driver:
        col1, col2 = st.columns(2)

        with col1:
            st.markdown("**Stint Breakdown**")
            stints = loader.get_stint_summary(session, selected_driver)
            if stints:
                for s in stints:
                    compound = s["compound"]
                    color = COMPOUND_COLORS.get(compound, "#888")
                    st.markdown(
                        f'<div style="border-left: 4px solid {color}; padding: 4px 8px; margin: 4px 0;">'
                        f'<strong>Stint {s["stint"]}</strong> — {compound}<br>'
                        f'Laps {s["start_lap"]}–{s["end_lap"]} ({s["num_laps"]} laps)<br>'
                        f'Avg: {s["avg_pace_str"]} | Best: {s["best_lap_str"]}'
                        f'</div>',
                        unsafe_allow_html=True,
                    )
            else:
                st.write("No stint data")

        with col2:
            st.markdown("**Pit Stops**")
            stops = loader.get_pit_stops(session, selected_driver)
            if stops:
                for i, stop in enumerate(stops, 1):
                    st.markdown(
                        f"**Stop {i}** — Lap {stop['lap']}: "
                        f"{stop['from_compound']} → {stop['to_compound']}"
                    )
            else:
                st.write("No pit stops")

    st.divider()

    # ── Compound usage across the field ──
    st.subheader("Compound Usage Across Field")

    compound_counts = laps.groupby("Compound").size().reset_index(name="Laps")
    if not compound_counts.empty:
        fig = go.Figure(go.Pie(
            labels=compound_counts["Compound"],
            values=compound_counts["Laps"],
            marker_colors=[COMPOUND_COLORS.get(c, "#888") for c in compound_counts["Compound"]],
            textinfo="label+percent",
            hole=0.4,
        ))
        fig.update_layout(
            height=350,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")

    # ── Tyre life distribution ──
    st.subheader("Maximum Tyre Life by Driver")
    max_life = laps.groupby(["Driver", "Stint", "Compound"])["TyreLife"].max().reset_index()
    if not max_life.empty:
        fig = go.Figure()
        for compound in max_life["Compound"].unique():
            subset = max_life[max_life["Compound"] == compound]
            color = COMPOUND_COLORS.get(str(compound), "#888")
            fig.add_trace(go.Box(
                y=subset["TyreLife"],
                name=str(compound),
                marker_color=color,
            ))
        fig.update_layout(
            yaxis_title="Tyre Life (laps)",
            height=350,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")
