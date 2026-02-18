"""Track Map page — GPS positions on circuit, racing line, corner labels."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.dashboard.state import team_color


def render(loader, session, year: int) -> None:
    event = session.event
    laps = session.laps
    results = session.results

    st.title(f"Track Map — {event['EventName']}")

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
    col1, col2 = st.columns(2)
    with col1:
        map_drivers = st.multiselect("Drivers", drivers_sorted, default=drivers_sorted[:3])
    with col2:
        map_lap = st.number_input("Lap", min_value=1, max_value=total_laps, value=total_laps // 2, key="map_lap")

    # ── Circuit info ──
    try:
        ci = session.get_circuit_info()
        corners = ci.corners
        rotation = ci.rotation
    except Exception:
        corners = None
        rotation = 0

    if not map_drivers:
        st.info("Select at least one driver.")
        return

    # ── Load telemetry and plot ──
    fig = go.Figure()

    for driver in map_drivers:
        tel = loader.get_lap_telemetry(session, driver, map_lap)
        if tel.empty:
            continue

        team = str(laps[laps["Driver"] == driver].iloc[0].get("Team", "")) if not laps[laps["Driver"] == driver].empty else ""
        color = team_color(team)

        fig.add_trace(go.Scatter(
            x=tel["X"],
            y=tel["Y"],
            mode="lines",
            name=driver,
            line=dict(color=color, width=3),
            hovertemplate=f"{driver}<br>Speed: %{{customdata[0]:.0f}} km/h<br>Gear: %{{customdata[1]}}<br>Dist: %{{customdata[2]:.0f}}m<extra></extra>",
            customdata=tel[["Speed", "nGear", "Distance"]].values,
        ))

    # ── Corner labels ──
    if corners is not None and not corners.empty:
        fig.add_trace(go.Scatter(
            x=corners["X"],
            y=corners["Y"],
            mode="markers+text",
            marker=dict(size=8, color="white", line=dict(color="black", width=1)),
            text=[f"T{int(n)}" for n in corners["Number"]],
            textposition="top center",
            textfont=dict(size=10, color="white"),
            name="Corners",
            showlegend=False,
        ))

    fig.update_layout(
        height=700,
        margin=dict(l=0, r=0, t=30, b=0),
        xaxis=dict(scaleanchor="y", visible=False),
        yaxis=dict(visible=False),
        plot_bgcolor="rgba(20,20,30,1)",
        paper_bgcolor="rgba(20,20,30,1)",
        legend=dict(
            orientation="h", yanchor="bottom", y=1.02,
            font=dict(color="white"),
        ),
        font=dict(color="white"),
    )
    st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Speed heatmap on track ──
    st.subheader("Speed Heatmap")
    heat_driver = st.selectbox("Driver for heatmap", map_drivers if map_drivers else drivers_sorted[:1], key="heat_drv")

    if heat_driver:
        tel = loader.get_lap_telemetry(session, heat_driver, map_lap)
        if not tel.empty:
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=tel["X"],
                y=tel["Y"],
                mode="markers",
                marker=dict(
                    size=4,
                    color=tel["Speed"],
                    colorscale="Turbo",
                    colorbar=dict(title="Speed (km/h)"),
                    cmin=tel["Speed"].quantile(0.05),
                    cmax=tel["Speed"].quantile(0.95),
                ),
                hovertemplate=f"{heat_driver}<br>Speed: %{{marker.color:.0f}} km/h<extra></extra>",
                showlegend=False,
            ))

            if corners is not None and not corners.empty:
                fig.add_trace(go.Scatter(
                    x=corners["X"],
                    y=corners["Y"],
                    mode="markers+text",
                    marker=dict(size=8, color="white", line=dict(color="black", width=1)),
                    text=[f"T{int(n)}" for n in corners["Number"]],
                    textposition="top center",
                    textfont=dict(size=10, color="white"),
                    showlegend=False,
                ))

            fig.update_layout(
                height=700,
                margin=dict(l=0, r=0, t=30, b=0),
                xaxis=dict(scaleanchor="y", visible=False),
                yaxis=dict(visible=False),
                plot_bgcolor="rgba(20,20,30,1)",
                paper_bgcolor="rgba(20,20,30,1)",
                font=dict(color="white"),
            )
            st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Throttle/Brake heatmap ──
    st.subheader("Throttle & Brake Zones")
    if heat_driver:
        tel = loader.get_lap_telemetry(session, heat_driver, map_lap)
        if not tel.empty:
            brake_vals = tel["Brake"].astype(int) if tel["Brake"].dtype == bool else tel["Brake"]
            zone = pd.Series("Coast", index=tel.index)
            zone[tel["Throttle"] > 80] = "Full Throttle"
            zone[brake_vals > 0] = "Braking"

            color_map = {"Full Throttle": "#00FF00", "Braking": "#FF0000", "Coast": "#FFFF00"}

            fig = go.Figure()
            for zone_name, color in color_map.items():
                mask = zone == zone_name
                fig.add_trace(go.Scatter(
                    x=tel.loc[mask, "X"],
                    y=tel.loc[mask, "Y"],
                    mode="markers",
                    marker=dict(size=4, color=color),
                    name=zone_name,
                ))

            if corners is not None and not corners.empty:
                fig.add_trace(go.Scatter(
                    x=corners["X"], y=corners["Y"],
                    mode="text",
                    text=[f"T{int(n)}" for n in corners["Number"]],
                    textfont=dict(size=10, color="white"),
                    showlegend=False,
                ))

            fig.update_layout(
                height=700,
                margin=dict(l=0, r=0, t=30, b=0),
                xaxis=dict(scaleanchor="y", visible=False),
                yaxis=dict(visible=False),
                plot_bgcolor="rgba(20,20,30,1)",
                paper_bgcolor="rgba(20,20,30,1)",
                legend=dict(
                    orientation="h", yanchor="bottom", y=1.02,
                    font=dict(color="white"),
                ),
                font=dict(color="white"),
            )
            st.plotly_chart(fig, width="stretch")
