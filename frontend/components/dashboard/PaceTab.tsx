"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";
import { dashboardApi, type PaceLap } from "@/lib/dashboard-api";
import { tyreColor, formatLapTime } from "@/lib/tyre-colors";

const FILTERS = [
  { id: "all", label: "All Laps" },
  { id: "quicklaps", label: "Quick Laps" },
  { id: "accurate", label: "Accurate" },
  { id: "wo_box", label: "No Box Laps" },
];

export default function PaceTab() {
  const [laps, setLaps] = useState<PaceLap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("quicklaps");

  useEffect(() => {
    setLoading(true);
    dashboardApi.pace(filter).then((d) => setLaps(d.laps)).catch(console.error).finally(() => setLoading(false));
  }, [filter]);

  const median = laps.length > 0
    ? [...laps].sort((a, b) => a.time - b.time)[Math.floor(laps.length / 2)]?.time ?? 90
    : 90;
  const yMin = Math.floor(median - 5);
  const yMax = Math.ceil(median + 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Pace Analysis</h3>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">Loading pace data...</div>
      ) : (
        <>
          {/* Lap time scatter */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-[400px] rounded-lg border border-border bg-card p-4"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="lap"
                  type="number"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  name="Lap"
                />
                <YAxis
                  dataKey="time"
                  type="number"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  domain={[yMin, yMax]}
                  tickFormatter={(v: number) => formatLapTime(v)}
                  name="Time"
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0].payload as PaceLap;
                    return (
                      <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
                        <p className="font-bold">{d.driver} - Lap {d.lap}</p>
                        <p>{formatLapTime(d.time)}</p>
                        <p className="text-muted-foreground">{d.compound} (life: {d.tyre_life})</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={laps} fill="#888">
                  {laps.map((lap, i) => (
                    <Cell key={i} fill={tyreColor(lap.compound)} opacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Legend */}
          <div className="flex gap-4 text-xs">
            {["SOFT", "MEDIUM", "HARD"].map((c) => (
              <div key={c} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tyreColor(c) }} />
                <span className="text-muted-foreground">{c}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
