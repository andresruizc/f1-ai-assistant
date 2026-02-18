"use client";

import type { StandingsEntry, TyreCompound } from "@/lib/types";
import { TYRE_COLORS } from "@/lib/types";

interface Props {
  standings: StandingsEntry[];
  selectedDriver: string;
  currentLap: number;
  totalLaps: number;
}

function TyreBadge({ compound }: { compound: TyreCompound | null }) {
  if (!compound) return <span className="text-xs text-muted-foreground">—</span>;

  const color = TYRE_COLORS[compound] ?? "#999";
  const isHard = compound === "HARD";

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{
        backgroundColor: color,
        color: isHard ? "#333" : "#fff",
        border: isHard ? "1px solid #999" : "none",
      }}
    >
      {compound.charAt(0)}
    </span>
  );
}

export default function StandingsTable({
  standings,
  selectedDriver,
  currentLap,
  totalLaps,
}: Props) {
  if (standings.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        Load a race to see standings
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
        Race Standings — Lap {currentLap}/{totalLaps}
      </h3>
      <div className="overflow-auto max-h-[400px] scrollbar-thin">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1 px-1 text-left w-8">P</th>
              <th className="py-1 px-2 text-left">Driver</th>
              <th className="py-1 px-2 text-left">Team</th>
              <th className="py-1 px-1 text-center">Tyre</th>
              <th className="py-1 px-1 text-right">Age</th>
              <th className="py-1 px-2 text-right">Gap</th>
              <th className="py-1 px-2 text-right">Last Lap</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const isSelected = s.driver === selectedDriver;
              return (
                <tr
                  key={s.driver}
                  className={`border-b border-border/50 ${
                    isSelected
                      ? "bg-primary/10 font-semibold"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <td className="py-1.5 px-1 font-bold">{s.position ?? "—"}</td>
                  <td className="py-1.5 px-2 font-medium">{s.driver}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">
                    {s.team}
                  </td>
                  <td className="py-1.5 px-1 text-center">
                    <TyreBadge compound={s.compound} />
                  </td>
                  <td className="py-1.5 px-1 text-right text-muted-foreground">
                    {s.tyre_age != null ? `L${s.tyre_age}` : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {s.gap_to_leader != null
                      ? s.gap_to_leader === 0
                        ? "LEADER"
                        : `+${s.gap_to_leader.toFixed(1)}s`
                      : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {s.last_lap_time_str ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
