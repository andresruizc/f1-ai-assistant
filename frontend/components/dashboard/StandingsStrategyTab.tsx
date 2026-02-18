"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { dashboardApi, type PositionHistoryData, type StrategyData } from "@/lib/dashboard-api";
import { tyreColor } from "@/lib/tyre-colors";

export default function StandingsStrategyTab() {
  const [posData, setPosData] = useState<PositionHistoryData | null>(null);
  const [stratData, setStratData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dashboardApi.positionHistory(),
      dashboardApi.strategy(),
    ])
      .then(([pos, strat]) => { setPosData(pos); setStratData(strat); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mr-3" />
        Loading race data...
      </div>
    );
  }
  if (!posData || !stratData) return <div className="text-red-400">Failed to load data</div>;

  const drivers = Object.keys(posData.positions);
  const chartData: Record<string, unknown>[] = [];
  for (let lap = 1; lap <= posData.total_laps; lap++) {
    const entry: Record<string, unknown> = { lap };
    for (const driver of drivers) {
      const pos = posData.positions[driver]?.find((p) => p.lap === lap);
      entry[driver] = pos?.position ?? null;
    }
    chartData.push(entry);
  }

  const driverOrder = Object.entries(stratData.stints).sort(
    ([, a], [, b]) => (a[0]?.start_lap ?? 0) - (b[0]?.start_lap ?? 0),
  );

  return (
    <div className="space-y-8">
      {/* ── Position History ── */}
      <section>
        <h3 className="text-lg font-bold mb-4">Position History</h3>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="h-[420px] rounded-xl border border-border bg-card p-4"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="lap"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                label={{ value: "Lap", position: "insideBottomRight", offset: -5, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                reversed
                domain={[1, 20]}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                label={{ value: "Position", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {drivers.map((driver) => (
                <Line
                  key={driver}
                  dataKey={driver}
                  stroke={posData.drivers[driver]?.color ?? "#888"}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  name={driver}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Driver legend */}
        <div className="flex flex-wrap gap-3 text-xs mt-3">
          {drivers.map((d) => (
            <div key={d} className="flex items-center gap-1.5">
              <div className="w-3 h-1 rounded" style={{ backgroundColor: posData.drivers[d]?.color }} />
              <span className="text-muted-foreground">{d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tyre Strategy Timeline ── */}
      <section>
        <h3 className="text-lg font-bold mb-4">Tyre Strategy</h3>

        <div className="space-y-1">
          {driverOrder.map(([driver, stints], idx) => {
            const driverInfo = stratData.drivers[driver];
            return (
              <motion.div
                key={driver}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.02 }}
                className="flex items-center gap-2 h-8"
              >
                <span
                  className="w-12 text-xs font-bold text-right shrink-0"
                  style={{ color: driverInfo?.color ?? "#888" }}
                >
                  {driver}
                </span>
                <div className="flex-1 flex h-6 rounded overflow-hidden bg-muted/20">
                  {stints.map((stint) => {
                    const width = ((stint.end_lap - stint.start_lap + 1) / stratData.total_laps) * 100;
                    const left = ((stint.start_lap - 1) / stratData.total_laps) * 100;
                    return (
                      <div
                        key={stint.stint}
                        className="relative h-full flex items-center justify-center text-[10px] font-bold transition-all hover:brightness-125"
                        style={{
                          width: `${width}%`,
                          marginLeft: stint.stint === stints[0]?.stint ? `${left}%` : 0,
                          backgroundColor: tyreColor(stint.compound) + "40",
                          borderLeft: `2px solid ${tyreColor(stint.compound)}`,
                        }}
                        title={`${stint.compound}: Laps ${stint.start_lap}-${stint.end_lap} (${stint.laps} laps)`}
                      >
                        {stint.laps >= 4 && (
                          <span style={{ color: tyreColor(stint.compound) }}>
                            {stint.compound.charAt(0)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Lap axis */}
        <div className="flex items-center gap-2 mt-2">
          <span className="w-12 shrink-0" />
          <div className="flex-1 flex justify-between text-xs text-muted-foreground px-1">
            <span>1</span>
            <span>{Math.round(stratData.total_laps / 4)}</span>
            <span>{Math.round(stratData.total_laps / 2)}</span>
            <span>{Math.round((stratData.total_laps * 3) / 4)}</span>
            <span>{stratData.total_laps}</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs mt-3">
          {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map((c) => (
            <div key={c} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: tyreColor(c) }} />
              <span className="text-muted-foreground">{c}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stint Detail Table ── */}
      <section>
        <h3 className="text-lg font-bold mb-3">Stint Details</h3>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="p-2 text-left">Driver</th>
                <th className="p-2 text-center">Stops</th>
                <th className="p-2 text-left">Stints</th>
              </tr>
            </thead>
            <tbody>
              {driverOrder.map(([driver, stints]) => (
                <tr key={driver} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="p-2 font-bold" style={{ color: stratData.drivers[driver]?.color }}>
                    {driver}
                  </td>
                  <td className="p-2 text-center">{stints.length - 1}</td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      {stints.map((s) => (
                        <span
                          key={s.stint}
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{
                            backgroundColor: tyreColor(s.compound) + "25",
                            color: tyreColor(s.compound),
                            border: `1px solid ${tyreColor(s.compound)}40`,
                          }}
                        >
                          {s.compound.charAt(0)} L{s.start_lap}-{s.end_lap}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
