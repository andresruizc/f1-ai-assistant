"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  dashboardApi,
  type ReplayData,
  type ReplayFrame,
  type ReplayDriver,
  type ReplayStanding,
  type WeatherEntry,
  type SectorData,
  type RcMessage,
} from "@/lib/dashboard-api";
import { tyreColor } from "@/lib/tyre-colors";

const SPEEDS = [
  { label: "0.5×", rate: 0.5 },
  { label: "1×", rate: 1 },
  { label: "2×", rate: 2 },
  { label: "5×", rate: 5 },
  { label: "10×", rate: 10 },
];

function fmt(secs: number): string {
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

function fmtSector(s: number | null): string {
  if (s == null) return "——.———";
  return s < 60 ? s.toFixed(3) : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
}

function getWeatherAt(weather: WeatherEntry[], elapsed: number): WeatherEntry | null {
  if (!weather.length) return null;
  let best = weather[0];
  for (const w of weather) {
    if (w.t <= elapsed) best = w;
    else break;
  }
  return best;
}

function getRecentRc(messages: RcMessage[], elapsed: number, count = 6): RcMessage[] {
  return messages.filter((m) => m.t <= elapsed).slice(-count);
}

function nearestTrackPointOnPolyline(
  x: number,
  y: number,
  trackX: number[],
  trackY: number[],
): { x: number; y: number; dist: number } {
  let bestX = trackX[0] ?? x;
  let bestY = trackY[0] ?? y;
  let bestD2 = Number.POSITIVE_INFINITY;
  const n = Math.min(trackX.length, trackY.length) - 1;
  for (let i = 0; i < n; i++) {
    const x1 = trackX[i];
    const y1 = trackY[i];
    const x2 = trackX[i + 1];
    const y2 = trackY[i + 1];
    const vx = x2 - x1;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2)) : 0;
    const px = x1 + vx * t;
    const py = y1 + vy * t;
    const dx = px - x;
    const dy = py - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = px;
      bestY = py;
    }
  }
  return { x: bestX, y: bestY, dist: Math.sqrt(bestD2) };
}

function lockPointToTrack(
  x: number,
  y: number,
  trackX: number[],
  trackY: number[],
  maxOffTrackDistance: number,
): [number, number] {
  if (trackX.length < 2 || trackY.length < 2) return [x, y];
  const nearest = nearestTrackPointOnPolyline(x, y, trackX, trackY);
  if (nearest.dist > maxOffTrackDistance) {
    return [nearest.x, nearest.y];
  }
  return [x, y];
}

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#22c55e", YELLOW: "#eab308", RED: "#ef4444",
  "DOUBLE YELLOW": "#f59e0b", BLUE: "#3b82f6", CLEAR: "#666",
  CHEQUERED: "#888",
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateDriver(a: ReplayDriver, b: ReplayDriver | undefined, t: number): ReplayDriver {
  if (!b) return a;
  return {
    ...a,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    speed: lerp(a.speed, b.speed, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
    gear: Math.round(lerp(a.gear, b.gear, t)),
    drs: Math.round(lerp(a.drs, b.drs, t)),
    rpm: Math.round(lerp(a.rpm, b.rpm, t)),
  };
}

function getRenderFrame(data: ReplayData, playhead: number): ReplayFrame | null {
  const maxFrame = data.total_frames - 1;
  if (maxFrame < 0) return null;
  const clamped = Math.max(0, Math.min(playhead, maxFrame));
  const baseIdx = Math.floor(clamped);
  const nextIdx = Math.min(maxFrame, baseIdx + 1);
  const t = clamped - baseIdx;
  const base = data.frames[String(baseIdx)];
  const next = data.frames[String(nextIdx)] ?? base;
  if (!base) return null;
  if (!next || t <= 0) return base;

  const nextMap = new Map(next.drivers.map((d) => [d.driver, d]));
  const drivers = base.drivers.map((d) => interpolateDriver(d, nextMap.get(d.driver), t));

  return {
    ...base,
    drivers,
    elapsed: lerp(base.elapsed, next.elapsed, t),
    lap: t < 0.5 ? base.lap : next.lap,
    status: t < 0.5 ? base.status : next.status,
    standings: t < 0.5 ? base.standings : next.standings,
  };
}

/* ── Monospace data cell ── */
function DataCell({ label, value, unit, color, large }: {
  label: string; value: string | number; unit?: string; color?: string; large?: boolean;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`font-mono font-bold leading-none mt-0.5 ${large ? "text-2xl" : "text-lg"}`} style={{ color: color ?? "#f1f5f9" }}>
        {value}
        {unit && <span className="text-[10px] text-slate-400 ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

/* ── Bar gauge (horizontal) ── */
function BarGauge({ label, value, max, color, suffix }: {
  label: string; value: number; max: number; color: string; suffix?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color }}>{Math.round(value)}{suffix}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-100" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/* ── Sector time cell ── */
function SectorCell({ label, value, isBest, isPb }: {
  label: string; value: number | null; isBest: boolean; isPb: boolean;
}) {
  const color = isBest ? "#a855f7" : isPb ? "#22c55e" : "#e2e8f0";
  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5 text-center flex-1">
      <p className="text-[8px] font-mono uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-sm font-mono font-bold mt-0.5" style={{ color }}>{fmtSector(value)}</p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ENGINEER TAB — Race engineer's cockpit view for a single driver
   ════════════════════════════════════════════════════════════════════ */
export default function EngineerTab({
  raceKey,
  isActive,
}: {
  raceKey: string;
  isActive: boolean;
}) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [selectedDriver, setSelectedDriver] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const [canvasSize, setCanvasSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlaying(false);
    setPlayhead(0);
    dashboardApi
      .replay(0.25)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const codes = Object.keys(d.drivers);
        if (codes.length > 0) setSelectedDriver(codes[0]);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [raceKey]);

  const frameIndex = data ? Math.floor(Math.max(0, Math.min(playhead, data.total_frames - 1))) : 0;
  const baseFrame: ReplayFrame | null = data?.frames[String(frameIndex)] ?? null;
  const renderFrame = data ? getRenderFrame(data, playhead) : null;
  const currentFrame = renderFrame ?? baseFrame;

  const driverData: ReplayDriver | null = currentFrame?.drivers.find((d) => d.driver === selectedDriver) ?? null;
  const standing: ReplayStanding | null = currentFrame?.standings.find((s) => s.d === selectedDriver) ?? null;
  const driverInfo = data?.drivers[selectedDriver];
  const sectorData: SectorData | null = (standing && data?.sectors[selectedDriver])
    ? (data.sectors[selectedDriver][standing.l] ?? data.sectors[selectedDriver][standing.l - 1] ?? null)
    : null;
  const weather = currentFrame ? getWeatherAt(data?.weather ?? [], currentFrame.elapsed) : null;
  const rcMessages = currentFrame ? getRecentRc(data?.rc_messages ?? [], currentFrame.elapsed) : [];

  // Rival: car directly ahead
  const rival: ReplayStanding | null = (() => {
    if (!standing || !currentFrame) return null;
    const ahead = currentFrame.standings.filter((s) => !s.retired && s.p < standing.p);
    return ahead.length > 0 ? ahead[ahead.length - 1] : null;
  })();

  // Lap sector history for the selected driver (last 5 laps)
  const lapHistory: { lap: number; s: SectorData }[] = (() => {
    if (!standing || !data?.sectors[selectedDriver]) return [];
    const drvSectors = data.sectors[selectedDriver];
    const entries: { lap: number; s: SectorData }[] = [];
    for (let l = Math.max(1, standing.l - 4); l <= standing.l; l++) {
      const s = drvSectors[l];
      if (s) entries.push({ lap: l, s });
    }
    return entries;
  })();

  /* ── Mini circuit drawing ── */
  const drawMiniCircuit = useCallback(
    (ctx: CanvasRenderingContext2D, rd: ReplayData, drivers: ReplayDriver[], selected: string) => {
      const dpr = window.devicePixelRatio || 1;
      const w = ctx.canvas.width / dpr, h = ctx.canvas.height / dpr;
      const [xMin, xMax] = rd.x_range;
      const [yMin, yMax] = rd.y_range;
      const scale = Math.min(w / (xMax - xMin), h / (yMax - yMin)) * 0.82;
      const cx = w / 2, cy = h / 2;
      const xM = (xMin + xMax) / 2, yM = (yMin + yMax) / 2;
      const toS = (x: number, y: number): [number, number] => [cx + (x - xM) * scale, cy - (y - yM) * scale];
      const minDim = Math.min(w, h);
      const lw = Math.max(6, minDim * 0.04);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#111318";
      ctx.fillRect(0, 0, w, h);

      const tx = rd.track_outline.x, ty = rd.track_outline.y;
      if (tx.length < 3) return;

      const trackPath = () => {
        ctx.beginPath();
        const [s0x, s0y] = toS(tx[0], ty[0]);
        ctx.moveTo(s0x, s0y);
        for (let i = 1; i < tx.length; i++) {
          const [px, py] = toS(tx[i], ty[i]);
          ctx.lineTo(px, py);
        }
      };

      trackPath();
      ctx.strokeStyle = "#2a3040";
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      trackPath();
      ctx.strokeStyle = "#1c2030";
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();

      const dotR = Math.max(2, minDim * 0.007);
      const selR = Math.max(4, minDim * 0.015);
      const glowR = selR * 3.5;
      const fontSize = Math.max(7, minDim * 0.022);

      // Other drivers as dim dots
      const worldTrackHalfWidth = 12 / Math.max(scale, 1e-6);
      for (const d of drivers) {
        if (d.driver === selected) continue;
        const [lx, ly] = lockPointToTrack(d.x, d.y, tx, ty, worldTrackHalfWidth);
        const [px, py] = toS(lx, ly);
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = d.color + "40";
        ctx.fill();
      }

      // Selected driver — bright pulsing dot
      const sel = drivers.find((d) => d.driver === selected);
      if (sel) {
        const [lx, ly] = lockPointToTrack(sel.x, sel.y, tx, ty, worldTrackHalfWidth);
        const [px, py] = toS(lx, ly);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        glow.addColorStop(0, sel.color + "90");
        glow.addColorStop(1, sel.color + "00");
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, selR, 0, Math.PI * 2);
        ctx.fillStyle = sel.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1, selR * 0.3);
        ctx.stroke();

        // Label
        ctx.font = `bold ${fontSize}px monospace`;
        const tw = ctx.measureText(sel.driver).width;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.beginPath();
        ctx.roundRect(px - tw / 2 - 4, py - selR - fontSize - 4, tw + 8, fontSize + 4, 3);
        ctx.fill();
        ctx.fillStyle = sel.color;
        ctx.textAlign = "center";
        ctx.fillText(sel.driver, px, py - selR - 5);
      }
    },
    [],
  );

  /* ── Canvas resize ── */
  const resizeCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const p = c.parentElement;
    if (!p) return;
    const dpr = window.devicePixelRatio || 1;
    const r = p.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    c.style.width = `${r.width}px`;
    c.style.height = `${r.height}px`;
    setCanvasSize(r.width + r.height);
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas, data]);

  useEffect(() => {
    if (!isActive) return;
    const raf = requestAnimationFrame(() => resizeCanvas());
    return () => cancelAnimationFrame(raf);
  }, [isActive, resizeCanvas]);

  /* ── Render current frame ── */
  useEffect(() => {
    if (!data || !currentFrame || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMiniCircuit(ctx, data, currentFrame.drivers, selectedDriver);
    ctx.restore();
  }, [playhead, data, currentFrame, drawMiniCircuit, selectedDriver, canvasSize]);

  /* ── Animation loop ── */
  useEffect(() => {
    if (!playing || !data) return;
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dtMs = ts - lastTsRef.current;
      lastTsRef.current = ts;
      const frameAdvance = (dtMs / (data.sample_interval * 1000)) * SPEEDS[speedIdx].rate;
      setPlayhead((prev) => {
        const next = prev + frameAdvance;
        if (next >= data.total_frames - 1) {
          setPlaying(false);
          return data.total_frames - 1;
        }
        return next;
      });
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      lastTsRef.current = null;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, data, speedIdx]);

  /* ── Loading / Error ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)] min-h-[560px] bg-[#111318] rounded-xl border border-slate-700/40">
        <div className="text-center space-y-3">
          <div className="animate-spin h-10 w-10 border-3 border-cyan-500 border-t-transparent rounded-full mx-auto" />
          <p className="font-mono text-cyan-400 text-sm">LOADING TELEMETRY FEED...</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="text-red-500 font-mono text-center p-8">TELEMETRY FEED OFFLINE</div>;

  const progress = data.total_frames > 1 ? (playhead / (data.total_frames - 1)) * 100 : 0;
  const driverCodes = Object.keys(data.drivers);

  const speedColor = driverData ? `hsl(${Math.min(350, driverData.speed) / 350 * 120}, 85%, 50%)` : "#666";
  const rpmPct = driverData ? Math.min(100, (driverData.rpm / 13000) * 100) : 0;
  const rpmColor = rpmPct > 85 ? "#ef4444" : rpmPct > 60 ? "#eab308" : "#22c55e";

  // Car behind
  const carBehind: ReplayStanding | null = (() => {
    if (!standing || !currentFrame) return null;
    const behind = currentFrame.standings.filter((s) => !s.retired && s.p > standing.p);
    return behind.length > 0 ? behind[0] : null;
  })();

  return (
    <div className="rounded-xl border border-slate-700/40 bg-[#111318] text-slate-200 overflow-hidden font-mono h-[calc(100vh-8rem)] min-h-[620px] flex flex-col">
      {/* ── Header: driver select + playback ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/40 bg-[#14171e]">
        {/* Driver selector */}
        <div className="flex items-center gap-2">
          {driverInfo?.headshot && (
            <img
              src={driverInfo.headshot}
              alt={selectedDriver}
              className="w-8 h-8 rounded-full object-cover"
              style={{ border: `2px solid ${driverInfo.color}` }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <select
            value={selectedDriver}
            onChange={(e) => setSelectedDriver(e.target.value)}
            className="bg-black/60 border border-slate-600/50 rounded px-2 py-1 text-xs font-mono font-bold text-cyan-400 focus:outline-none focus:border-cyan-500"
          >
            {driverCodes.map((code) => (
              <option key={code} value={code}>
                {code} — {data.drivers[code].team}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px h-6 bg-emerald-900/30" />

        {/* Playback controls */}
        <button
          onClick={() => setPlaying(!playing)}
          className="w-7 h-7 rounded bg-cyan-600 text-black flex items-center justify-center hover:bg-cyan-500 transition font-bold text-xs"
        >
          {playing ? "▮▮" : "▶"}
        </button>
        <button onClick={() => { setPlayhead(0); setPlaying(false); }} className="px-2 py-1 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-400 transition">
          RST
        </button>
        <div className="flex rounded overflow-hidden border border-slate-700/40">
          {SPEEDS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSpeedIdx(i)}
              className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${speedIdx === i ? "bg-cyan-600 text-black font-bold" : "bg-black/40 text-slate-400 hover:text-slate-300"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="flex-1 mx-2">
          <div
            className="relative h-1 rounded-full bg-slate-800 overflow-hidden cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPlayhead(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (data.total_frames - 1));
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-cyan-500 rounded-full transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Status */}
        {currentFrame && (
          <div className="flex items-center gap-2 text-[10px] shrink-0">
            <span className="text-cyan-400 font-bold">LAP {currentFrame.lap}/{data.total_laps}</span>
            <span className="text-slate-400">{fmt(currentFrame.elapsed)}</span>
          </div>
        )}
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-12 gap-0 flex-1 min-h-0">
        {/* Left: Mini circuit */}
        <div className="col-span-4 border-r border-slate-700/40 relative bg-[#111318]">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {/* Position badge */}
          {standing && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <div className="bg-black/80 border border-slate-600/50 rounded px-2 py-1">
                <span className="text-[9px] text-slate-400 font-mono">POS</span>
                <p className="text-2xl font-black font-mono leading-none" style={{ color: driverInfo?.color }}>
                  P{standing.p}
                </p>
              </div>
              {standing.inPit && (
                <div className="bg-yellow-500/20 border border-yellow-500/40 rounded px-2 py-1 animate-pulse">
                  <span className="text-yellow-400 font-mono font-bold text-sm">PIT</span>
                </div>
              )}
            </div>
          )}

          {/* Weather */}
          {weather && (
            <div className="absolute bottom-2 left-2 bg-black/70 border border-slate-700/40 rounded px-2 py-1 text-[9px] font-mono">
              <span className="text-slate-400">WX </span>
              <span className="text-slate-300">
                {weather.rainfall ? "RAIN" : "DRY"} {weather.airTemp}°/{weather.trackTemp}° H{weather.humidity}%
              </span>
            </div>
          )}
        </div>

        {/* Center: Telemetry */}
        <div className="col-span-5 border-r border-slate-700/40 flex flex-col overflow-hidden">
          {/* Driver header */}
          <div className="px-3 py-2 border-b border-slate-700/40 bg-black/30 flex items-center gap-3">
            <div className="w-1 h-8 rounded-full" style={{ backgroundColor: driverInfo?.color }} />
            <div>
              <p className="text-xs font-bold" style={{ color: driverInfo?.color }}>{selectedDriver}</p>
              <p className="text-[10px] text-slate-400">{driverInfo?.team}</p>
            </div>
            {standing && (
              <div className="ml-auto text-right">
                <p className="text-[10px] text-slate-400">GAP TO LEADER</p>
                <p className="text-sm font-bold font-mono text-slate-200">{standing.p === 1 ? "LEADER" : standing.gap || "—"}</p>
              </div>
            )}
          </div>

          {/* Live telemetry grid */}
          <div className="p-2.5 space-y-1.5 flex-1 overflow-y-auto">
            {/* Row 1: Speed + RPM + Gear */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="col-span-2">
                <DataCell label="Speed" value={driverData ? Math.round(driverData.speed) : 0} unit="km/h" color={speedColor} large />
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">RPM</p>
                <p className="text-xl font-black font-mono leading-none mt-0.5" style={{ color: rpmColor }}>{driverData ? Math.round(driverData.rpm).toLocaleString() : 0}</p>
                <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden mt-1">
                  <div className="h-full rounded-full transition-all duration-75" style={{ width: `${rpmPct}%`, background: `linear-gradient(90deg, #22c55e, ${rpmPct > 85 ? "#ef4444" : "#eab308"})` }} />
                </div>
              </div>
              <DataCell label="Gear" value={driverData?.gear ?? 0} color="#e2e8f0" large />
            </div>

            {/* Row 2: Throttle + Brake */}
            <div className="grid grid-cols-2 gap-1.5">
              <BarGauge label="Throttle" value={driverData?.throttle ?? 0} max={100} color="#22c55e" suffix="%" />
              <BarGauge label="Brake" value={driverData ? Math.min(100, driverData.brake * 100) : 0} max={100} color="#ef4444" suffix="%" />
            </div>

            {/* Row 3: DRS + Tyre + Stint */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">DRS</p>
                <p className={`text-base font-bold font-mono mt-0.5 ${driverData && driverData.drs >= 10 ? "text-green-400" : "text-slate-600"}`}>
                  {driverData && driverData.drs >= 10 ? "OPEN" : "CLOSED"}
                </p>
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Tyre</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-base font-bold font-mono px-1.5 rounded" style={{ backgroundColor: tyreColor(standing?.compound ?? "") + "30", color: tyreColor(standing?.compound ?? "") }}>
                    {standing?.compound?.charAt(0) ?? "?"}
                  </span>
                  <span className="text-xs font-bold font-mono text-slate-200">L{standing?.tyreLife ?? 0}</span>
                </div>
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Stint</p>
                <p className="text-base font-bold font-mono text-slate-200 mt-0.5">{sectorData?.stint ?? "—"}</p>
                <p className="text-[8px] text-slate-400">{sectorData?.freshTyre ? "NEW" : "USED"}</p>
              </div>
            </div>

            {/* Row 4: Sector times + Lap time */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Sectors — Lap {standing?.l ?? "—"}</p>
                {sectorData?.lapTime && (
                  <p className={`text-[11px] font-mono font-bold ${sectorData.pb ? "text-green-400" : "text-slate-300"}`}>
                    LAP {fmtSector(sectorData.lapTime)}
                  </p>
                )}
              </div>
              <div className="flex gap-1.5">
                <SectorCell label="S1" value={sectorData?.s1 ?? null} isBest={sectorData?.s1_best ?? false} isPb={sectorData?.pb ?? false} />
                <SectorCell label="S2" value={sectorData?.s2 ?? null} isBest={sectorData?.s2_best ?? false} isPb={sectorData?.pb ?? false} />
                <SectorCell label="S3" value={sectorData?.s3 ?? null} isBest={sectorData?.s3_best ?? false} isPb={sectorData?.pb ?? false} />
              </div>
            </div>

            {/* Row 5: Speed traps */}
            {sectorData && (sectorData.speedI1 || sectorData.speedI2 || sectorData.speedFL || sectorData.speedST) && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 mb-1">Speed Traps</p>
                <div className="grid grid-cols-4 gap-1.5">
                  <DataCell label="Trap I1" value={sectorData.speedI1 ?? "—"} unit="km/h" color="#60a5fa" />
                  <DataCell label="Trap I2" value={sectorData.speedI2 ?? "—"} unit="km/h" color="#60a5fa" />
                  <DataCell label="Fin Line" value={sectorData.speedFL ?? "—"} unit="km/h" color="#60a5fa" />
                  <DataCell label="Spd Trap" value={sectorData.speedST ?? "—"} unit="km/h" color="#f59e0b" />
                </div>
              </div>
            )}

            {/* Row 6: Gap battle — car ahead + car behind */}
            <div className="grid grid-cols-3 gap-1.5">
              {rival ? (
                <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Car Ahead</p>
                  <p className="text-sm font-bold font-mono" style={{ color: data.drivers[rival.d]?.color }}>{rival.d}</p>
                  <p className="text-[9px] text-slate-400">P{rival.p} · {rival.speed} km/h</p>
                </div>
              ) : (
                <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Car Ahead</p>
                  <p className="text-sm font-bold font-mono text-slate-600">LEADER</p>
                </div>
              )}
              <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5 text-center">
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Interval</p>
                <p className="text-lg font-black font-mono text-amber-400 leading-none mt-0.5">{standing?.interval || "—"}</p>
              </div>
              {carBehind ? (
                <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5 text-right">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Car Behind</p>
                  <p className="text-sm font-bold font-mono" style={{ color: data.drivers[carBehind.d]?.color }}>{carBehind.d}</p>
                  <p className="text-[9px] text-slate-400">{carBehind.speed} km/h · P{carBehind.p}</p>
                </div>
              ) : (
                <div className="bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1.5 text-right">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Car Behind</p>
                  <p className="text-sm font-bold font-mono text-slate-600">LAST</p>
                </div>
              )}
            </div>

            {/* Row 7: Lap history with lap time and speed traps */}
            {lapHistory.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 mb-1">Lap History</p>
                <div className="bg-slate-900/60 border border-slate-700/50 rounded overflow-hidden">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700/40">
                        <th className="px-1.5 py-1 text-left">LAP</th>
                        <th className="px-1.5 py-1 text-right">S1</th>
                        <th className="px-1.5 py-1 text-right">S2</th>
                        <th className="px-1.5 py-1 text-right">S3</th>
                        <th className="px-1.5 py-1 text-right">TIME</th>
                        <th className="px-1.5 py-1 text-right">ST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lapHistory.map(({ lap, s }) => (
                        <tr key={lap} className="border-b border-slate-700/30 last:border-b-0">
                          <td className="px-1.5 py-0.5 text-slate-400">{lap}</td>
                          <td className={`px-1.5 py-0.5 text-right ${s.s1_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s1)}</td>
                          <td className={`px-1.5 py-0.5 text-right ${s.s2_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s2)}</td>
                          <td className={`px-1.5 py-0.5 text-right ${s.s3_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s3)}</td>
                          <td className={`px-1.5 py-0.5 text-right ${s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.lapTime)}</td>
                          <td className="px-1.5 py-0.5 text-right text-blue-400">{s.speedST ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Standings + Race Control */}
        <div className="col-span-3 flex flex-col overflow-hidden">
          {/* Mini standings */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-2 py-1.5 border-b border-slate-700/40 bg-black/30">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Live Classification</p>
            </div>
            {currentFrame?.standings.filter((s) => !s.retired).map((s) => {
              const isMe = s.d === selectedDriver;
              const c = data.drivers[s.d]?.color ?? "#888";
              return (
                <div
                  key={s.d}
                  className={`flex items-center gap-1 px-2 py-[3px] border-b border-slate-700/20 text-[10px] font-mono cursor-pointer transition-colors ${
                    isMe ? "bg-cyan-900/20 border-l-2" : "hover:bg-white/3"
                  }`}
                  style={isMe ? { borderLeftColor: c } : undefined}
                  onClick={() => setSelectedDriver(s.d)}
                >
                  <span className="w-4 text-right text-slate-400 font-bold">{s.p}</span>
                  {data.drivers[s.d]?.headshot && (
                    <img
                      src={data.drivers[s.d].headshot}
                      alt={s.d}
                      className="w-4 h-4 rounded-full object-cover shrink-0"
                      style={{ border: `1px solid ${c}` }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <span className="font-bold w-8" style={{ color: c }}>{s.d}</span>
                  {s.inPit && <span className="text-[7px] text-yellow-400 font-bold animate-pulse">PIT</span>}
                  <span className="text-[8px] font-bold ml-auto" style={{ color: tyreColor(s.compound) }}>{s.compound?.charAt(0) ?? "?"}</span>
                  <span className="w-10 text-right text-slate-400">{s.p === 1 ? `L${s.l}` : s.interval || `L${s.l}`}</span>
                </div>
              );
            })}

            {/* Retired */}
            {currentFrame?.standings.some((s) => s.retired) && (
              <div className="px-2 py-1 border-t border-slate-700/30">
                <p className="text-[8px] text-red-500/70 font-mono mb-0.5">RETIRED</p>
                <div className="flex flex-wrap gap-1">
                  {currentFrame.standings.filter((s) => s.retired).map((s) => (
                    <span key={s.d} className="text-[8px] font-mono text-red-400/60">{s.d}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Race control feed */}
          <div className="border-t border-slate-700/40 bg-black/30">
            <div className="px-2 py-1 border-b border-slate-700/30">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Race Control</p>
            </div>
            <div className="max-h-32 overflow-y-auto">
              {rcMessages.length === 0 ? (
                <p className="text-[9px] text-slate-600 font-mono px-2 py-2">No messages</p>
              ) : (
                rcMessages.map((msg, i) => {
                  const flagC = FLAG_COLORS[msg.flag?.toUpperCase()] ?? "#555";
                  return (
                    <div key={`${msg.t}-${i}`} className="flex items-start gap-1.5 px-2 py-1 border-b border-slate-700/20 last:border-b-0">
                      <span className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: flagC }} />
                      <div className="min-w-0">
                        <p className="text-[9px] text-slate-300 font-mono leading-tight truncate">{msg.msg}</p>
                        <p className="text-[8px] text-slate-600 font-mono">{fmt(msg.t)} · L{msg.lap}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
