# F1 AI Race Engineer — Documentation

This directory contains all project documentation, organized by purpose.

```
docs/
├── README.md                            # You are here — navigation index
├── architecture/                        # System design & technical decisions
│   ├── project-structure.md             # Folder layout, conventions, what lives where
│   ├── data-layer.md                    # FastF1 data: loading, caching, F1DataLoader API
│   ├── data-sources.md                  # All 10 data sources with column details
│   └── race-data-guide.md              # ★ Master reference for AI agents & analysis
├── guides/                              # How-to guides for developers
│   ├── getting-started.md               # Setup, running, first steps
│   ├── cli-reference.md                # All CLI commands, flags, and examples
│   └── dashboard-visualizations.md     # How each chart is built from CSV data
└── changelog/                           # Chronological log of what was built and why
    ├── 001-data-loader.md               # F1DataLoader for 2025 season
    ├── 002-csv-export.md                # CSV export with Timedelta conversion
    └── 003-telemetry-and-lap-filters.md # Per-lap telemetry merging & smart lap filters
```

## How to use this

- **AI agent building insights?** Start with `architecture/race-data-guide.md` — it has cross-referencing patterns, race reconstruction capabilities, data quality notes, and query templates.
- **What data is available?** Read `architecture/data-sources.md` for every column in every DataFrame (10 datasets).
- **Building something new?** Check `architecture/data-layer.md` for the full `F1DataLoader` API.
- **How do I run X?** Read `guides/cli-reference.md` for all CLI commands and flags.
- **How are the charts built?** Read `guides/dashboard-visualizations.md` for step-by-step breakdowns of every visualization.
- **Just getting started?** Read `guides/getting-started.md`.
- **Want to see what changed recently?** Browse `changelog/` (numbered sequentially).

## Key documents for AI agents

When an AI agent needs to understand and analyse F1 race data, it should read these in order:

1. **`architecture/race-data-guide.md`** — the master reference. Covers what data exists, how datasets relate, what questions can/cannot be answered, cross-referencing patterns, and data quality caveats.
2. **`architecture/data-sources.md`** — detailed column-level reference for all 10 datasets (8 raw + 2 derived).
3. **`architecture/data-layer.md`** — the `F1DataLoader` Python API for loading, filtering, and exporting data programmatically.

## Conventions

- Changelog entries are numbered `001-`, `002-`, etc. in the order they were built.
- Architecture docs are evergreen — they get updated as the system evolves.
- Guides are task-oriented — "how do I do X?"
