"""AI tool functions and schemas for the race engineer agent.

Each tool calls RaceState methods and returns formatted strings
that the LLM can use to compose data-backed answers.
"""

from typing import Any

from src.race_state import RaceState


# ---------------------------------------------------------------------------
# Tool execution registry — maps tool name to callable
# ---------------------------------------------------------------------------

def execute_tool(
    tool_name: str, arguments: dict[str, Any], race_state: RaceState, current_lap: int
) -> str:
    """Execute a tool by name and return formatted result string."""
    dispatch = {
        "get_race_standings": _tool_standings,
        "get_driver_info": _tool_driver_info,
        "get_lap_times": _tool_lap_times,
        "get_pit_stop_history": _tool_pit_stops,
        "get_tyre_strategy": _tool_tyre_strategy,
        "get_gap_between_drivers": _tool_gap,
        "get_track_status": _tool_track_status,
        "get_weather_conditions": _tool_weather,
        "get_race_summary": _tool_race_summary,
        "compare_drivers": _tool_compare,
    }
    fn = dispatch.get(tool_name)
    if fn is None:
        return f"Unknown tool: {tool_name}"
    return fn(race_state, current_lap, arguments)


# ---------------------------------------------------------------------------
# Individual tool implementations — return formatted strings
# ---------------------------------------------------------------------------

def _tool_standings(rs: RaceState, lap: int, _args: dict) -> str:
    standings = rs.get_standings(lap)
    if not standings:
        return "No standings data available."
    lines = [f"Race Standings — Lap {lap}/{rs.total_laps}"]
    for s in standings:
        gap_str = f"+{s['gap_to_leader']:.1f}s" if s["gap_to_leader"] else "LEADER"
        tyre = f"{s['compound']} L{s['tyre_age']}" if s["compound"] else "?"
        time_str = s.get("last_lap_time_str") or "-"
        lines.append(
            f"P{s['position']}  {s['driver']}  {s['team']}  {tyre}  {gap_str}  {time_str}"
        )
    return "\n".join(lines)


def _tool_driver_info(rs: RaceState, lap: int, args: dict) -> str:
    info = rs.get_driver_info(args["driver_code"], lap)
    if "error" in info:
        return info["error"]
    recent = ", ".join(
        f"L{lt['lap']}: {lt['time']:.3f}s" for lt in info["recent_lap_times"] if lt["time"]
    )
    return (
        f"Driver: {info['name']} ({info['driver']})\n"
        f"Team: {info['team']}\n"
        f"Position: P{info['position']}\n"
        f"Tyre: {info['compound']} (age: {info['tyre_age']} laps, stint {info['stint']})\n"
        f"Pit stops: {info['total_pit_stops']}\n"
        f"Recent laps: {recent}\n"
        f"Best lap: {info['best_lap_time_str']}\n"
        f"Grid position: P{info['grid_position']}"
    )


def _tool_lap_times(rs: RaceState, lap: int, args: dict) -> str:
    last_n = args.get("last_n_laps", 5)
    data = rs.get_lap_times(args["driver_code"], lap, last_n=last_n)
    lines = [f"Lap times for {data['driver']} (last {last_n} laps):"]
    for lt in data["laps"]:
        t_str = f"{lt['time']:.3f}s" if lt["time"] else "N/A"
        lines.append(f"  Lap {lt['lap']}: {t_str} ({lt['compound']})")
    lines.append(f"Average: {data['average_pace_str']}")
    lines.append(f"Best: {data['best_lap_str']}")
    return "\n".join(lines)


def _tool_pit_stops(rs: RaceState, lap: int, args: dict) -> str:
    stops = rs.get_pit_stops(args["driver_code"], lap)
    if not stops:
        return f"{args['driver_code']} has not pitted yet."
    lines = [f"Pit stops for {args['driver_code']}:"]
    for i, s in enumerate(stops, 1):
        lines.append(f"  Stop {i}: Lap {s['lap']} — {s['from_compound']} → {s['to_compound']}")
    return "\n".join(lines)


def _tool_tyre_strategy(rs: RaceState, lap: int, args: dict) -> str:
    stints = rs.get_stints(args["driver_code"], lap)
    deg = rs.get_tyre_degradation(args["driver_code"], lap)
    lines = [f"Tyre strategy for {args['driver_code']}:"]
    for s in stints:
        status = "current" if s["end_lap"] == lap else f"laps {s['start_lap']}-{s['end_lap']}"
        avg_str = s.get("average_pace_str") or "N/A"
        deg_str = f"{s['degradation_rate']:.4f} s/lap" if s["degradation_rate"] else "N/A"
        lines.append(
            f"  Stint {s['stint']}: {s['compound']} ({status}) — "
            f"{s['num_laps']} laps, avg {avg_str}, deg {deg_str}"
        )
    if deg and "error" not in deg:
        lines.append(
            f"\nCurrent stint degradation: {deg['degradation_rate']} s/lap ({deg['severity']})"
        )
    return "\n".join(lines)


def _tool_gap(rs: RaceState, lap: int, args: dict) -> str:
    last_n = args.get("last_n_laps", 5)
    gap = rs.get_gap_to_driver(args["driver_a"], args["driver_b"], lap, last_n=last_n)
    if gap["gap"] is None:
        return f"Cannot compute gap between {args['driver_a']} and {args['driver_b']}."
    trend_str = f"Gap {gap['trend'].upper()}" if gap["trend"] else "Trend unknown"
    rate_str = f" by {abs(gap['rate_per_lap']):.3f}s/lap" if gap["rate_per_lap"] else ""
    behind = args["driver_a"] if gap["ahead"] == args["driver_b"] else args["driver_b"]
    return (
        f"Gap: {behind} is {gap['gap']:.1f}s behind {gap['ahead']}\n"
        f"Trend (last {last_n} laps): {trend_str}{rate_str}\n"
        f"DRS range (<1.0s): {'YES' if gap['gap'] < 1.0 else 'NO'} "
        f"({'approaching' if gap['gap'] < 1.5 else ''})"
    )


def _tool_track_status(rs: RaceState, lap: int, _args: dict) -> str:
    status = rs.get_track_status(lap)
    lines = [f"Track Status: {status['current']}"]
    if status["history"]:
        lines.append("History:")
        for e in status["history"][-5:]:
            lines.append(f"  Lap {e['lap']}: {e['status']} — {e['message']}")
    return "\n".join(lines)


def _tool_weather(rs: RaceState, lap: int, _args: dict) -> str:
    w = rs.get_weather(lap)
    if "error" in w:
        return w["error"]
    rain = "YES — consider intermediates" if w["rainfall"] else "No"
    return (
        f"Weather Conditions (Lap {lap}):\n"
        f"  Air temp: {w['air_temp']}°C\n"
        f"  Track temp: {w['track_temp']}°C\n"
        f"  Humidity: {w['humidity']}%\n"
        f"  Wind: {w['wind_speed']} m/s\n"
        f"  Rainfall: {rain}"
    )


def _tool_race_summary(rs: RaceState, lap: int, _args: dict) -> str:
    summary = rs.get_race_summary(lap)
    lines = [f"Race Summary — Lap {lap}/{summary['total_laps']}"]
    if summary["pit_stops"]:
        lines.append(f"\nPit stops ({len(summary['pit_stops'])}):")
        for p in summary["pit_stops"]:
            lines.append(f"  {p['driver']} — Lap {p['lap']}: {p['from_compound']} → {p['to_compound']}")
    if summary["safety_cars"]:
        lines.append(f"\nSafety cars / flags:")
        for sc in summary["safety_cars"]:
            lines.append(f"  Lap {sc['lap']}: {sc['status']}")
    if summary["retirements"]:
        lines.append(f"\nRetirements:")
        for r in summary["retirements"]:
            lines.append(f"  {r['driver']} — out on lap {r['last_lap']}")
    if summary["position_movers"]:
        lines.append(f"\nBiggest movers from grid:")
        for m in summary["position_movers"][:5]:
            direction = "UP" if m["change"] > 0 else "DOWN"
            lines.append(f"  {m['driver']}: P{m['grid']} → P{m['current']} ({direction} {abs(m['change'])})")
    return "\n".join(lines)


def _tool_compare(rs: RaceState, lap: int, args: dict) -> str:
    cmp = rs.compare_drivers(args["driver_a"], args["driver_b"], lap)
    a = cmp["driver_a"]
    b = cmp["driver_b"]
    g = cmp["gap"]
    pa = cmp["pace_comparison"][args["driver_a"]]
    pb = cmp["pace_comparison"][args["driver_b"]]
    return (
        f"Head-to-head: {args['driver_a']} vs {args['driver_b']}\n"
        f"\n{args['driver_a']} ({a['team']}):\n"
        f"  Position: P{a['position']}, Tyre: {a['compound']} (age {a['tyre_age']})\n"
        f"  Avg pace (last 5): {pa['avg_last_5_str']}\n"
        f"\n{args['driver_b']} ({b['team']}):\n"
        f"  Position: P{b['position']}, Tyre: {b['compound']} (age {b['tyre_age']})\n"
        f"  Avg pace (last 5): {pb['avg_last_5_str']}\n"
        f"\nGap: {g['gap']:.1f}s ({g['ahead']} ahead)\n"
        f"Trend: {g['trend'] or 'unknown'}"
        + (f" ({abs(g['rate_per_lap']):.3f}s/lap)" if g.get("rate_per_lap") else "")
    )


# ---------------------------------------------------------------------------
# Tool schemas — OpenAI function-calling format (used by LiteLLM)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_race_standings",
            "description": (
                "Get the current race standings showing all driver positions, tyre compounds, "
                "gaps to leader, and last lap times. Use when asked about the order, who's leading, "
                "where a driver is, or the current state of the race."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_driver_info",
            "description": (
                "Get detailed information about a specific driver: position, tyre compound and age, "
                "stint number, pit stop count, recent lap times, best lap, and grid position. "
                "Use when asked about a specific driver's status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_code": {
                        "type": "string",
                        "description": "Three-letter driver code, e.g. 'VER', 'HAM', 'NOR'",
                    }
                },
                "required": ["driver_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lap_times",
            "description": (
                "Get recent lap times for a driver with average pace and best lap. "
                "Use when asked about pace, lap times, speed, or consistency."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_code": {
                        "type": "string",
                        "description": "Three-letter driver code, e.g. 'VER', 'HAM', 'NOR'",
                    },
                    "last_n_laps": {
                        "type": "integer",
                        "description": "Number of recent laps to return. Default 5.",
                    },
                },
                "required": ["driver_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pit_stop_history",
            "description": (
                "Get the list of pit stops for a driver: when they pitted and what compounds "
                "they switched between. Use when asked about pit stops or tyre changes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_code": {
                        "type": "string",
                        "description": "Three-letter driver code",
                    }
                },
                "required": ["driver_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tyre_strategy",
            "description": (
                "Get complete tyre strategy for a driver: all stints with compound, lap count, "
                "average pace, and degradation rate. Use when asked about tyres, degradation, "
                "stint analysis, or whether to pit."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_code": {
                        "type": "string",
                        "description": "Three-letter driver code",
                    }
                },
                "required": ["driver_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_gap_between_drivers",
            "description": (
                "Get the time gap between two drivers and whether it's increasing or decreasing. "
                "Use when asked about gaps, intervals, DRS range, or whether a driver is "
                "catching or pulling away."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_a": {
                        "type": "string",
                        "description": "Three-letter driver code for the first driver",
                    },
                    "driver_b": {
                        "type": "string",
                        "description": "Three-letter driver code for the second driver",
                    },
                    "last_n_laps": {
                        "type": "integer",
                        "description": "Number of recent laps to compute gap trend over. Default 5.",
                    },
                },
                "required": ["driver_a", "driver_b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_track_status",
            "description": (
                "Get the current track status (green, safety car, VSC, yellow, red flag) "
                "and history of status changes. Use when asked about flags, safety cars, or track conditions."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather_conditions",
            "description": (
                "Get current weather: air temp, track temp, humidity, wind speed, and whether "
                "it's raining. Use when asked about weather, temperature, rain, or tyre choice "
                "related to conditions."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_race_summary",
            "description": (
                "Get a summary of key events so far: all pit stops, safety car periods, "
                "retirements, and biggest position changes from grid. Use when asked for a "
                "race recap, what's happened, any incidents, or DNFs."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_drivers",
            "description": (
                "Head-to-head comparison of two drivers: position, tyre state, average pace, "
                "gap, and gap trend. Use when asked to compare two drivers or who's faster."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_a": {
                        "type": "string",
                        "description": "Three-letter driver code for the first driver",
                    },
                    "driver_b": {
                        "type": "string",
                        "description": "Three-letter driver code for the second driver",
                    },
                },
                "required": ["driver_a", "driver_b"],
            },
        },
    },
]
