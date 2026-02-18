"""Telemetry page — speed traces, throttle/brake, gear map, driver comparison."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

from src.dashboard.state import team_color


def render(loader, session, year: int) -> None:
    event = session.event
    laps = session.laps
    results = session.results

    st.title(f"Telemetry — {event['EventName']}")

    if laps.empty:
        st.warning("No lap data available.")
        return

    drivers_sorted = (
        results.sort_values("Position")["Abbreviation"].tolist()
        if not results.empty
        else sorted(laps["Driver"].unique())
    )

    total_laps = int(laps["LapNumber"].max())

    # ── Controls ──
    col1, col2, col3 = st.columns(3)
    with col1:
        driver_a = st.selectbox("Driver A", drivers_sorted, index=0)
    with col2:
        driver_b = st.selectbox("Driver B (comparison)", ["None"] + drivers_sorted, index=0)
    with col3:
        lap_num = st.number_input("Lap", min_value=1, max_value=total_laps, value=total_laps // 2)

    if driver_b == "None":
        driver_b = None

    # ── Load telemetry ──
    with st.spinner(f"Loading telemetry for {driver_a} lap {lap_num}..."):
        tel_a = loader.get_lap_telemetry(session, driver_a, lap_num)

    tel_b = pd.DataFrame()
    if driver_b:
        with st.spinner(f"Loading telemetry for {driver_b} lap {lap_num}..."):
            tel_b = loader.get_lap_telemetry(session, driver_b, lap_num)

    if tel_a.empty:
        st.warning(f"No telemetry available for {driver_a} on lap {lap_num}.")
        return

    team_a = str(laps[laps["Driver"] == driver_a].iloc[0].get("Team", "")) if not laps[laps["Driver"] == driver_a].empty else ""
    color_a = team_color(team_a)

    team_b = ""
    color_b = "#888888"
    if driver_b and not tel_b.empty:
        team_b = str(laps[laps["Driver"] == driver_b].iloc[0].get("Team", "")) if not laps[laps["Driver"] == driver_b].empty else ""
        color_b = team_color(team_b)

    # ── Full telemetry panel: Speed + Throttle + Brake + Gear ──
    st.subheader("Full Telemetry Trace")

    fig = make_subplots(
        rows=4, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=[0.4, 0.2, 0.2, 0.2],
        subplot_titles=["Speed (km/h)", "Throttle (%)", "Brake", "Gear"],
    )

    # Speed
    fig.add_trace(go.Scatter(
        x=tel_a["Distance"], y=tel_a["Speed"],
        name=driver_a, line=dict(color=color_a, width=2),
        showlegend=True,
    ), row=1, col=1)

    if driver_b and not tel_b.empty:
        fig.add_trace(go.Scatter(
            x=tel_b["Distance"], y=tel_b["Speed"],
            name=driver_b, line=dict(color=color_b, width=2),
            showlegend=True,
        ), row=1, col=1)

    # Throttle
    fig.add_trace(go.Scatter(
        x=tel_a["Distance"], y=tel_a["Throttle"],
        name=driver_a, line=dict(color=color_a, width=1.5),
        showlegend=False,
    ), row=2, col=1)

    if driver_b and not tel_b.empty:
        fig.add_trace(go.Scatter(
            x=tel_b["Distance"], y=tel_b["Throttle"],
            name=driver_b, line=dict(color=color_b, width=1.5),
            showlegend=False,
        ), row=2, col=1)

    # Brake
    brake_a = tel_a["Brake"].astype(int) if tel_a["Brake"].dtype == bool else tel_a["Brake"]
    fig.add_trace(go.Scatter(
        x=tel_a["Distance"], y=brake_a,
        name=driver_a, line=dict(color=color_a, width=1.5),
        fill="tozeroy", fillcolor=f"rgba({int(color_a[1:3], 16)},{int(color_a[3:5], 16)},{int(color_a[5:7], 16)},0.2)",
        showlegend=False,
    ), row=3, col=1)

    if driver_b and not tel_b.empty:
        brake_b = tel_b["Brake"].astype(int) if tel_b["Brake"].dtype == bool else tel_b["Brake"]
        fig.add_trace(go.Scatter(
            x=tel_b["Distance"], y=brake_b,
            name=driver_b, line=dict(color=color_b, width=1.5),
            fill="tozeroy", fillcolor=f"rgba({int(color_b[1:3], 16)},{int(color_b[3:5], 16)},{int(color_b[5:7], 16)},0.2)",
            showlegend=False,
        ), row=3, col=1)

    # Gear
    fig.add_trace(go.Scatter(
        x=tel_a["Distance"], y=tel_a["nGear"],
        name=driver_a, line=dict(color=color_a, width=1.5),
        showlegend=False,
    ), row=4, col=1)

    if driver_b and not tel_b.empty:
        fig.add_trace(go.Scatter(
            x=tel_b["Distance"], y=tel_b["nGear"],
            name=driver_b, line=dict(color=color_b, width=1.5),
            showlegend=False,
        ), row=4, col=1)

    fig.update_xaxes(title_text="Distance (m)", row=4, col=1)
    fig.update_layout(
        height=800,
        margin=dict(l=0, r=0, t=40, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        hovermode="x unified",
    )
    st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Speed delta ──
    if driver_b and not tel_b.empty:
        st.subheader(f"Speed Delta: {driver_a} vs {driver_b}")

        merged = pd.merge_asof(
            tel_a[["Distance", "Speed"]].rename(columns={"Speed": "Speed_A"}).sort_values("Distance"),
            tel_b[["Distance", "Speed"]].rename(columns={"Speed": "Speed_B"}).sort_values("Distance"),
            on="Distance",
            direction="nearest",
        )
        merged["Delta"] = merged["Speed_A"] - merged["Speed_B"]

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=merged["Distance"],
            y=merged["Delta"],
            mode="lines",
            line=dict(width=2),
            fill="tozeroy",
            name=f"{driver_a} − {driver_b}",
        ))
        fig.add_hline(y=0, line_dash="dash", line_color="gray")
        fig.update_layout(
            xaxis_title="Distance (m)",
            yaxis_title=f"Speed Delta (km/h) — positive = {driver_a} faster",
            height=300,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── DRS usage ──
    st.subheader("DRS Status")
    drs_col = tel_a["DRS"]
    if drs_col is not None and not drs_col.empty:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=tel_a["Distance"],
            y=tel_a["DRS"],
            mode="lines",
            name=f"{driver_a} DRS",
            line=dict(color=color_a, width=2),
            fill="tozeroy",
        ))
        if driver_b and not tel_b.empty:
            fig.add_trace(go.Scatter(
                x=tel_b["Distance"],
                y=tel_b["DRS"],
                mode="lines",
                name=f"{driver_b} DRS",
                line=dict(color=color_b, width=2),
            ))
        fig.update_layout(
            xaxis_title="Distance (m)",
            yaxis_title="DRS Status",
            height=200,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")

    # ── Gap tracking ──
    if "DistanceToDriverAhead" in tel_a.columns:
        st.subheader(f"{driver_a} — Gap to Car Ahead")
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=tel_a["Distance"],
            y=tel_a["DistanceToDriverAhead"],
            mode="lines",
            line=dict(color=color_a, width=2),
            name="Distance to car ahead (m)",
        ))
        fig.update_layout(
            xaxis_title="Distance (m)",
            yaxis_title="Gap to Car Ahead (meters)",
            height=250,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")

        if "DriverAhead" in tel_a.columns:
            ahead_changes = tel_a[tel_a["DriverAhead"].shift() != tel_a["DriverAhead"]]
            if not ahead_changes.empty:
                st.caption("Car ahead changes during this lap:")
                for _, row in ahead_changes.iterrows():
                    dist = row["Distance"]
                    ahead = row["DriverAhead"]
                    if pd.notna(ahead) and str(ahead).strip():
                        st.markdown(f"At **{dist:.0f}m**: car ahead = **{ahead}**")
