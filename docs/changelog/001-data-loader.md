# 001 — F1 Data Loader

> Date: 2025-02-16

## What was built

Created `src/data_loader.py` — a comprehensive module for downloading, caching, and exploring F1 race data from the 2025 season using FastF1.

## Why

We need a reliable way to:
1. Download all 2025 race sessions and cache them locally
2. Explore the data conveniently (who won? what tyres? how many laps?)
3. Understand the raw DataFrame structures before building the race state and AI tools on top

This is the foundation for everything else — the `RaceState` class, the AI agent tools, and the API endpoints all consume data that starts here.

## What it does

### `F1DataLoader` class

- **Schedule access**: Fetches the full 2025 calendar (24 rounds) from FastF1
- **Session loading**: Downloads and caches individual race sessions. First download is ~10-30s per race; subsequent loads read from the local cache in ~2-5s
- **Race summaries**: Winner, podium, fastest lap, DNFs
- **Driver info**: Full grid with codes, names, teams, finishing positions
- **Lap data**: Clean DataFrames with a computed `LapTimeSeconds` column
- **Stint analysis**: Compound, lap range, average pace, best lap per stint
- **Pit stops**: Lap-by-lap compound changes
- **Weather**: Temperature ranges, humidity, rainfall detection
- **Track status**: Safety car, VSC, red flag events
- **DataFrame inspection**: Column names, dtypes, row counts, sample values for every DataFrame in a session

### CLI entry point

Registered as `f1-data-loader` in `pyproject.toml`:

```bash
uv run f1-data-loader --info         # show schedule
uv run f1-data-loader --round 1      # download + summarise one race
uv run f1-data-loader --round 1 --inspect  # also show DataFrame structures
uv run f1-data-loader                # download all 24 races
```

## Files changed

| File | Change |
|---|---|
| `src/data_loader.py` | **Created** — F1DataLoader class + CLI |
| `pyproject.toml` | Added `[project.scripts]` entry points: `f1-data-loader`, `f1-api` |
| `src/api/main.py` | Added `cli()` function for `f1-api` entry point |
| `Makefile` | Updated all commands to use `uv run`; added `make load-data` |

## Design decisions

1. **Session-scoped, not pre-processed**: We store the raw FastF1 cache, not pre-processed CSVs. This gives maximum flexibility — any query can be answered from the raw data.
2. **Lazy loading with in-memory cache**: Sessions are downloaded on first access, then kept in memory for the lifetime of the `F1DataLoader` instance.
3. **Race only (not qualifying/sprint)**: The user requested race data only for the initial implementation. Adding qualifying/sprint is trivial later — just change the session type from `"R"` to `"Q"` or `"S"`.
4. **CLI + library dual use**: The same module works as both a command-line tool and an importable Python library.

## Data storage

All data lives in `data/.fastf1_cache/` and is:
- Managed entirely by FastF1 (pickle files + SQLite HTTP cache)
- Gitignored (each developer downloads their own copy)
- Persisted in Docker via a named volume

See `data/README.md` for the full breakdown.

## Verified

- `uv run f1-data-loader --info` — prints 24-round 2025 schedule
- `uv run f1-data-loader --round 1` — downloads Australian GP, prints summary (Norris P1, 57 laps, 6 DNFs, rain race)
- All imports resolve correctly via `uv run`
