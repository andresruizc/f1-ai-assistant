"use client";

import { useState, Suspense, lazy } from "react";
import { motion, AnimatePresence } from "framer-motion";
import RaceSelector from "@/components/RaceSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { RaceMetadata } from "@/lib/types";

const OverviewTab = lazy(() => import("@/components/dashboard/OverviewTab"));
const StandingsStrategyTab = lazy(() => import("@/components/dashboard/StandingsStrategyTab"));
const TelemetryTab = lazy(() => import("@/components/dashboard/TelemetryTab"));
const ReplayTab = lazy(() => import("@/components/dashboard/ReplayTab"));

const TABS = [
  { id: "replay", label: "Race Replay", icon: "🏎️" },
  { id: "overview", label: "Overview", icon: "🏆" },
  { id: "standings", label: "Standings & Strategy", icon: "📊" },
  { id: "telemetry", label: "Telemetry", icon: "📈" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function TabFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">
      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mr-3" />
      Loading...
    </div>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [metadata, setMetadata] = useState<RaceMetadata | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleRaceLoaded = (meta: RaceMetadata, _driver: string) => {
    setMetadata(meta);
    setActiveTab("replay");
  };

  const isLoaded = metadata !== null;
  const isReplay = activeTab === "replay";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`shrink-0 border-r border-border bg-card/50 backdrop-blur flex flex-col transition-all duration-300 ${
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        <div className="w-64 flex flex-col h-full">
          {/* Logo */}
          <div className="p-4 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white font-black text-xs shrink-0">
              F1
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-xs truncate">AI Race Engineer</h1>
              <p className="text-[10px] text-muted-foreground">Dashboard</p>
            </div>
          </div>

          {/* Race selector */}
          <div className="p-3 border-b border-border">
            <RaceSelector onRaceLoaded={handleRaceLoaded} />
          </div>

          {/* Navigation */}
          {isLoaded && (
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <span className="text-sm">{tab.icon}</span>
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="tab-indicator"
                      className="w-1.5 h-1.5 rounded-full bg-primary ml-auto"
                    />
                  )}
                </button>
              ))}
            </nav>
          )}

          {/* Race info */}
          {metadata && (
            <div className="p-3 border-t border-border text-[10px] text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground text-xs">{metadata.event_name}</p>
              <p>{metadata.circuit}, {metadata.country}</p>
              <p>{metadata.year} — {metadata.total_laps} laps</p>
            </div>
          )}
        </div>
      </aside>

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen((p) => !p)}
        className="absolute top-3 left-2 z-50 w-7 h-7 rounded-md bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors shadow-sm"
        style={{ left: sidebarOpen ? "calc(16rem - 8px)" : "8px" }}
      >
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`text-muted-foreground transition-transform ${sidebarOpen ? "" : "rotate-180"}`}
        >
          <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="absolute top-2 right-3 z-50">
          <ThemeToggle />
        </div>

        {!isLoaded ? (
          <div className="flex items-center justify-center h-full">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-4"
            >
              <div className="text-6xl">🏁</div>
              <h2 className="text-2xl font-bold">Select a Race</h2>
              <p className="text-muted-foreground max-w-md">
                Choose a year and race from the sidebar to load the full dashboard
                with detailed analytics, strategy breakdowns, and race replay.
              </p>
            </motion.div>
          </div>
        ) : (
          <div className={isReplay ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={isReplay ? "mb-2" : "mb-6"}
            >
              <h2 className={`font-bold flex items-center gap-2 ${isReplay ? "text-base" : "text-2xl"}`}>
                {TABS.find((t) => t.id === activeTab)?.icon}
                {TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <p className="text-muted-foreground text-xs mt-0.5">
                {metadata.event_name} {metadata.year}
              </p>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: isReplay ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: isReplay ? 0 : -10 }}
                transition={{ duration: 0.15 }}
                className=""
              >
                <Suspense fallback={<TabFallback />}>
                  {activeTab === "replay" && <ReplayTab />}
                  {activeTab === "overview" && <OverviewTab />}
                  {activeTab === "standings" && <StandingsStrategyTab />}
                  {activeTab === "telemetry" && <TelemetryTab />}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
