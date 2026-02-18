"use client";

interface Props {
  currentLap: number;
  totalLaps: number;
  onLapChange: (lap: number) => void;
}

export default function LapControls({ currentLap, totalLaps, onLapChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground font-medium">Lap</label>
        <span className="text-sm font-bold">
          {currentLap} / {totalLaps}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onLapChange(Math.max(1, currentLap - 1))}
          disabled={currentLap <= 1}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-30"
        >
          ◄
        </button>

        <input
          type="range"
          min={1}
          max={totalLaps}
          value={currentLap}
          onChange={(e) => onLapChange(Number(e.target.value))}
          className="flex-1 accent-primary"
        />

        <button
          onClick={() => onLapChange(Math.min(totalLaps, currentLap + 1))}
          disabled={currentLap >= totalLaps}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-30"
        >
          ►
        </button>
      </div>
    </div>
  );
}
