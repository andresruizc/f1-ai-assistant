"""Race Replay — Plotly native animation (runs entirely in the browser).

All frames are pre-built in Python and sent to the browser once.
Play/pause, speed selection, and scrubbing all happen client-side
with zero server round-trips, giving smooth real-time playback.
"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go
import streamlit as st

from src.dashboard.replay_engine import (
    build_replay_data,
    get_current_track_status,
    get_standings_at_time,
)

STATUS_COLOURS = {
    "1": "#00FF00", "2": "#FFFF00", "4": "#FF8C00",
    "5": "#FF0000", "6": "#9966FF", "7": "#9966FF",
}


def _build_animated_figure(meta: dict) -> go.Figure:
    """Build a single Plotly figure with animation frames for the full race."""

    total_frames = meta["total_frames"]
    time_grid = meta["time_grid"]
    race_start = meta["race_start"]
    total_laps = meta["total_laps"]
    drivers_list = list(meta["driver_map"].values())

    fig = go.Figure()

    # ── Trace 0: track outline (static) ──
    fig.add_trace(go.Scatter(
        x=meta["track_outline_x"],
        y=meta["track_outline_y"],
        mode="lines",
        line=dict(color="rgba(255,255,255,0.07)", width=16),
        showlegend=False,
        hoverinfo="skip",
    ))

    # ── Trace 1: corner markers (static, optional) ──
    cd = meta.get("corner_data")
    has_corners = cd is not None
    if has_corners:
        fig.add_trace(go.Scatter(
            x=cd["x"], y=cd["y"],
            mode="markers+text",
            marker=dict(size=5, color="rgba(255,255,255,0.2)"),
            text=[f"T{int(n)}" for n in cd["numbers"]],
            textposition="bottom center",
            textfont=dict(size=8, color="rgba(255,255,255,0.3)"),
            showlegend=False,
            hoverinfo="skip",
        ))

    driver_trace_idx = 2 if has_corners else 1

    # ── Trace 2 (or 1): driver dots — initial positions ──
    f0 = meta["frames"].get(0, [])
    fig.add_trace(go.Scatter(
        x=[d["x"] for d in f0],
        y=[d["y"] for d in f0],
        mode="markers+text",
        marker=dict(
            size=14,
            color=[d["color"] for d in f0],
            line=dict(color="white", width=1.5),
        ),
        text=[d["driver"] for d in f0],
        textposition="top center",
        textfont=dict(size=10, color="white", family="monospace"),
        showlegend=False,
        hovertext=[f"{d['driver']}: {d['speed']:.0f} km/h" for d in f0],
        hoverinfo="text",
    ))

    # ── Build animation frames ──
    frames = []
    slider_steps = []

    for i in range(total_frames):
        drv = meta["frames"].get(i, [])
        if not drv:
            continue

        current_time = time_grid[i]
        elapsed = current_time - race_start
        e_min, e_sec = int(elapsed // 60), int(elapsed % 60)

        sc, sn = get_current_track_status(current_time, meta["track_status_lookup"])
        s_color = STATUS_COLOURS.get(sc, "#888")

        standings = get_standings_at_time(
            current_time, drivers_list,
            meta["position_lookup"], meta["lap_lookup"], meta["team_map"],
        )
        leader_lap = standings[0]["lap"] if standings else 1

        info_text = (
            f"Lap {leader_lap}/{total_laps}     "
            f"{e_min:02d}:{e_sec:02d}     "
            f"{sn}"
        )

        standing_lines = []
        for s in standings[:20]:
            if s["position"] is None:
                continue
            standing_lines.append(f"P{s['position']:>2}  {s['driver']}  L{s['lap']}")
        standings_text = "<br>".join(standing_lines)

        frames.append(go.Frame(
            data=[go.Scatter(
                x=[d["x"] for d in drv],
                y=[d["y"] for d in drv],
                mode="markers+text",
                marker=dict(
                    size=14,
                    color=[d["color"] for d in drv],
                    line=dict(color="white", width=1.5),
                ),
                text=[d["driver"] for d in drv],
                textposition="top center",
                textfont=dict(size=10, color="white", family="monospace"),
                showlegend=False,
                hovertext=[f"{d['driver']}: {d['speed']:.0f} km/h" for d in drv],
                hoverinfo="text",
            )],
            traces=[driver_trace_idx],
            name=str(i),
            layout=go.Layout(
                annotations=[
                    dict(
                        text=f"<b>{info_text}</b>",
                        x=0.35, y=1.04,
                        xref="paper", yref="paper",
                        showarrow=False,
                        font=dict(size=15, color="white"),
                        xanchor="center",
                    ),
                    dict(
                        text=standings_text,
                        x=1.01, y=0.99,
                        xref="paper", yref="paper",
                        showarrow=False,
                        font=dict(size=10, color="#ccc", family="Courier New"),
                        xanchor="left", yanchor="top",
                        align="left",
                    ),
                ],
            ),
        ))

        label = f"L{leader_lap}" if i % 30 == 0 else ""
        slider_steps.append(dict(
            args=[[str(i)], dict(
                frame=dict(duration=0, redraw=True),
                mode="immediate",
                transition=dict(duration=0),
            )],
            label=label,
            method="animate",
        ))

    fig.frames = frames

    # ── Layout ──
    fig.update_layout(
        height=750,
        margin=dict(l=10, r=170, t=60, b=110),
        xaxis=dict(scaleanchor="y", visible=False, range=meta["x_range"]),
        yaxis=dict(visible=False, range=meta["y_range"]),
        plot_bgcolor="rgba(15,15,25,1)",
        paper_bgcolor="rgba(15,15,25,1)",
        font=dict(color="white"),
        annotations=[
            dict(
                text="<b>Press Play to start the race</b>",
                x=0.35, y=1.04, xref="paper", yref="paper",
                showarrow=False, font=dict(size=15, color="#aaa"),
                xanchor="center",
            ),
            dict(
                text="",
                x=1.01, y=0.99, xref="paper", yref="paper",
                showarrow=False, font=dict(size=10, color="#ccc"),
                xanchor="left", yanchor="top",
            ),
        ],
        updatemenus=[dict(
            type="buttons",
            showactive=False,
            x=0.5, xanchor="center",
            y=-0.03, yanchor="top",
            direction="left",
            pad=dict(r=10, t=10),
            font=dict(color="#ddd", size=12),
            bgcolor="rgba(50,50,60,0.8)",
            buttons=[
                dict(
                    label="\u25B6 Slow",
                    method="animate",
                    args=[None, dict(
                        frame=dict(duration=120, redraw=True),
                        fromcurrent=True,
                        transition=dict(duration=0),
                    )],
                ),
                dict(
                    label="\u25B6 Normal",
                    method="animate",
                    args=[None, dict(
                        frame=dict(duration=50, redraw=True),
                        fromcurrent=True,
                        transition=dict(duration=0),
                    )],
                ),
                dict(
                    label="\u25B6\u25B6 Fast",
                    method="animate",
                    args=[None, dict(
                        frame=dict(duration=20, redraw=True),
                        fromcurrent=True,
                        transition=dict(duration=0),
                    )],
                ),
                dict(
                    label="\u23F8 Pause",
                    method="animate",
                    args=[[None], dict(
                        frame=dict(duration=0, redraw=False),
                        mode="immediate",
                        transition=dict(duration=0),
                    )],
                ),
            ],
        )],
        sliders=[dict(
            active=0,
            yanchor="top", xanchor="left",
            x=0.05, y=-0.06, len=0.9,
            currentvalue=dict(
                prefix="", visible=True, xanchor="center",
                font=dict(size=11, color="#aaa"),
            ),
            transition=dict(duration=0),
            pad=dict(b=10, t=50),
            steps=slider_steps,
            bgcolor="rgba(50,50,60,0.3)",
            activebgcolor="#FF8000",
            font=dict(color="rgba(200,200,200,0.7)", size=9),
            tickcolor="rgba(200,200,200,0.3)",
        )],
    )

    return fig


def render(loader, session, year: int) -> None:
    event = session.event

    st.markdown(
        f'<h2 style="text-align:center;">Race Replay &mdash; {event["EventName"]}</h2>',
        unsafe_allow_html=True,
    )

    # ── Build / cache replay data (4-second intervals ≈ 1500 frames) ──
    replay_key = f"replay_v3_{year}_{event['RoundNumber']}"
    if replay_key not in st.session_state:
        with st.spinner("Building replay data — interpolating all drivers..."):
            meta = build_replay_data(session, sample_interval=4.0)
            st.session_state[replay_key] = meta

    meta = st.session_state[replay_key]

    # ── Build / cache Plotly figure with all animation frames ──
    fig_key = f"replay_fig_{replay_key}"
    if fig_key not in st.session_state:
        with st.spinner("Building animation frames — this takes a few seconds..."):
            fig = _build_animated_figure(meta)
            st.session_state[fig_key] = fig

    fig = st.session_state[fig_key]

    st.plotly_chart(fig, width="stretch")

    st.caption(
        "Use **Slow / Normal / Fast** to play and **Pause** to stop. "
        "Drag the slider below the map to jump to any point. "
        "Hover over drivers to see their speed."
    )
