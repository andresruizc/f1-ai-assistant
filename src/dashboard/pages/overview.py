"""Overview page — race summary, podium, DNFs, weather, track events."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.dashboard.state import team_color


def render(loader, session, year: int) -> None:
    event = session.event
    summary = loader.get_race_summary(session)
    weather = loader.get_weather_summary(session)

    st.title(f"{summary['event_name']} {year}")
    st.caption(f"{summary['circuit']} — {summary['country']} | {summary['date']}")

    # ── Key metrics ──
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Laps", summary["total_laps"])
    c2.metric("Drivers", summary["num_drivers"])
    c3.metric("Winner", summary["winner"])
    if summary["fastest_lap"]:
        fl = summary["fastest_lap"]
        c4.metric("Fastest Lap", fl["time_str"], delta=f"{fl['driver']} — lap {fl['lap']}")

    st.divider()

    # ── Podium + DNFs ──
    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("Podium")
        for p in summary["podium"]:
            st.markdown(f"**P{p['position']}** — {p['name']} ({p['driver']}) | {p['team']}")

    with col_right:
        st.subheader(f"Retirements ({len(summary['dnfs'])})")
        if summary["dnfs"]:
            for d in summary["dnfs"]:
                st.markdown(f"**{d['driver']}** — {d['status']}")
        else:
            st.write("No retirements")

    st.divider()

    # ── Results table ──
    st.subheader("Full Results")
    results = session.results.copy()
    if not results.empty:
        display_cols = ["Position", "Abbreviation", "FullName", "TeamName", "GridPosition", "Status", "Points"]
        available = [c for c in display_cols if c in results.columns]
        st.dataframe(
            results[available].sort_values("Position"),
            width="stretch",
            hide_index=True,
        )

    st.divider()

    # ── Weather ──
    col_w1, col_w2 = st.columns(2)

    with col_w1:
        st.subheader("Weather")
        if weather["available"]:
            wc1, wc2, wc3 = st.columns(3)
            wc1.metric("Air Temp", f"{weather['air_temp_min']}–{weather['air_temp_max']}°C")
            wc2.metric("Track Temp", f"{weather['track_temp_min']}–{weather['track_temp_max']}°C")
            wc3.metric("Humidity", f"{weather['humidity_avg']}%")
            if weather["rainfall"]:
                st.warning("Rain detected during the race")
        else:
            st.write("No weather data available")

    with col_w2:
        st.subheader("Weather Timeline")
        wd = session.weather_data
        if wd is not None and not wd.empty:
            wd_plot = wd.copy()
            if pd.api.types.is_timedelta64_dtype(wd_plot["Time"]):
                wd_plot["Time"] = wd_plot["Time"].dt.total_seconds() / 60

            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=wd_plot["Time"], y=wd_plot["AirTemp"],
                name="Air Temp", line=dict(color="#FF6B6B"),
            ))
            fig.add_trace(go.Scatter(
                x=wd_plot["Time"], y=wd_plot["TrackTemp"],
                name="Track Temp", line=dict(color="#FFA500"),
            ))
            fig.update_layout(
                xaxis_title="Session Time (min)",
                yaxis_title="Temperature (°C)",
                height=300,
                margin=dict(l=0, r=0, t=30, b=0),
                legend=dict(orientation="h", yanchor="bottom", y=1.02),
            )
            st.plotly_chart(fig, width="stretch")

    # ── Track status events ──
    st.subheader("Track Status Events")
    events = loader.get_track_status_events(session)
    if events:
        status_colors = {
            "Green": "🟢", "Yellow": "🟡", "Safety Car": "🟠",
            "Red Flag": "🔴", "VSC": "🟣", "VSC Ending": "🟣",
        }
        for ev in events:
            icon = status_colors.get(ev["status"], "⚪")
            st.markdown(f"{icon} **{ev['status']}** — {ev['message']}")
    else:
        st.write("No track status changes recorded")

    # ── Grid vs Finish ──
    st.subheader("Grid vs Finish Position")
    results_df = session.results.copy()
    if not results_df.empty and "GridPosition" in results_df.columns:
        results_df = results_df.sort_values("Position")
        results_df["Positions Gained"] = results_df["GridPosition"] - results_df["Position"]

        fig = go.Figure()
        for _, row in results_df.iterrows():
            gained = row["Positions Gained"]
            color = team_color(str(row.get("TeamName", "")))
            fig.add_trace(go.Bar(
                x=[row["Abbreviation"]],
                y=[gained],
                marker_color=color,
                name=row["Abbreviation"],
                showlegend=False,
                hovertemplate=f"{row['Abbreviation']}<br>Grid: P{int(row['GridPosition'])}<br>Finish: P{int(row['Position'])}<br>Gained: {int(gained)}<extra></extra>",
            ))
        fig.update_layout(
            yaxis_title="Positions Gained (+) / Lost (−)",
            height=350,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        fig.add_hline(y=0, line_dash="dash", line_color="gray")
        st.plotly_chart(fig, width="stretch")
