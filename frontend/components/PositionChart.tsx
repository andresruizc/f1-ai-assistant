"use client";

import { useEffect, useState } from "react";
import { getPositionHistory } from "@/lib/api";
import type { Driver } from "@/lib/types";

interface Props {
  currentLap: number;
  drivers: Driver[];
  selectedDriver: string;
}

export default function PositionChart({
  currentLap,
  drivers,
  selectedDriver,
}: Props) {
  const [data, setData] = useState<Record<string, (number | null)[]>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (currentLap < 1 || drivers.length === 0) return;
    getPositionHistory(currentLap)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [currentLap, drivers.length]);

  if (error) {
    return <div className="text-xs text-destructive">{error}</div>;
  }

  if (Object.keys(data).length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Position chart will appear here
      </div>
    );
  }

  // Simple SVG-based position chart (inverted Y: P1 at top)
  const maxLap = currentLap;
  const maxPos = drivers.length || 20;
  const W = 600;
  const H = 250;
  const PAD = { top: 10, right: 20, bottom: 25, left: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xScale = (lap: number) =>
    PAD.left + ((lap - 1) / Math.max(maxLap - 1, 1)) * plotW;
  const yScale = (pos: number) =>
    PAD.top + ((pos - 1) / Math.max(maxPos - 1, 1)) * plotH;

  const driverColorMap: Record<string, string> = {};
  drivers.forEach((d) => {
    driverColorMap[d.code] = d.color;
  });

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
        Position Chart
      </h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* Y-axis labels */}
        {[1, 5, 10, 15, 20].filter((p) => p <= maxPos).map((pos) => (
          <text
            key={pos}
            x={PAD.left - 5}
            y={yScale(pos) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={9}
          >
            P{pos}
          </text>
        ))}

        {/* X-axis labels */}
        {Array.from({ length: 5 }, (_, i) =>
          Math.max(1, Math.round((i * maxLap) / 4))
        ).map((lap) => (
          <text
            key={lap}
            x={xScale(lap)}
            y={H - 5}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={9}
          >
            {lap}
          </text>
        ))}

        {/* Grid lines */}
        {[1, 5, 10, 15, 20].filter((p) => p <= maxPos).map((pos) => (
          <line
            key={`grid-${pos}`}
            x1={PAD.left}
            y1={yScale(pos)}
            x2={W - PAD.right}
            y2={yScale(pos)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
        ))}

        {/* Driver lines */}
        {Object.entries(data).map(([driver, positions]) => {
          const points = positions
            .map((pos, i) =>
              pos != null ? { x: xScale(i + 1), y: yScale(pos) } : null
            )
            .filter(Boolean) as { x: number; y: number }[];

          if (points.length < 2) return null;

          const d = points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ");

          const isSelected = driver === selectedDriver;
          const color = driverColorMap[driver] ?? "#999";

          return (
            <path
              key={driver}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 3 : 1.2}
              strokeOpacity={isSelected ? 1 : 0.4}
            />
          );
        })}
      </svg>
    </div>
  );
}
