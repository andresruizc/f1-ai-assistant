"""Standings & Gaps page — position at any lap, gaps to leader, position chart."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.dashboard.state import team_color


def render(loader, session, year: int) -> None:
    event = session.event
    laps = session.laps.copy()
    results = session.results

    st.title(f"Standings & Gaps — {event['EventName']}")

    if laps.empty:
        st.warning("No lap data available.")
        return

    total_laps = int(laps["LapNumber"].max())

    # ── Lap selector ──
    selected_lap = st.slider("Select Lap", 1, total_laps, total_laps)

    # ── Standings at selected lap ──
    lap_data = laps[laps["LapNumber"] == selected_lap].copy()
    if "Time" in lap_data.columns and pd.api.types.is_timedelta64_dtype(lap_data["Time"]):
        lap_data["TimeSeconds"] = lap_data["Time"].dt.total_seconds()
    elif "Time" in lap_data.columns:
        lap_data["TimeSeconds"] = pd.to_numeric(lap_data["Time"], errors="coerce")

    lap_data = lap_data.sort_values("Position")

    if not lap_data.empty and "TimeSeconds" in lap_data.columns:
        leader_time = lap_data.iloc[0]["TimeSeconds"]
        lap_data["Gap"] = lap_data["TimeSeconds"] - leader_time
        lap_data["GapStr"] = lap_data["Gap"].apply(
            lambda x: "LEADER" if x == 0 else f"+{x:.3f}s"
        )
    else:
        lap_data["Gap"] = 0
        lap_data["GapStr"] = ""

    col1, col2 = st.columns([1, 2])

    with col1:
        st.subheader(f"Standings — Lap {selected_lap}")
        for _, row in lap_data.iterrows():
            pos = int(row["Position"]) if pd.notna(row["Position"]) else "?"
            driver = row["Driver"]
            team = str(row.get("Team", ""))
            gap = row.get("GapStr", "")
            color = team_color(team)
            st.markdown(
                f'<div style="border-left: 4px solid {color}; padding: 4px 8px; margin: 2px 0;">'
                f'<strong>P{pos}</strong> {driver} <span style="color: #888;">| {team}</span>'
                f'<br><span style="color: #aaa; font-size: 0.85em;">{gap}</span></div>',
                unsafe_allow_html=True,
            )

    with col2:
        # ── Gap to leader bar chart ──
        st.subheader("Gap to Leader")
        if "Gap" in lap_data.columns:
            fig = go.Figure()
            for _, row in lap_data.iterrows():
                if pd.notna(row.get("Position")):
                    color = team_color(str(row.get("Team", "")))
                    fig.add_trace(go.Bar(
                        y=[row["Driver"]],
                        x=[row["Gap"]],
                        orientation="h",
                        marker_color=color,
                        showlegend=False,
                        hovertemplate=f"{row['Driver']}: +{row['Gap']:.3f}s<extra></extra>",
                    ))
            fig.update_layout(
                xaxis_title="Gap to Leader (seconds)",
                height=max(400, len(lap_data) * 28),
                margin=dict(l=0, r=0, t=10, b=0),
                yaxis=dict(autorange="reversed"),
            )
            st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Position history chart ──
    st.subheader("Position History")

    drivers_in_results = results["Abbreviation"].tolist() if not results.empty else laps["Driver"].unique().tolist()
    selected_drivers = st.multiselect(
        "Drivers to show",
        drivers_in_results,
        default=drivers_in_results[:5],
    )

    if selected_drivers:
        fig = go.Figure()
        for driver in selected_drivers:
            d_laps = laps[laps["Driver"] == driver].sort_values("LapNumber")
            if d_laps.empty:
                continue
            team = str(d_laps.iloc[0].get("Team", ""))
            color = team_color(team)
            fig.add_trace(go.Scatter(
                x=d_laps["LapNumber"],
                y=d_laps["Position"],
                mode="lines+markers",
                name=driver,
                line=dict(color=color, width=2),
                marker=dict(size=3),
            ))
        fig.update_layout(
            xaxis_title="Lap",
            yaxis_title="Position",
            yaxis=dict(autorange="reversed", dtick=1),
            height=500,
            margin=dict(l=0, r=0, t=30, b=0),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            hovermode="x unified",
        )
        fig.add_vline(x=selected_lap, line_dash="dash", line_color="yellow", opacity=0.5)
        st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Gap evolution chart ──
    st.subheader("Gap to Leader Over Race")

    if selected_drivers:
        fig = go.Figure()
        for lap_num in range(1, total_laps + 1):
            lap_slice = laps[laps["LapNumber"] == lap_num].copy()
            if lap_slice.empty:
                continue

        for driver in selected_drivers:
            d_laps = laps[laps["Driver"] == driver].sort_values("LapNumber").copy()
            if d_laps.empty:
                continue

            if pd.api.types.is_timedelta64_dtype(d_laps["Time"]):
                d_laps["TimeSeconds"] = d_laps["Time"].dt.total_seconds()
            else:
                d_laps["TimeSeconds"] = pd.to_numeric(d_laps["Time"], errors="coerce")

            gaps = []
            for _, row in d_laps.iterrows():
                lap_num = int(row["LapNumber"])
                lap_all = laps[laps["LapNumber"] == lap_num]
                if lap_all.empty:
                    gaps.append(None)
                    continue
                if pd.api.types.is_timedelta64_dtype(lap_all["Time"]):
                    leader_t = lap_all["Time"].dt.total_seconds().min()
                else:
                    leader_t = pd.to_numeric(lap_all["Time"], errors="coerce").min()
                gaps.append(row["TimeSeconds"] - leader_t)

            team = str(d_laps.iloc[0].get("Team", ""))
            fig.add_trace(go.Scatter(
                x=d_laps["LapNumber"],
                y=gaps,
                mode="lines",
                name=driver,
                line=dict(color=team_color(team), width=2),
            ))

        fig.update_layout(
            xaxis_title="Lap",
            yaxis_title="Gap to Leader (seconds)",
            height=400,
            margin=dict(l=0, r=0, t=30, b=0),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
            hovermode="x unified",
        )
        st.plotly_chart(fig, width="stretch")
