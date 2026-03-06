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

function parseGapSeconds(gap?: string | null): number | null {
  if (!gap) return null;
  const m = gap.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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
  const [showLappedMarkers, setShowLappedMarkers] = useState(false);
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
      .replay(0.1)
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
    (
      ctx: CanvasRenderingContext2D,
      rd: ReplayData,
      drivers: ReplayDriver[],
      standings: ReplayStanding[],
      selected: string,
      showLapped: boolean,
    ) => {
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
      const retiredSet = new Set(standings.filter((s) => s.retired).map((s) => s.d));
      const activeStandings = standings.filter((s) => !s.retired);
      const leaderLap =
        activeStandings.find((s) => s.p === 1)?.l ??
        (activeStandings.length ? Math.max(...activeStandings.map((s) => s.l)) : 0);
      const standingMap = new Map(standings.map((s) => [s.d, s]));

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
        if (d.driver === selected || retiredSet.has(d.driver)) continue;
        const st = standingMap.get(d.driver);
        const isLapped = st ? (leaderLap - st.l >= 1) : false;
        const [lx, ly] = lockPointToTrack(d.x, d.y, tx, ty, worldTrackHalfWidth);
        const [px, py] = toS(lx, ly);
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = d.color + "40";
        ctx.fill();
        if (showLapped && isLapped) {
          ctx.beginPath();
          ctx.arc(px, py, dotR + 3.2, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(59,130,246,0.95)";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Selected driver — bright pulsing dot
      const sel = retiredSet.has(selected) ? undefined : drivers.find((d) => d.driver === selected);
      if (sel) {
        const selStanding = standingMap.get(selected);
        const selectedLapped = selStanding ? (leaderLap - selStanding.l >= 1) : false;
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
        if (showLapped && selectedLapped) {
          ctx.beginPath();
          ctx.arc(px, py, selR + 4.2, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(59,130,246,0.95)";
          ctx.lineWidth = 2.1;
          ctx.stroke();
        }

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
    drawMiniCircuit(ctx, data, currentFrame.drivers, currentFrame.standings, selectedDriver, showLappedMarkers);
    ctx.restore();
  }, [playhead, data, currentFrame, drawMiniCircuit, selectedDriver, showLappedMarkers, canvasSize]);

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

  const liveBattleTrend = (() => {
    if (!data || !standing || !currentFrame) return { aheadTrend10s: 0, behindTrend10s: 0 };
    const windowFrames = Math.max(6, Math.round(10 / Math.max(0.1, data.sample_interval)));
    const startIdx = Math.max(0, frameIndex - windowFrames);
    const startFrame = data.frames[String(startIdx)];
    const dtSec = Math.max(1, currentFrame.elapsed - (startFrame?.elapsed ?? (currentFrame.elapsed - 10)));

    const aheadNow = parseGapSeconds(standing.interval);
    const aheadThen = parseGapSeconds(startFrame?.standings.find((s) => s.d === selectedDriver)?.interval ?? null);

    const behindNow = parseGapSeconds(carBehind?.interval ?? null);
    const behindThen = carBehind
      ? parseGapSeconds(startFrame?.standings.find((s) => s.d === carBehind.d)?.interval ?? null)
      : null;

    const aheadTrend10s = aheadNow != null && aheadThen != null ? ((aheadThen - aheadNow) / dtSec) * 10 : 0;
    const behindTrend10s = behindNow != null && behindThen != null ? ((behindThen - behindNow) / dtSec) * 10 : 0;
    return { aheadTrend10s, behindTrend10s };
  })();

  const battleIntel = (() => {
    const aheadGapSec = parseGapSeconds(standing?.interval ?? null);
    const behindGapSec = parseGapSeconds(carBehind?.interval ?? null);
    const trend = liveBattleTrend.aheadTrend10s;
    const drsBoost = driverData && driverData.drs >= 10 ? 0.12 : 0;
    const speedDeltaAhead = rival && driverData ? driverData.speed - rival.speed : 0;
    const speedDeltaBehind = carBehind && driverData ? carBehind.speed - driverData.speed : 0;
    const trendBoost = trend * 0.22;
    const behindTrendBoost = liveBattleTrend.behindTrend10s * 0.16;

    const attackProb = rival && aheadGapSec != null
      ? clamp01((1 - aheadGapSec / 1.2) + speedDeltaAhead / 45 + drsBoost + trendBoost)
      : null;
    const defendRisk = carBehind && behindGapSec != null
      ? clamp01((1 - behindGapSec / 1.25) + speedDeltaBehind / 45 + behindTrendBoost + (carBehind.speed > (driverData?.speed ?? 0) ? 0.06 : 0))
      : null;

    return {
      aheadGapSec,
      behindGapSec,
      trendLabel: trend > 0.12 ? "closing" : trend < -0.12 ? "dropping" : "flat",
      trendPer10s: trend,
      speedDeltaAhead,
      speedDeltaBehind,
      attackProb,
      defendRisk,
    };
  })();

  const strategyIntel = (() => {
    if (!standing || !currentFrame) return null;
    const activeCount = currentFrame.standings.filter((s) => !s.retired).length;
    const pitLossSec = currentFrame.status === "Safety Car" ? 14 : currentFrame.status === "VSC" ? 16 : 22;
    const tyreAge = standing.tyreLife ?? 0;
    const projectedTyreLife = Math.max(4, Math.round((sectorData?.freshTyre ? 22 : 18) - tyreAge * 0.55));
    const lapRatio = data.total_laps > 0 ? standing.l / data.total_laps : 0;
    const pitWindowOpen = lapRatio >= 0.35 && lapRatio <= 0.82 && tyreAge >= 10;

    const peerIntervals = currentFrame.standings
      .filter((s) => !s.retired && Math.abs(s.p - standing.p) <= 4)
      .map((s) => parseGapSeconds(s.interval))
      .filter((v): v is number => v != null && v > 0.2);
    const avgInterval = peerIntervals.length
      ? peerIntervals.reduce((a, b) => a + b, 0) / peerIntervals.length
      : 1.4;
    const rejoinShift = Math.max(1, Math.round(pitLossSec / Math.max(0.7, avgInterval)));
    const rejoinPos = Math.min(activeCount, standing.p + rejoinShift);

    const baseUndercut = (tyreAge - 11) * 0.12 + (currentFrame.status === "Green" ? 0.25 : 0.1);
    const undercutDelta = Number(Math.max(-0.4, Math.min(2.8, baseUndercut)).toFixed(1));
    const overcutDelta = Number((-undercutDelta * 0.65).toFixed(1));

    return { pitLossSec, projectedTyreLife, pitWindowOpen, rejoinPos, undercutDelta, overcutDelta };
  })();

  const tyrePhaseIntel = (() => {
    if (!standing) return null;
    const tyreAge = standing.tyreLife ?? 0;
    const lapTimes = lapHistory
      .map((e) => e.s.lapTime)
      .filter((v): v is number => typeof v === "number");
    const early = lapTimes.slice(0, Math.max(1, Math.floor(lapTimes.length / 2)));
    const late = lapTimes.slice(Math.max(0, Math.floor(lapTimes.length / 2)));
    const earlyMean = early.length ? early.reduce((a, b) => a + b, 0) / early.length : null;
    const lateMean = late.length ? late.reduce((a, b) => a + b, 0) / late.length : null;
    const paceDrop = earlyMean != null && lateMean != null ? lateMean - earlyMean : 0;

    let phase = "PRIME";
    if (tyreAge <= 3) phase = "WARMUP";
    else if (paceDrop > 0.9 || tyreAge >= 22) phase = "CLIFF";
    else if (paceDrop > 0.4 || tyreAge >= 15) phase = "DROP-OFF";

    const cliffEtaLaps = phase === "CLIFF" ? 0 : Math.max(1, Math.round(2.8 - paceDrop * 2 + Math.max(0, 18 - tyreAge) * 0.08));
    return { phase, paceDrop, cliffEtaLaps };
  })();

  const trafficIntel = (() => {
    if (!standing || !driverData) return null;
    const gapAhead = parseGapSeconds(standing.interval);
    const rivalSpeed = rival?.speed ?? null;
    const speedDelta = rivalSpeed != null ? rivalSpeed - driverData.speed : 0;
    const drsClosedPenalty = driverData.drs >= 10 ? 0 : 0.08;
    const proximity = gapAhead == null ? 0.22 : clamp01((1.7 - gapAhead) / 1.7);
    const speedPenalty = rivalSpeed == null ? 0.16 : clamp01((speedDelta + 10) / 40);
    const score = clamp01(proximity * 0.58 + speedPenalty * 0.34 + drsClosedPenalty);
    const lossSecPerLap = Number((score * 0.95).toFixed(2));
    return { score, lossSecPerLap, gapAhead };
  })();

  const pitCommit = (() => {
    if (!strategyIntel || !standing) return null;
    const tyreAge = standing.tyreLife ?? 0;
    const defendRisk = battleIntel.defendRisk ?? 0;
    const traffic = trafficIntel?.score ?? 0;
    const wearFactor = clamp01((tyreAge - 8) / 12);
    const windowFactor = strategyIntel.pitWindowOpen ? 1 : 0.25;
    const undercutFactor = clamp01(strategyIntel.undercutDelta / 2.5);
    const score = Math.round(clamp01(wearFactor * 0.3 + windowFactor * 0.26 + defendRisk * 0.2 + traffic * 0.14 + undercutFactor * 0.1) * 100);
    const call = score >= 62 ? "BOX" : score <= 40 ? "HOLD" : "WATCH";
    const confidence = score >= 75 || score <= 28 ? "HIGH" : score >= 58 || score <= 40 ? "MED" : "LOW";
    return { score, call, confidence };
  })();

  const tyreInsights = (() => {
    if (!standing) return null;
    const tyreAge = standing.tyreLife ?? 0;
    const compound = standing.compound ?? "?";
    const stint = sectorData?.stint ?? "—";
    const lapTimes = lapHistory
      .map((e) => e.s.lapTime)
      .filter((v): v is number => typeof v === "number");
    const wearRateSecPerLap = lapTimes.length >= 2
      ? Number(((lapTimes[lapTimes.length - 1] - lapTimes[0]) / Math.max(1, lapTimes.length - 1)).toFixed(2))
      : 0;
    const phase = tyrePhaseIntel?.phase ?? "PRIME";
    const cliffRiskScore = Math.round(clamp01((tyrePhaseIntel?.paceDrop ?? 0) * 0.85 + (phase === "CLIFF" ? 0.45 : 0) + Math.max(0, tyreAge - 14) * 0.02) * 100);
    const cliffRisk = cliffRiskScore >= 70 ? "HIGH" : cliffRiskScore >= 45 ? "MED" : "LOW";
    const lapsToWindow = strategyIntel?.pitWindowOpen
      ? 0
      : Math.max(1, Math.round(Math.max(0, 10 - tyreAge)));
    const action = phase === "CLIFF"
      ? "Box now or accept heavy pace loss"
      : cliffRisk === "HIGH"
        ? "Protect tyres, avoid wheelspin, prep pit"
        : strategyIntel?.pitWindowOpen
          ? "Window open: push if undercut target"
          : `Manage now, re-check in ~${lapsToWindow} lap(s)`;
    const lapsLeft = Math.max(0, data.total_laps - (standing.l ?? 0));
    const nextCompoundHint = weather?.rainfall
      ? "INTERMEDIATE"
      : lapsLeft <= 12
        ? "SOFT"
        : lapsLeft <= 24
          ? "MEDIUM"
          : "HARD";

    return {
      compound,
      tyreAge,
      stint,
      phase,
      wearRateSecPerLap,
      cliffRisk,
      cliffRiskScore,
      lapsToWindow,
      action,
      nextCompoundHint,
      freshTyre: sectorData?.freshTyre ?? null,
    };
  })();

  const decisionIntel = (() => {
    const lastLapTimes = lapHistory
      .map((e) => e.s.lapTime)
      .filter((v): v is number => typeof v === "number");
    const recent = lastLapTimes.slice(-3);
    const prev = lastLapTimes.slice(0, Math.max(0, lastLapTimes.length - 3));
    const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
    const trendSec = recentAvg != null && prevAvg != null ? recentAvg - prevAvg : 0;
    const defendRisk = battleIntel.defendRisk ?? 0;
    const attackProb = battleIntel.attackProb ?? 0;
    const paceMode = trendSec > 0.25 ? "MANAGE" : trendSec < -0.15 ? "PUSH" : "BALANCED";
    const action = defendRisk > 0.62 ? "DEFEND" : attackProb > 0.58 ? "ATTACK" : paceMode === "MANAGE" ? "SAVE TYRES" : "HOLD PACE";
    const targetGap = battleIntel.aheadGapSec != null
      ? `${battleIntel.aheadGapSec.toFixed(1)}s to ${rival?.d ?? "ahead"}`
      : battleIntel.behindGapSec != null
        ? `${battleIntel.behindGapSec.toFixed(1)}s to ${carBehind?.d ?? "behind"}`
        : "No immediate gap target";
    const riskScore = Math.round(clamp01(Math.max(defendRisk, (tyrePhaseIntel?.phase === "CLIFF" ? 0.85 : 0), weather?.rainfall ? 0.72 : 0, trafficIntel?.score ?? 0)) * 100);
    const riskLevel = riskScore >= 70 ? "HIGH" : riskScore >= 45 ? "MED" : "LOW";
    const confidence = riskScore >= 70 || riskScore <= 25 ? "HIGH" : riskScore >= 50 ? "MED" : "LOW";
    const why = defendRisk > 0.62
      ? `${carBehind?.d ?? "Behind"} closing (${Math.max(0, liveBattleTrend.behindTrend10s).toFixed(2)}s/10s)`
      : attackProb > 0.58
        ? `Gap to ${rival?.d ?? "ahead"} improving (${Math.max(0, battleIntel.trendPer10s).toFixed(2)}s/10s)`
        : tyrePhaseIntel?.phase === "CLIFF"
          ? "Tyre phase at cliff threshold"
          : weather?.rainfall
            ? "Track has rain impact"
            : "Stable race window";
    return { paceMode, action, targetGap, riskScore, riskLevel, confidence, why };
  })();

  const latestRc = rcMessages.length ? rcMessages[rcMessages.length - 1] : null;
  const latestRcSummary = latestRc
    ? `${latestRc.msg.length > 68 ? `${latestRc.msg.slice(0, 68)}...` : latestRc.msg} (${fmt(latestRc.t)})`
    : "No recent messages";
  const calcTickMs = Math.round(Math.max(100, data.sample_interval * 1000));
  const activeStandings = currentFrame?.standings.filter((s) => !s.retired) ?? [];
  const myGapAhead = standing?.interval ?? "—";
  const myGapBehind = carBehind?.interval ?? "—";
  const tyreDist = activeStandings.reduce<Record<string, number>>((acc, s) => {
    const c = s.compound?.charAt(0) ?? "?";
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const trackRcIntel = (() => {
    const rcPriority = latestRc?.msg?.toUpperCase().includes("INVESTIGATED") || latestRc?.msg?.toUpperCase().includes("PENALTY")
      ? "HIGH"
      : latestRc
        ? "MED"
        : "LOW";
    return {
      status: currentFrame?.status ?? "Green",
      rain: weather?.rainfall ? "RAIN" : "DRY",
      rcPriority,
      rcShort: latestRcSummary,
    };
  })();
  const engineerNotes = [
    `Call ${decisionIntel.action} · ${decisionIntel.paceMode}`,
    strategyIntel
      ? `Pit ${strategyIntel.pitWindowOpen ? "OPEN" : "WAIT"} · rejoin ~P${strategyIntel.rejoinPos}`
      : "Pit context unavailable",
    tyreInsights
      ? `Tyre ${tyreInsights.phase} · wear ${tyreInsights.wearRateSecPerLap >= 0 ? "+" : ""}${tyreInsights.wearRateSecPerLap.toFixed(2)}s/lap`
      : "Tyre trend unavailable",
  ];
  const pitMatrix = (() => {
    if (!strategyIntel || !standing) return null;
    const traffic = trafficIntel?.score ?? 0.2;
    const wear = clamp01(((standing.tyreLife ?? 0) - 10) / 12);
    const nowDelta = Number((strategyIntel.undercutDelta - traffic * 0.35 - (strategyIntel.pitWindowOpen ? 0 : 0.5)).toFixed(1));
    const plusDelta = Number((strategyIntel.undercutDelta - wear * 0.35 + 0.15 - traffic * 0.22).toFixed(1));
    const nowRejoin = strategyIntel.rejoinPos;
    const plusRejoin = Math.min(nowRejoin + 1, currentFrame?.standings.filter((s) => !s.retired).length ?? nowRejoin + 1);
    const riskNow = Math.round(clamp01((traffic * 0.65 + (pitCommit?.score ?? 45) / 100 * 0.35)) * 100);
    const riskPlus = Math.round(clamp01((Math.max(0, traffic - 0.12) * 0.6 + wear * 0.4)) * 100);
    return { nowDelta, plusDelta, nowRejoin, plusRejoin, riskNow, riskPlus };
  })();
  const paceConsistencyIntel = (() => {
    const laps = lapHistory
      .map((e) => e.s.lapTime)
      .filter((v): v is number => typeof v === "number");
    if (laps.length < 2) return null;
    const mean = laps.reduce((a, b) => a + b, 0) / laps.length;
    const variance = laps.reduce((a, b) => a + (b - mean) ** 2, 0) / laps.length;
    const std = Math.sqrt(variance);
    const recent = laps.slice(-2);
    const prev = laps.slice(0, Math.max(0, laps.length - 2));
    const recentAvg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : recentAvg;
    const trend = recentAvg - prevAvg;
    const label = std < 0.25 ? "STABLE" : std < 0.55 ? "VARIABLE" : "NOISY";
    const hint = trend > 0.25 ? "Manage tyres, pace dropping" : trend < -0.2 ? "Push window available" : "Hold current pace";
    return { mean, std, trend, label, hint, best: Math.min(...laps), worst: Math.max(...laps) };
  })();

  const sectorFocusIntel = (() => {
    const rows = lapHistory.map((e) => e.s);
    const s1 = rows.map((r) => r.s1).filter((v): v is number => typeof v === "number");
    const s2 = rows.map((r) => r.s2).filter((v): v is number => typeof v === "number");
    const s3 = rows.map((r) => r.s3).filter((v): v is number => typeof v === "number");
    if (!s1.length || !s2.length || !s3.length) return null;
    const avg = {
      S1: s1.reduce((a, b) => a + b, 0) / s1.length,
      S2: s2.reduce((a, b) => a + b, 0) / s2.length,
      S3: s3.reduce((a, b) => a + b, 0) / s3.length,
    } as const;
    const entries = Object.entries(avg) as Array<[keyof typeof avg, number]>;
    entries.sort((a, b) => a[1] - b[1]); // lower is better
    const strongest = entries[0];
    const weakest = entries[entries.length - 1];
    const gap = weakest[1] - strongest[1];
    const focusHint = gap > 0.45 ? `Focus ${weakest[0]} execution` : "Sector balance is healthy";
    return { strongest, weakest, gap, focusHint };
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
        <button
          onClick={() => setShowLappedMarkers((v) => !v)}
          className={`px-2 py-1 rounded text-[10px] font-mono border transition ${
            showLappedMarkers
              ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
              : "border-slate-700/50 bg-slate-900/40 text-slate-400 hover:text-slate-300"
          }`}
          title="Toggle blue circles for lapped cars"
        >
          LAPD {showLappedMarkers ? "ON" : "OFF"}
        </button>

        {/* Progress */}
        <div className="flex-1 mx-2 min-w-[220px]">
          <div
            className="relative h-2 rounded-full bg-slate-800 overflow-hidden cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setPlayhead(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (data.total_frames - 1));
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-cyan-500 rounded-full transition-[width]" style={{ width: `${progress}%` }} />
            <div
              className="absolute top-1/2 w-3 h-3 rounded-full border border-cyan-200 bg-cyan-400 shadow -translate-y-1/2"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[8px] text-slate-500">
            <span>START</span>
            <span>{currentFrame ? `L${currentFrame.lap} · ${fmt(currentFrame.elapsed)}` : "—"}</span>
            <span>FINISH</span>
          </div>
        </div>

      </div>

      {/* Decision bar: engineer call for next 1-2 laps */}
      <div className="px-3 py-1.5 border-b border-slate-700/40 bg-black/25 text-[10px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300 font-bold">PACE {decisionIntel.paceMode}</span>
          <span className="px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 font-bold">CALL {decisionIntel.action}</span>
          <span className="px-1.5 py-0.5 rounded border border-slate-600/60 text-slate-300">NEXT: {decisionIntel.targetGap}</span>
          <span className="px-1.5 py-0.5 rounded border border-slate-600/60 text-slate-400">WHY: {decisionIntel.why}</span>
          {pitCommit && (
            <span className={`px-1.5 py-0.5 rounded border font-bold ${pitCommit.call === "BOX" ? "border-green-500/45 text-green-300" : pitCommit.call === "HOLD" ? "border-slate-600/60 text-slate-300" : "border-yellow-500/45 text-yellow-300"}`}>
              PIT {pitCommit.call} · {pitCommit.score}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded border border-slate-600/60 text-slate-400">LIVE {calcTickMs}ms</span>
          <span className={`ml-auto px-1.5 py-0.5 rounded border font-bold ${decisionIntel.riskLevel === "HIGH" ? "border-red-500/45 text-red-300" : decisionIntel.riskLevel === "MED" ? "border-orange-500/45 text-orange-300" : "border-emerald-500/45 text-emerald-300"}`}>
            RISK {decisionIntel.riskLevel} ({decisionIntel.riskScore}) · CONF {decisionIntel.confidence}
          </span>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-12 gap-0 flex-1 min-h-0">
        {/* Left: Mini circuit */}
        <div className="col-span-4 border-r border-slate-700/40 bg-[#111318] flex flex-col min-h-0">
          <div className="relative flex-[1.1] min-h-0">
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

            {/* Bottom telemetry ribbon over track canvas */}
            <div className="absolute bottom-2 left-2 right-2 rounded border border-slate-700/40 bg-black/35 backdrop-blur-[1px] px-2 py-1">
              <div className="flex items-center gap-1.5 text-[8px]">
                <span className="text-slate-500 uppercase tracking-widest shrink-0">Car Telemetry</span>
                <span
                  className="px-1.5 py-0.5 rounded bg-slate-900/65 border border-slate-700/40 font-bold"
                  style={{ color: speedColor }}
                >
                  Speed {driverData ? Math.round(driverData.speed) : 0}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded bg-slate-900/65 border border-slate-700/40 font-bold"
                  style={{ color: rpmColor }}
                >
                  RPM {driverData ? Math.round(driverData.rpm / 1000) : 0}k
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900/65 border border-slate-700/40 text-slate-300">G {driverData?.gear ?? 0}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900/65 border border-slate-700/40 text-green-300">Thr {Math.round(driverData?.throttle ?? 0)}%</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-900/65 border border-slate-700/40 text-red-300">Brk {Math.round(driverData ? driverData.brake * 100 : 0)}%</span>
                <span className={`px-1.5 py-0.5 rounded border ${driverData && driverData.drs >= 10 ? "bg-green-500/15 border-green-500/35 text-green-300" : "bg-slate-900/65 border-slate-700/40 text-slate-400"}`}>
                  DRS {driverData && driverData.drs >= 10 ? "OPEN" : "CLOSED"}
                </span>
              </div>
            </div>
          </div>

          {/* Live classification moved under mini-circuit */}
          <div className="h-[34%] min-h-[180px] overflow-y-auto border-t border-slate-700/35">
            <div className="px-2 py-1.5 border-b border-slate-700/40 bg-black/30">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Live Classification</p>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[8px]">
                <span className="px-1 py-0.5 rounded border border-cyan-500/35 text-cyan-300">ME P{standing?.p ?? "—"}</span>
                <span className="px-1 py-0.5 rounded border border-slate-700/45 text-slate-300">AHEAD {myGapAhead}</span>
                <span className="px-1 py-0.5 rounded border border-slate-700/45 text-slate-300">BEH {myGapBehind}</span>
                <span className="px-1 py-0.5 rounded border border-slate-700/45 text-slate-400">H:{tyreDist.H ?? 0} M:{tyreDist.M ?? 0} S:{tyreDist.S ?? 0}</span>
              </div>
            </div>
            {activeStandings.map((s) => {
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
        </div>

        {/* Center: Telemetry */}
        <div className="col-span-3 border-r border-slate-700/40 flex flex-col overflow-hidden">
          {/* Compact strategy context (telemetry essentials moved to bottom strip) */}
          <div className="p-2 space-y-1.5 flex-1 overflow-y-auto">
            <div className="rounded border border-slate-700/50 bg-slate-900/45 p-2 text-[9px] space-y-1">
              <p className="text-[8px] uppercase tracking-widest text-slate-400">Strategy Context</p>
              <div className="grid grid-cols-2 gap-1">
                <div className="rounded bg-black/25 border border-slate-700/40 px-1.5 py-1">
                  <p className="text-[7px] text-slate-500">Gap Leader</p>
                  <p className="text-[11px] font-bold text-slate-200">{standing?.p === 1 ? "Leader" : standing?.gap || "—"}</p>
                </div>
                <div className="rounded bg-black/25 border border-slate-700/40 px-1.5 py-1">
                  <p className="text-[7px] text-slate-500">Pit Window</p>
                  <p className={`text-[11px] font-bold ${strategyIntel?.pitWindowOpen ? "text-green-300" : "text-slate-300"}`}>{strategyIntel?.pitWindowOpen ? "OPEN" : "WAIT"}</p>
                </div>
                <div className="rounded bg-black/25 border border-slate-700/40 px-1.5 py-1">
                  <p className="text-[7px] text-slate-500">Tyre</p>
                  <p className="text-[11px] font-bold text-slate-200">{standing?.compound?.charAt(0) ?? "?"} · L{standing?.tyreLife ?? 0}</p>
                </div>
                <div className="rounded bg-black/25 border border-slate-700/40 px-1.5 py-1">
                  <p className="text-[7px] text-slate-500">Phase</p>
                  <p className={`text-[11px] font-bold ${tyrePhaseIntel?.phase === "CLIFF" ? "text-red-300" : tyrePhaseIntel?.phase === "DROP-OFF" ? "text-orange-300" : "text-slate-200"}`}>{tyrePhaseIntel?.phase ?? "PRIME"}</p>
                </div>
              </div>
            </div>

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

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-mono uppercase tracking-widest text-slate-400">Sectors · Lap {standing?.l ?? "—"}</p>
                {sectorData?.lapTime && <p className="text-[10px] font-bold text-slate-300">{fmtSector(sectorData.lapTime)}</p>}
              </div>
              <div className="flex gap-1">
                <SectorCell label="S1" value={sectorData?.s1 ?? null} isBest={sectorData?.s1_best ?? false} isPb={sectorData?.pb ?? false} />
                <SectorCell label="S2" value={sectorData?.s2 ?? null} isBest={sectorData?.s2_best ?? false} isPb={sectorData?.pb ?? false} />
                <SectorCell label="S3" value={sectorData?.s3 ?? null} isBest={sectorData?.s3_best ?? false} isPb={sectorData?.pb ?? false} />
              </div>
            </div>

            {/* Last 5 laps sector times (restored) */}
            {lapHistory.length > 0 && (
              <div className="rounded border border-slate-700/40 bg-slate-900/35 overflow-hidden">
                <div className="px-1.5 py-1 border-b border-slate-700/35 flex items-center justify-between">
                  <p className="text-[8px] font-mono uppercase tracking-widest text-slate-400">Last 5 Laps · Sectors</p>
                </div>
                <div className="max-h-28 overflow-y-auto">
                  <table className="w-full text-[8px] font-mono">
                    <thead className="text-slate-500">
                      <tr className="border-b border-slate-700/30">
                        <th className="px-1 py-0.5 text-left">L</th>
                        <th className="px-1 py-0.5 text-right">S1</th>
                        <th className="px-1 py-0.5 text-right">S2</th>
                        <th className="px-1 py-0.5 text-right">S3</th>
                        <th className="px-1 py-0.5 text-right">Lap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lapHistory.map(({ lap, s }) => (
                        <tr key={lap} className="border-b border-slate-700/20 last:border-b-0">
                          <td className="px-1 py-0.5 text-slate-400">{lap}</td>
                          <td className={`px-1 py-0.5 text-right ${s.s1_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s1)}</td>
                          <td className={`px-1 py-0.5 text-right ${s.s2_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s2)}</td>
                          <td className={`px-1 py-0.5 text-right ${s.s3_best ? "text-purple-400" : s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.s3)}</td>
                          <td className={`px-1 py-0.5 text-right ${s.pb ? "text-green-400" : "text-slate-300"}`}>{fmtSector(s.lapTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="rounded border border-slate-700/40 bg-slate-900/35 px-1.5 py-1">
              <p className="text-[8px] uppercase tracking-widest text-slate-500 mb-0.5">Engineer Notes</p>
              {engineerNotes.map((n, idx) => (
                <p key={`${idx}-${n}`} className="text-[8px] text-slate-300 truncate">- {n}</p>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Standings + Race Control */}
        <div className="col-span-5 flex flex-col overflow-hidden">
          {/* Driver-specific intelligence: Now / Pit / Threats */}
          <div className="flex-1 bg-black/25 px-1.5 py-1.5 flex flex-col min-h-0">
            <p className="text-[8px] font-mono uppercase tracking-widest text-slate-400">Driver Intelligence · {selectedDriver}</p>
            <div className="mt-1 grid grid-cols-2 gap-1 flex-1 min-h-0 auto-rows-min content-start overflow-y-auto pr-0.5">

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">ENGINEER CALL</p>
              <p className="text-[14px] leading-none font-black text-cyan-300">{decisionIntel.action}</p>
              <div className="flex items-center gap-1 flex-wrap text-[7px]">
                <span className="px-1 py-0.5 rounded border border-slate-700/50 text-slate-300">{decisionIntel.paceMode}</span>
                <span className={`px-1 py-0.5 rounded border ${decisionIntel.riskLevel === "HIGH" ? "border-red-500/40 text-red-300" : decisionIntel.riskLevel === "MED" ? "border-orange-500/40 text-orange-300" : "border-emerald-500/40 text-emerald-300"}`}>RISK {decisionIntel.riskScore}</span>
                <span className="px-1 py-0.5 rounded border border-slate-700/50 text-slate-300">CONF {decisionIntel.confidence}</span>
              </div>
              <p className="text-[7px] text-slate-400 truncate">WHY: {decisionIntel.why}</p>
              <p className="text-[7px] text-slate-500 truncate">{decisionIntel.targetGap}</p>
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">PIT MATRIX (NOW vs +1)</p>
              {pitMatrix && strategyIntel ? (
                <div className="grid grid-cols-2 gap-1 text-[7px]">
                  <div className="rounded border border-slate-700/40 bg-black/20 p-1">
                    <p className="font-bold text-slate-200">BOX NOW</p>
                    <p>Δ <span className={pitMatrix.nowDelta >= 0 ? "text-emerald-300" : "text-orange-300"}>{pitMatrix.nowDelta >= 0 ? "+" : ""}{pitMatrix.nowDelta}s</span></p>
                    <p className="text-slate-400">Rejoin ~P{pitMatrix.nowRejoin}</p>
                    <p className="text-slate-500">Risk {pitMatrix.riskNow}</p>
                  </div>
                  <div className="rounded border border-slate-700/40 bg-black/20 p-1">
                    <p className="font-bold text-slate-200">BOX +1</p>
                    <p>Δ <span className={pitMatrix.plusDelta >= 0 ? "text-emerald-300" : "text-orange-300"}>{pitMatrix.plusDelta >= 0 ? "+" : ""}{pitMatrix.plusDelta}s</span></p>
                    <p className="text-slate-400">Rejoin ~P{pitMatrix.plusRejoin}</p>
                    <p className="text-slate-500">Risk {pitMatrix.riskPlus}</p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500">No strategy context available</p>
              )}
              <p className="text-[7px] text-slate-500 truncate">Window {strategyIntel?.pitWindowOpen ? "OPEN" : "WAIT"} · Pit loss {strategyIntel?.pitLossSec ?? "—"}s</p>
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">PACE CONSISTENCY</p>
              {paceConsistencyIntel ? (
                <>
                  <div className="flex items-center gap-1 text-[7px]">
                    <span className={`px-1 py-0.5 rounded border ${paceConsistencyIntel.label === "STABLE" ? "border-emerald-500/45 text-emerald-300" : paceConsistencyIntel.label === "VARIABLE" ? "border-yellow-500/45 text-yellow-300" : "border-red-500/45 text-red-300"}`}>
                      {paceConsistencyIntel.label}
                    </span>
                    <span className="text-slate-400">Std {paceConsistencyIntel.std.toFixed(2)}s</span>
                    <span className="text-slate-500 ml-auto">Δ {paceConsistencyIntel.trend >= 0 ? "+" : ""}{paceConsistencyIntel.trend.toFixed(2)}s</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[7px] text-slate-500"><span>Consistency</span><span>{Math.max(0, 100 - Math.round(paceConsistencyIntel.std * 120))}%</span></div>
                    <div className="h-1 rounded bg-slate-700/60 overflow-hidden"><div className="h-full bg-cyan-400" style={{ width: `${Math.max(0, 100 - Math.round(paceConsistencyIntel.std * 120))}%` }} /></div>
                  </div>
                  <p className="text-[7px] text-slate-400">Best {fmtSector(paceConsistencyIntel.best)} · Worst {fmtSector(paceConsistencyIntel.worst)}</p>
                  <p className="text-[7px] text-slate-500">{paceConsistencyIntel.hint}</p>
                </>
              ) : (
                <p className="text-slate-500">Not enough laps for consistency.</p>
              )}
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">BATTLE RADAR</p>
              <p className="text-[7px] text-slate-400">A:{rival?.d ?? "—"} ({battleIntel.aheadGapSec != null ? `${battleIntel.aheadGapSec.toFixed(1)}s` : "n/a"}) · D:{carBehind?.d ?? "—"} ({battleIntel.behindGapSec != null ? `${battleIntel.behindGapSec.toFixed(1)}s` : "n/a"})</p>
              <div>
                <div className="flex items-center justify-between text-[7px] text-slate-500"><span>Attack</span><span>{battleIntel.attackProb == null ? "n/a" : `${Math.round(battleIntel.attackProb * 100)}%`}</span></div>
                <div className="h-1 rounded bg-slate-700/60 overflow-hidden"><div className="h-full bg-emerald-400" style={{ width: `${Math.round((battleIntel.attackProb ?? 0) * 100)}%` }} /></div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[7px] text-slate-500"><span>Defence Risk</span><span>{battleIntel.defendRisk == null ? "n/a" : `${Math.round(battleIntel.defendRisk * 100)}%`}</span></div>
                <div className="h-1 rounded bg-slate-700/60 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${Math.round((battleIntel.defendRisk ?? 0) * 100)}%` }} /></div>
              </div>
              <p className="text-[7px] text-slate-500">ΔV ahead {battleIntel.speedDeltaAhead >= 0 ? "+" : ""}{Math.round(battleIntel.speedDeltaAhead)} · ΔV behind {battleIntel.speedDeltaBehind >= 0 ? "+" : ""}{Math.round(battleIntel.speedDeltaBehind)} km/h</p>
              <p className="text-[7px] text-slate-500 truncate">Trend {battleIntel.trendPer10s >= 0 ? "↑" : "↓"} {Math.abs(battleIntel.trendPer10s).toFixed(2)}s/10s · {battleIntel.trendLabel} · RC {latestRcSummary}</p>
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">SECTOR FOCUS</p>
              {sectorFocusIntel ? (
                <>
                  <div className="grid grid-cols-2 gap-1 text-[7px]">
                    <p className="text-slate-400">Strongest: <span className="text-emerald-300 font-bold">{sectorFocusIntel.strongest[0]}</span></p>
                    <p className="text-slate-400">Weakest: <span className="text-orange-300 font-bold">{sectorFocusIntel.weakest[0]}</span></p>
                    <p className="text-slate-400">Best avg: <span className="text-slate-300">{fmtSector(sectorFocusIntel.strongest[1])}</span></p>
                    <p className="text-slate-400">Gap: <span className="text-slate-300">+{sectorFocusIntel.gap.toFixed(3)}s</span></p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[7px] text-slate-500"><span>Sector balance</span><span>{Math.max(0, 100 - Math.round(sectorFocusIntel.gap * 120))}%</span></div>
                    <div className="h-1 rounded bg-slate-700/60 overflow-hidden"><div className="h-full bg-violet-400" style={{ width: `${Math.max(0, 100 - Math.round(sectorFocusIntel.gap * 120))}%` }} /></div>
                  </div>
                  <p className="text-[7px] text-slate-500">{sectorFocusIntel.focusHint}</p>
                </>
              ) : (
                <p className="text-slate-500">No sector baseline available.</p>
              )}
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-900/50 p-1.5 text-[8px] space-y-0.5 overflow-hidden">
              <p className="font-bold tracking-wider text-slate-300">TRACK / RC</p>
              <div className="flex items-center gap-1 flex-wrap text-[7px]">
                <span className="px-1 py-0.5 rounded border border-slate-700/45 text-slate-300">{trackRcIntel.status}</span>
                <span className={`px-1 py-0.5 rounded border ${trackRcIntel.rain === "RAIN" ? "border-blue-500/45 text-blue-300" : "border-slate-700/45 text-slate-300"}`}>{trackRcIntel.rain}</span>
                <span className={`px-1 py-0.5 rounded border ${trackRcIntel.rcPriority === "HIGH" ? "border-red-500/45 text-red-300" : trackRcIntel.rcPriority === "MED" ? "border-yellow-500/45 text-yellow-300" : "border-slate-700/45 text-slate-300"}`}>RC {trackRcIntel.rcPriority}</span>
              </div>
              <p className="text-[7px] text-slate-500 break-words leading-tight">{trackRcIntel.rcShort}</p>
              <p className="text-[7px] text-slate-500">Live tick {calcTickMs}ms</p>
            </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
