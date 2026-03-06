Implemented — and this time with a clearer, high-value UI in `ReplayTab` so it’s intuitive in race usage.

### What’s now live in the interface

- **Compact Live Flags ribbon**
  - Track status (`Green / VSC / SC / etc`)
  - Rain risk %
  - Tyre window phase (`Push / Manage / Cliff risk`)
  - Pit window (`OPEN / CLOSED`)
  - Quick actions: `Show battles`, `Show pit threats`, `Focus leader train`

- **Battle Focus Mode (auto-highlight + hints)**
  - Auto-detects nearest battles (`gap < 1.2s`)
  - Computes overtake probability using:
    - gap
    - delta speed
    - DRS boost
    - distance trend proxy (`closing / dropping / flat`)
  - Highlights battle drivers:
    - in standings (`⚔` + visual row emphasis)
    - on track (orange ring)

- **Pit Strategy Intelligence (selected driver)**
  - Undercut / overcut delta (estimated)
  - Estimated rejoin position
  - Projected tyre life
  - Pit-loss estimate vs field baseline

- **Tyre Cliff Detector**
  - Detects degradation inflection from recent lap-time behavior
  - Shows `LOW / MEDIUM / HIGH` cliff risk + delta

- **Restart Performance Score**
  - Detects latest transition back to green from SC/VSC period
  - Shows gains/losses in first ~2 laps equivalent window

- **Corner-type Strength ranking**
  - Classifies top drivers as `speed` vs `traction` bias
  - Ranks by speed trap behavior for quick comparison

- **Track Map Intelligence Layers toggle**
  - DRS zones
  - Speed heat
  - Throttle/Brake cues
  - Pit influence
  - Clear toggles in-map, always visible and easy to use

---

### Where I changed code

- `frontend/components/dashboard/ReplayTab.tsx` (main implementation)

---

### Validation

- Lint passes (only existing `img` optimization warnings remain).
- No new compile/runtime errors introduced from these additions.

If you want, next I can mirror the same intelligence UX into `EngineerTab` so both tabs feel consistent.