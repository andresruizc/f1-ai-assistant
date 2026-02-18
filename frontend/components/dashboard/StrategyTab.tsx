"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { dashboardApi, type StrategyData } from "@/lib/dashboard-api";
import { tyreColor } from "@/lib/tyre-colors";

export default function StrategyTab() {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.strategy().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading strategy...</div>;
  if (!data) return <div className="text-red-400">Failed to load strategy data</div>;

  const driverOrder = Object.entries(data.stints).sort(
    ([, a], [, b]) => (a[0]?.start_lap ?? 0) - (b[0]?.start_lap ?? 0)
  );

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold">Tyre Strategy Timeline</h3>

      {/* Strategy timeline */}
      <div className="space-y-1">
        {driverOrder.map(([driver, stints], idx) => {
          const driverInfo = data.drivers[driver];
          return (
            <motion.div
              key={driver}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
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
                  const width = ((stint.end_lap - stint.start_lap + 1) / data.total_laps) * 100;
                  const left = ((stint.start_lap - 1) / data.total_laps) * 100;
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
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0" />
        <div className="flex-1 flex justify-between text-xs text-muted-foreground px-1">
          <span>1</span>
          <span>{Math.round(data.total_laps / 4)}</span>
          <span>{Math.round(data.total_laps / 2)}</span>
          <span>{Math.round((data.total_laps * 3) / 4)}</span>
          <span>{data.total_laps}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs">
        {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map((c) => (
          <div key={c} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: tyreColor(c) }} />
            <span className="text-muted-foreground">{c}</span>
          </div>
        ))}
      </div>

      {/* Detailed stints table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="p-2 text-left">Driver</th>
              <th className="p-2 text-center">Stints</th>
              <th className="p-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {driverOrder.map(([driver, stints]) => (
              <tr key={driver} className="border-t border-border/50">
                <td className="p-2 font-bold" style={{ color: data.drivers[driver]?.color }}>
                  {driver}
                </td>
                <td className="p-2 text-center">{stints.length}</td>
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
    </div>
  );
}
