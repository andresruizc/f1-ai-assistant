"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { dashboardApi, type PositionHistoryData } from "@/lib/dashboard-api";

export default function StandingsTab() {
  const [data, setData] = useState<PositionHistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.positionHistory().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading position data...</div>;
  if (!data) return <div className="text-red-400">Failed to load standings data</div>;

  const drivers = Object.keys(data.positions);
  const chartData: Record<string, unknown>[] = [];

  for (let lap = 1; lap <= data.total_laps; lap++) {
    const entry: Record<string, unknown> = { lap };
    for (const driver of drivers) {
      const pos = data.positions[driver]?.find((p) => p.lap === lap);
      entry[driver] = pos?.position ?? null;
    }
    chartData.push(entry);
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-bold">Position History</h3>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="h-[500px] rounded-lg border border-border bg-card p-4"
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
                stroke={data.drivers[driver]?.color ?? "#888"}
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
      <div className="flex flex-wrap gap-3 text-xs">
        {drivers.map((d) => (
          <div key={d} className="flex items-center gap-1.5">
            <div className="w-3 h-1 rounded" style={{ backgroundColor: data.drivers[d]?.color }} />
            <span className="text-muted-foreground">{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
