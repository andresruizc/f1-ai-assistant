"use client";

import { useEffect, useState } from "react";
import { getSchedule, loadRace } from "@/lib/api";
import type { Driver, RaceMetadata, RaceScheduleEntry } from "@/lib/types";

interface Props {
  onRaceLoaded: (metadata: RaceMetadata, selectedDriver: string) => void;
}

const YEARS = Array.from({ length: 8 }, (_, i) => 2025 - i); // 2025..2018

export default function RaceSelector({ onRaceLoaded }: Props) {
  const [year, setYear] = useState(2024);
  const [races, setRaces] = useState<RaceScheduleEntry[]>([]);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch schedule when year changes
  useEffect(() => {
    setRaces([]);
    setSelectedRound(null);
    setDrivers([]);
    setSelectedDriver("");
    getSchedule(year)
      .then((schedule) => {
        setRaces(schedule);
        if (schedule.length > 0) setSelectedRound(schedule[0].round);
      })
      .catch((e) => setError(e.message));
  }, [year]);

  const handleLoad = async () => {
    if (!selectedRound) return;
    setLoading(true);
    setError("");
    try {
      const metadata = await loadRace(year, selectedRound);
      setDrivers(metadata.drivers);
      if (metadata.drivers.length > 0) {
        setSelectedDriver(metadata.drivers[0].code);
        onRaceLoaded(metadata, metadata.drivers[0].code);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDriverChange = (code: string) => {
    setSelectedDriver(code);
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">Race Selection</h2>

      {/* Year */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Year</label>
        <select
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Race */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Race</label>
        <select
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={selectedRound ?? ""}
          onChange={(e) => setSelectedRound(Number(e.target.value))}
          disabled={races.length === 0}
        >
          {races.map((r) => (
            <option key={r.round} value={r.round}>
              {r.name} — {r.country}
            </option>
          ))}
        </select>
      </div>

      {/* Load button */}
      <button
        onClick={handleLoad}
        disabled={loading || !selectedRound}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Loading race data..." : "Load Race"}
      </button>

      {/* Driver selector (shown after load) */}
      {drivers.length > 0 && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Your Driver
          </label>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={selectedDriver}
            onChange={(e) => handleDriverChange(e.target.value)}
          >
            {drivers.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.name} ({d.team})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
