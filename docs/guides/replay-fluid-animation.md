# Fluid Race Replay — How It Works

> Last updated: 2026-03-05
>
> This guide explains how the race replay is made smooth ("fluid") in the React dashboard.

---

## Why replay looked jumpy before

The old replay advanced in **whole frame steps**:

- Backend sampled positions every 4 seconds.
- Frontend moved from frame `N` to frame `N+1` on a timer.
- Dot positions changed only at those boundaries.

That creates visible jumps ("batch movement"), especially in corners.

---

## The fluid replay model

The replay now uses two layers:

1. **Sampled source frames** from backend (`sample_interval`, now default `0.25s`).
2. **Interpolated render frame** in frontend on every `requestAnimationFrame` tick.

Think of it as:

- Backend gives "checkpoints".
- Frontend animates continuously between checkpoints.

---

## Backend changes (sampling density)

Endpoint: `src/api/routes/dashboard.py` (`/api/dashboard/replay`)

- Default interval changed from `4.0` to `0.25`.
- Minimum allowed interval changed from `1.0` to `0.1`.

This gives denser frame data, which improves interpolation quality and reduces visual artifacts.
Additionally, a light backend smoothing pass is applied to interpolated X/Y trajectories
to reduce single-sample GPS jitter without changing race logic.

---

## Frontend changes (continuous playhead)

Files:

- `frontend/components/dashboard/ReplayTab.tsx`
- `frontend/components/dashboard/EngineerTab.tsx`

### 1) Floating playhead

Instead of integer `frame`, replay uses `playhead: number`.

- `playhead = 12.3` means "30% between frame 12 and frame 13".
- UI still reads lap/status from the nearest frame as needed.

### 2) Real-time clock

Playback now advances by real elapsed time:

```text
frameAdvance = (deltaMs / (sample_interval * 1000)) * playbackRate
```

- `deltaMs`: time since last animation tick.
- `sample_interval`: seconds between backend frames.
- `playbackRate`: 0.5x, 1x, 2x, 5x, 10x.

This keeps animation speed physically consistent.

### 3) Driver interpolation

For each driver present in consecutive frames:

- `x`, `y` are linearly interpolated.
- `speed`, `throttle`, `brake`, `rpm` are interpolated.
- `gear`, `drs` are interpolated then rounded.

If a driver is missing in the next frame, current values are kept.

---

## Why this feels smoother

- Canvas still redraws at browser refresh cadence (usually 60 FPS).
- Car dots no longer wait for discrete frame boundaries.
- Telemetry widgets update continuously instead of snapping.

---

## Performance and tuning

If you want to tune behavior:

- **Smoother motion**: lower replay interval (`0.25` -> `0.2`).
- **Lower CPU / payload**: raise interval (`0.25` -> `0.5` or `1.0`).
- **Faster playback**: increase playback rate buttons (2x, 5x, 10x).

Recommended baseline for most races: `0.25s`.

---

## Known limitations

- This is still replay data, not a live socket feed.
- Interpolation is linear; if source data is sparse/noisy, minor path artifacts can appear.
- Very small intervals increase payload size and build time in replay preparation.

## Why cars can appear off-track

If some drivers look outside the road while others look fine, the most common issue is
**coordinate transform misalignment**, not necessarily wrong telemetry.

The replay engine rotates GPS coordinates to align the circuit. For this to work:

- Track outline
- Corner markers
- Driver trajectories
- DRS zones

must all use the **same rotation center**.

If each driver is rotated around a different center, each trajectory gets a different
implicit translation, and some cars can be visibly shifted off the circuit.

The current implementation fixes this by deriving one shared pivot and applying it to
all rotated geometry.

## Outlier protection ("track lock")

Even with correct transforms, some telemetry samples can be GPS outliers. To keep the
visual replay stable, the renderer applies a final guard:

- Compute nearest point on the track centerline.
- If driver point is farther than a threshold (currently ~90 units), snap display point
  to that nearest track point.

This guard is visual-only (for map rendering). Telemetry values (speed/throttle/etc.)
are not altered.

---

## Next step for true live streaming

For fully live sessions (not precomputed replay):

1. Stream telemetry via WebSocket/SSE from backend.
2. Keep a rolling buffer of the latest points.
3. Interpolate against wall-clock time exactly as done now.

The current playhead/interpolation architecture is compatible with that future upgrade.

