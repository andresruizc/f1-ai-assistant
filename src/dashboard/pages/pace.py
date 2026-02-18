"""Pace Analysis page — lap times, filters, degradation curves."""

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


def _to_seconds(series: pd.Series) -> pd.Series:
    """Convert a LapTime series to float seconds regardless of dtype."""
    if pd.api.types.is_timedelta64_dtype(series):
        return series.dt.total_seconds()
    return pd.to_numeric(series, errors="coerce")


def render(loader, session, year: int) -> None:
    event = session.event
    laps = session.laps.copy()
    results = session.results

    st.title(f"Pace Analysis — {event['EventName']}")

    if laps.empty:
        st.warning("No lap data available.")
        return

    laps["LapTimeSeconds"] = _to_seconds(laps["LapTime"])

    drivers_sorted = (
        results.sort_values("Position")["Abbreviation"].tolist()
        if not results.empty
        else sorted(laps["Driver"].unique())
    )

    # ── Filter selector ──
    st.subheader("Lap Filter")
    col_f1, col_f2, col_f3 = st.columns(3)

    with col_f1:
        filter_type = st.selectbox(
            "Filter",
            ["None", "Quick laps", "Clean (no pit)", "Accurate", "Green flag", "By compound"],
        )
    with col_f2:
        compound_choice = None
        if filter_type == "By compound":
            compounds = [str(c) for c in laps["Compound"].dropna().unique()]
            compound_choice = st.selectbox("Compound", compounds)
    with col_f3:
        driver_filter = st.multiselect("Drivers", drivers_sorted, default=drivers_sorted[:5])

    filter_map = {
        "Quick laps": "quick",
        "Clean (no pit)": "clean",
        "Accurate": "accurate",
        "Green flag": "green",
        "By compound": "compound",
    }

    filtered = laps.copy()
    if filter_type != "None":
        fname = filter_map[filter_type]
        try:
            filtered = loader.apply_lap_filter(
                session, fname, compound=compound_choice
            )
            filtered["LapTimeSeconds"] = _to_seconds(filtered["LapTime"])
        except Exception as e:
            st.error(f"Filter error: {e}")
            return

    if driver_filter:
        filtered = filtered[filtered["Driver"].isin(driver_filter)]

    total = len(laps)
    shown = len(filtered)
    st.caption(f"Showing {shown} of {total} laps ({shown/total*100:.1f}%)")

    # ── Lap filter summary ──
    if st.checkbox("Show filter summary table"):
        loader.print_lap_filter_summary(session)
        summary_data = {
            "Filter": ["All", "Quick", "Clean", "Accurate", "Green", "Valid", "Box"],
            "Laps": [
                len(session.laps),
                len(session.laps.pick_quicklaps()),
                len(session.laps.pick_wo_box()),
                len(session.laps.pick_accurate()),
                len(session.laps.pick_track_status("1")),
                len(session.laps.pick_not_deleted()),
                len(session.laps.pick_box_laps()),
            ],
        }
        summary_df = pd.DataFrame(summary_data)
        summary_df["Percentage"] = (summary_df["Laps"] / summary_df["Laps"].iloc[0] * 100).round(1).astype(str) + "%"
        st.dataframe(summary_df, width="stretch", hide_index=True)

    st.divider()

    # ── Lap time scatter plot ──
    st.subheader("Lap Times")

    fig = go.Figure()
    for driver in driver_filter:
        d = filtered[filtered["Driver"] == driver]
        if d.empty:
            continue
        team = str(d.iloc[0].get("Team", ""))
        fig.add_trace(go.Scatter(
            x=d["LapNumber"],
            y=d["LapTimeSeconds"],
            mode="markers+lines",
            name=driver,
            line=dict(color=team_color(team), width=1.5),
            marker=dict(size=4),
            connectgaps=False,
        ))

    fig.update_layout(
        xaxis_title="Lap",
        yaxis_title="Lap Time (seconds)",
        height=450,
        margin=dict(l=0, r=0, t=30, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        hovermode="x unified",
    )
    st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Pace by compound (box plot) ──
    st.subheader("Pace by Compound")

    quick_laps = loader.get_quicklaps(session)
    quick_laps["LapTimeSeconds"] = _to_seconds(quick_laps["LapTime"])

    if driver_filter:
        quick_laps = quick_laps[quick_laps["Driver"].isin(driver_filter)]

    if not quick_laps.empty:
        fig = go.Figure()
        for compound in quick_laps["Compound"].unique():
            subset = quick_laps[quick_laps["Compound"] == compound]
            color = COMPOUND_COLORS.get(str(compound), "#888")
            fig.add_trace(go.Box(
                y=subset["LapTimeSeconds"],
                name=str(compound),
                marker_color=color,
                boxmean=True,
            ))
        fig.update_layout(
            yaxis_title="Lap Time (seconds)",
            height=350,
            margin=dict(l=0, r=0, t=30, b=0),
        )
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("Not enough quick laps for compound comparison.")

    st.divider()

    # ── Degradation curve ──
    st.subheader("Tyre Degradation")
    deg_driver = st.selectbox("Driver for degradation", drivers_sorted, key="deg_driver")

    if deg_driver:
        d_laps = laps[laps["Driver"] == deg_driver].sort_values("LapNumber").copy()
        d_laps["LapTimeSeconds"] = _to_seconds(d_laps["LapTime"])
        clean = d_laps[d_laps["LapTimeSeconds"].notna() & (d_laps["LapNumber"] > 1)]

        fig = go.Figure()
        for stint_num, group in clean.groupby("Stint"):
            compound = str(group["Compound"].iloc[0]) if pd.notna(group["Compound"].iloc[0]) else "?"
            color = COMPOUND_COLORS.get(compound, "#888")
            fig.add_trace(go.Scatter(
                x=group["TyreLife"],
                y=group["LapTimeSeconds"],
                mode="markers+lines",
                name=f"Stint {int(stint_num)} ({compound})",
                line=dict(color=color, width=2),
                marker=dict(size=5),
            ))

        fig.update_layout(
            xaxis_title="Tyre Life (laps)",
            yaxis_title="Lap Time (seconds)",
            height=400,
            margin=dict(l=0, r=0, t=30, b=0),
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
        )
        st.plotly_chart(fig, width="stretch")

    st.divider()

    # ── Sector comparison ──
    st.subheader("Sector Times Comparison")
    sector_drivers = st.multiselect(
        "Compare drivers", drivers_sorted, default=drivers_sorted[:3], key="sector_drivers"
    )

    if sector_drivers:
        sector_cols = ["Sector1Time", "Sector2Time", "Sector3Time"]
        quick = loader.get_quicklaps(session)
        quick["LapTimeSeconds"] = _to_seconds(quick["LapTime"])
        for sc in sector_cols:
            if pd.api.types.is_timedelta64_dtype(quick[sc]):
                quick[sc] = quick[sc].dt.total_seconds()
            else:
                quick[sc] = pd.to_numeric(quick[sc], errors="coerce")

        sector_data = quick[quick["Driver"].isin(sector_drivers)].groupby("Driver")[sector_cols].mean()

        if not sector_data.empty:
            fig = go.Figure()
            sectors = ["S1", "S2", "S3"]
            for driver in sector_data.index:
                team = str(laps[laps["Driver"] == driver].iloc[0].get("Team", "")) if not laps[laps["Driver"] == driver].empty else ""
                fig.add_trace(go.Bar(
                    x=sectors,
                    y=sector_data.loc[driver].values,
                    name=driver,
                    marker_color=team_color(team),
                ))
            fig.update_layout(
                yaxis_title="Average Sector Time (seconds)",
                barmode="group",
                height=350,
                margin=dict(l=0, r=0, t=30, b=0),
            )
            st.plotly_chart(fig, width="stretch")
