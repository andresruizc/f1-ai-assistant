"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getStandings, getTrackStatus } from "@/lib/api";
import type { Driver, RaceMetadata, StandingsEntry, TrackStatus } from "@/lib/types";

import RaceSelector from "@/components/RaceSelector";
import LapControls from "@/components/LapControls";
import StandingsTable from "@/components/StandingsTable";
import PositionChart from "@/components/PositionChart";
import ChatInterface from "@/components/ChatInterface";
import TrackStatusBadge from "@/components/TrackStatusBadge";
import WeatherInfo from "@/components/WeatherInfo";

export default function Home() {
  // Race state
  const [metadata, setMetadata] = useState<RaceMetadata | null>(null);
  const [selectedDriver, setSelectedDriver] = useState("");
  const [currentLap, setCurrentLap] = useState(1);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [trackStatus, setTrackStatus] = useState<TrackStatus | null>(null);

  const isLoaded = metadata !== null;

  // Fetch standings and track status when lap changes
  useEffect(() => {
    if (!isLoaded) return;

    getStandings(currentLap)
      .then(setStandings)
      .catch(console.error);

    getTrackStatus(currentLap)
      .then(setTrackStatus)
      .catch(console.error);
  }, [currentLap, isLoaded]);

  const handleRaceLoaded = (meta: RaceMetadata, driver: string) => {
    setMetadata(meta);
    setSelectedDriver(driver);
    setCurrentLap(1);
  };

  const handleLapChange = (lap: number) => {
    setCurrentLap(lap);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-border bg-card p-4 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏎️</span>
          <h1 className="text-lg font-bold">AI Race Engineer</h1>
        </div>

        <Link
          href="/dashboard"
          className="block w-full rounded-md bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-medium text-white text-center hover:brightness-110 transition"
        >
          📊 Full Dashboard
        </Link>

        <RaceSelector onRaceLoaded={handleRaceLoaded} />

        {isLoaded && (
          <>
            <hr className="border-border" />

            <LapControls
              currentLap={currentLap}
              totalLaps={metadata.total_laps}
              onLapChange={handleLapChange}
            />

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Track:</span>
                <TrackStatusBadge
                  status={trackStatus?.status ?? "Green"}
                />
              </div>
              <WeatherInfo weather={trackStatus?.weather ?? null} />
            </div>

            {metadata && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium">
                  {metadata.event_name} {metadata.year}
                </p>
                <p>
                  {metadata.circuit}, {metadata.country}
                </p>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Standings + Chart */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          <StandingsTable
            standings={standings}
            selectedDriver={selectedDriver}
            currentLap={currentLap}
            totalLaps={metadata?.total_laps ?? 0}
          />

          {isLoaded && (
            <PositionChart
              currentLap={currentLap}
              drivers={metadata.drivers}
              selectedDriver={selectedDriver}
            />
          )}
        </div>

        {/* Bottom: Chat */}
        <div className="h-[350px] shrink-0 border-t border-border p-4">
          <ChatInterface
            driverCode={selectedDriver}
            currentLap={currentLap}
            isRaceLoaded={isLoaded}
          />
        </div>
      </main>
    </div>
  );
}
