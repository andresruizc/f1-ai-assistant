"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import { dashboardApi, type TelemetryCompareData } from "@/lib/dashboard-api";
import { getDrivers } from "@/lib/api";
import type { Driver } from "@/lib/types";

const MAX_DRIVERS = 4;

export default function TelemetryTab() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [lap, setLap] = useState(1);
  const [data, setData] = useState<TelemetryCompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDrivers().then((d) => {
      setDrivers(d);
      if (d.length >= 2) setSelected([d[0].code, d[1].code]);
    }).catch(console.error);
  }, []);

  const fetchData = useCallback(() => {
    if (selected.length === 0) return;
    setLoading(true);
    setError("");
    dashboardApi.telemetryCompare(selected, lap)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected, lap]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleDriver = (code: string) => {
    setSelected((prev) => {
      if (prev.includes(code)) return prev.filter((d) => d !== code);
      if (prev.length >= MAX_DRIVERS) return prev;
      return [...prev, code];
    });
  };

  const traceEntries = data ? Object.entries(data.traces) : [];

  const mergedData = (() => {
    if (!data) return [];
    const firstTrace = traceEntries[0]?.[1]?.points;
    if (!firstTrace) return [];
    return firstTrace.map((pt, i) => {
      const row: Record<string, unknown> = { distance: pt.distance };
      for (const [drv, trace] of traceEntries) {
        const p = trace.points[i];
        if (p) {
          row[`speed_${drv}`] = p.speed;
          row[`throttle_${drv}`] = p.throttle;
          row[`brake_${drv}`] = p.brake;
          row[`gear_${drv}`] = p.ngear;
        }
      }
      return row;
    });
  })();

  const charts: { key: string; label: string; prefix: string; domain?: [number, number]; unit?: string }[] = [
    { key: "speed", label: "Speed (km/h)", prefix: "speed_", unit: " km/h" },
    { key: "throttle", label: "Throttle (%)", prefix: "throttle_", domain: [0, 100], unit: "%" },
    { key: "brake", label: "Brake", prefix: "brake_", domain: [0, 100], unit: "%" },
    { key: "gear", label: "Gear", prefix: "gear_", domain: [0, 8] },
  ];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-2">
            Select drivers to compare <span className="text-muted-foreground">(max {MAX_DRIVERS})</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {drivers.map((d) => {
              const isActive = selected.includes(d.code);
              return (
                <button
                  key={d.code}
                  onClick={() => toggleDriver(d.code)}
                  disabled={!isActive && selected.length >= MAX_DRIVERS}
                  className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-all border ${
                    isActive
                      ? "border-current shadow-sm"
                      : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  }`}
                  style={isActive ? { color: d.color, borderColor: d.color, backgroundColor: d.color + "15" } : undefined}
                >
                  {d.code}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-sm font-medium">Lap</label>
          <input
            type="number"
            min={1}
            max={78}
            value={lap}
            onChange={(e) => setLap(Number(e.target.value))}
            className="bg-background border border-border rounded-lg w-20 px-3 py-1.5 text-sm text-center"
          />
        </div>
      </div>

      {/* Active chips */}
      {selected.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {selected.map((code) => {
            const d = drivers.find((dr) => dr.code === code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full"
                style={{ backgroundColor: (d?.color ?? "#888") + "20", color: d?.color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d?.color }} />
                {code} — {d?.name}
              </span>
            );
          })}
        </div>
      )}

      {error && <div className="text-red-500 text-sm bg-red-500/10 rounded-lg p-3">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mr-3" />
          Loading telemetry...
        </div>
      ) : mergedData.length > 0 ? (
        <div className="space-y-4">
          {charts.map((chart, ci) => (
            <motion.div
              key={chart.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.08 }}
              className="rounded-xl border border-border bg-card p-4"
              style={{ height: chart.key === "speed" ? 240 : 180 }}
            >
              <p className="text-xs font-medium text-muted-foreground mb-2">{chart.label}</p>
              <ResponsiveContainer width="100%" height="90%">
                {chart.key === "speed" ? (
                  <AreaChart data={mergedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="distance"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickFormatter={(v: number) => `${Math.round(v)}m`}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                      formatter={(v, name) => {
                        const drv = String(name).replace("speed_", "");
                        return [`${Math.round(Number(v))} km/h`, drv];
                      }}
                    />
                    {traceEntries.map(([drv, trace]) => (
                      <Area
                        key={drv}
                        type="monotone"
                        dataKey={`speed_${drv}`}
                        stroke={trace.color}
                        fill={trace.color + "15"}
                        strokeWidth={1.8}
                        dot={false}
                        name={`speed_${drv}`}
                      />
                    ))}
                  </AreaChart>
                ) : (
                  <LineChart data={mergedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="distance" hide />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      domain={chart.domain}
                      {...(chart.key === "gear" ? { ticks: [1, 2, 3, 4, 5, 6, 7, 8] } : {})}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                      formatter={(v, name) => {
                        const drv = String(name).replace(chart.prefix, "");
                        return [`${chart.key === "gear" ? v : Math.round(Number(v))}${chart.unit ?? ""}`, drv];
                      }}
                    />
                    {traceEntries.map(([drv, trace]) => (
                      <Line
                        key={drv}
                        type={chart.key === "gear" ? "stepAfter" : "monotone"}
                        dataKey={`${chart.prefix}${drv}`}
                        stroke={trace.color}
                        strokeWidth={1.5}
                        dot={false}
                        name={`${chart.prefix}${drv}`}
                      />
                    ))}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          Select at least one driver and a lap to see telemetry
        </div>
      )}
    </div>
  );
}
