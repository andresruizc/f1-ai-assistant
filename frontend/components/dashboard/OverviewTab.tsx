"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { dashboardApi, type OverviewData } from "@/lib/dashboard-api";
import { formatLapTime } from "@/lib/tyre-colors";

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.overview().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading overview...</div>;
  if (!data) return <div className="text-red-400">Failed to load overview data</div>;

  const podium = data.results.filter((r) => r.position && r.position <= 3);
  const retirements = data.results.filter((r) => r.status !== "Finished" && r.status !== "+1 Lap" && r.status !== "+2 Laps");

  return (
    <div className="space-y-6">
      {/* Podium */}
      <div className="grid grid-cols-3 gap-4">
        {[2, 1, 3].map((pos) => {
          const d = podium.find((r) => r.position === pos);
          if (!d) return null;
          const heights = { 1: "h-40", 2: "h-32", 3: "h-28" };
          return (
            <motion.div
              key={pos}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: pos * 0.15, duration: 0.5 }}
              className="flex flex-col items-center"
            >
              {d.headshot && (
                <img
                  src={d.headshot}
                  alt={d.driver}
                  className="w-20 h-20 rounded-full object-cover bg-muted mb-2 ring-2"
                  style={{ ringColor: d.color, borderColor: d.color, border: `2px solid ${d.color}` }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <span className="text-3xl font-black mb-0.5" style={{ color: d.color }}>
                {d.driver}
              </span>
              <span className="text-xs text-muted-foreground mb-0.5">{d.name}</span>
              <span className="text-sm text-muted-foreground mb-1">{d.team}</span>
              <div
                className={`${heights[pos as 1 | 2 | 3]} w-full rounded-t-lg flex items-center justify-center text-5xl font-black`}
                style={{ background: `${d.color}20`, borderTop: `3px solid ${d.color}` }}
              >
                P{pos}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Fastest lap */}
      {data.fastest_lap && (() => {
        const flDriver = data.results.find((r) => r.driver === data.fastest_lap!.driver);
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 flex items-center gap-4"
          >
            {flDriver?.headshot && (
              <img
                src={flDriver.headshot}
                alt={flDriver.driver}
                className="w-10 h-10 rounded-full object-cover bg-muted shrink-0"
                style={{ border: `2px solid ${flDriver.color}` }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span className="text-purple-400 text-2xl">⚡</span>
            <div>
              <span className="text-sm text-muted-foreground">Fastest Lap</span>
              <p className="text-lg font-bold">
                {data.fastest_lap.driver} — {formatLapTime(data.fastest_lap.time)}{" "}
                <span className="text-muted-foreground text-sm">(Lap {data.fastest_lap.lap})</span>
              </p>
            </div>
          </motion.div>
        );
      })()}

      {/* Results table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="p-2 text-left w-12">Pos</th>
              <th className="p-2 text-left">Driver</th>
              <th className="p-2 text-left">Team</th>
              <th className="p-2 text-center">Grid</th>
              <th className="p-2 text-center">+/-</th>
              <th className="p-2 text-right">Pts</th>
              <th className="p-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((r, i) => {
              const gained = r.grid && r.position ? r.grid - r.position : 0;
              return (
                <motion.tr
                  key={r.driver}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="p-2 font-bold">{r.position ?? "-"}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {r.headshot && (
                        <img
                          src={r.headshot}
                          alt={r.driver}
                          className="w-6 h-6 rounded-full object-cover bg-muted shrink-0"
                          style={{ border: `1.5px solid ${r.color}` }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      <div>
                        <span className="font-semibold" style={{ color: r.color }}>{r.driver}</span>
                        <span className="text-xs text-muted-foreground ml-1.5">{r.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-2 text-muted-foreground">{r.team}</td>
                  <td className="p-2 text-center">{r.grid ?? "-"}</td>
                  <td className="p-2 text-center">
                    {gained > 0 && <span className="text-green-400">+{gained}</span>}
                    {gained < 0 && <span className="text-red-400">{gained}</span>}
                    {gained === 0 && <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="p-2 text-right font-medium">{r.points}</td>
                  <td className="p-2 text-right text-muted-foreground text-xs">{r.status}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Retirements */}
      {retirements.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h3 className="text-sm font-semibold text-red-400 mb-2">Retirements / Issues</h3>
          <div className="flex flex-wrap gap-3">
            {retirements.map((r) => (
              <span key={r.driver} className="text-xs bg-red-500/10 text-red-300 px-2 py-1 rounded">
                {r.driver}: {r.status}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
