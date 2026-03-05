"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { dashboardApi, type ReplayData, type ReplayFrame, type ReplayDriver, type WeatherEntry, type SectorData, type RcMessage } from "@/lib/dashboard-api";
import { tyreColor } from "@/lib/tyre-colors";

const SPEEDS = [
  { label: "0.5×", rate: 0.5 },
  { label: "1×", rate: 1 },
  { label: "2×", rate: 2 },
  { label: "5×", rate: 5 },
  { label: "10×", rate: 10 },
];

const STATUS_COLORS: Record<string, string> = {
  Green: "#22c55e", Yellow: "#eab308", "Safety Car": "#f97316",
  "Red Flag": "#ef4444", VSC: "#a855f7", "VSC Ending": "#a855f7",
};

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function speedHue(speed: number): string {
  const clamped = Math.min(350, Math.max(0, speed));
  const h = 240 - (clamped / 350) * 240;
  return `hsl(${h}, 85%, 50%)`;
}

function fmt(secs: number): string {
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
}

function fmtSector(s: number | null): string {
  if (s == null) return "—";
  return s < 60 ? s.toFixed(3) : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
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

function countryToFlag(country?: string): string {
  if (!country) return "🏁";
  const map: Record<string, string> = {
    Italy: "🇮🇹",
    Bahrain: "🇧🇭",
    "Saudi Arabia": "🇸🇦",
    Australia: "🇦🇺",
    Japan: "🇯🇵",
    China: "🇨🇳",
    USA: "🇺🇸",
    "United States": "🇺🇸",
    Miami: "🇺🇸",
    Austria: "🇦🇹",
    Spain: "🇪🇸",
    Canada: "🇨🇦",
    Monaco: "🇲🇨",
    "United Kingdom": "🇬🇧",
    Hungary: "🇭🇺",
    Belgium: "🇧🇪",
    Netherlands: "🇳🇱",
    Azerbaijan: "🇦🇿",
    Singapore: "🇸🇬",
    Mexico: "🇲🇽",
    Brazil: "🇧🇷",
    Qatar: "🇶🇦",
    "United Arab Emirates": "🇦🇪",
  };
  return map[country] ?? "🏁";
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

function getRecentRc(messages: RcMessage[], elapsed: number, count = 4): RcMessage[] {
  return messages.filter((m) => m.t <= elapsed).slice(-count);
}

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#22c55e", YELLOW: "#eab308", RED: "#ef4444",
  "DOUBLE YELLOW": "#f59e0b", BLUE: "#3b82f6", BLACK: "#111",
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

/* ─── Driver Avatar ─── */
function DriverAvatar({ src, code, size = 20, border }: { src?: string; code: string; size?: number; border?: string }) {
  return src ? (
    <img
      src={src}
      alt={code}
      width={size}
      height={size}
      className="rounded-full object-cover bg-muted shrink-0"
      style={{ width: size, height: size, border: border ? `2px solid ${border}` : undefined }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  ) : null;
}

/* ─── Telemetry Card ─── */
function TelemetryCard({ d, color, team, compound, tyreLife, sector, inPit, headshot, onClose }: {
  d: ReplayDriver; color: string; team: string;
  compound: string; tyreLife: number; sector: SectorData | null; inPit: boolean; headshot?: string; onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur px-3 py-2 flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1.5">
        <DriverAvatar src={headshot} code={d.driver} size={24} border={color} />
        <div className="w-1 h-5 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-bold text-xs" style={{ color }}>{d.driver}</span>
        <span className="text-[10px] text-muted-foreground truncate">{team}</span>
        {inPit && <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 animate-pulse">PIT</span>}
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground text-[10px]">✕</button>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">Spd</p>
          <p className="text-base font-black leading-none" style={{ color: speedHue(d.speed) }}>{Math.round(d.speed)}</p>
          <p className="text-[7px] text-muted-foreground">km/h</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">Thr</p>
          <div className="w-full h-1 rounded-full bg-muted overflow-hidden mt-0.5">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${d.throttle}%` }} />
          </div>
          <p className="text-[10px] font-bold mt-0.5">{Math.round(d.throttle)}%</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">Brk</p>
          <div className="w-full h-1 rounded-full bg-muted overflow-hidden mt-0.5">
            <div className="h-full bg-red-500 transition-all" style={{ width: `${Math.min(100, d.brake * 100)}%` }} />
          </div>
          <p className="text-[10px] font-bold mt-0.5">{d.brake > 0 ? "ON" : "OFF"}</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">Gear</p>
          <p className="text-lg font-black leading-none mt-px">{d.gear}</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">DRS</p>
          <p className={`text-[9px] font-bold mt-0.5 px-1 py-px rounded ${d.drs >= 10 ? "bg-green-500/20 text-green-500" : "bg-muted text-muted-foreground"}`}>
            {d.drs >= 10 ? "OPEN" : "—"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[8px] text-muted-foreground uppercase">Tyre</p>
          <p className="text-[9px] font-bold mt-0.5 px-1 py-px rounded" style={{ backgroundColor: tyreColor(compound) + "22", color: tyreColor(compound) }}>
            {compound ? compound.charAt(0) : "?"} L{tyreLife}
          </p>
        </div>
      </div>
      {/* Sector times row */}
      {sector && (
        <div className="flex gap-1.5 mt-1.5 pt-1.5 border-t border-border/40">
          {(["s1", "s2", "s3"] as const).map((k, i) => {
            const val = sector[k];
            const isBest = sector[`${k}_best` as keyof SectorData];
            const isPb = sector.pb && val != null;
            return (
              <div key={k} className="flex-1 text-center">
                <p className="text-[7px] text-muted-foreground uppercase">S{i + 1}</p>
                <p className={`text-[10px] font-bold font-mono ${isBest ? "text-purple-500" : isPb ? "text-green-500" : "text-foreground"}`}>
                  {fmtSector(val)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   REPLAY TAB — Immersive full-screen race viewer
   ════════════════════════════════════════════════════════════════════ */
export default function ReplayTab({
  raceKey,
  isActive,
}: {
  raceKey: string;
  isActive: boolean;
}) {
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uiPlayhead, setUiPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [focused, setFocused] = useState<string[]>([]);
  const [gapMode, setGapMode] = useState<"interval" | "gap">("interval");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelWidthCacheRef = useRef<Record<string, number>>({});
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerKeyRef = useRef<string>("");
  const animRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const lastUiTsRef = useRef<number>(0);
  const playheadRef = useRef(0);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlaying(false);
    setFocused([]);
    setUiPlayhead(0);
    playheadRef.current = 0;
    dashboardApi
      .replay(0.25)
      .then((res) => {
        if (!cancelled) setData(res);
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

  const frameIndex = data ? Math.floor(Math.max(0, Math.min(uiPlayhead, data.total_frames - 1))) : 0;
  const baseFrame: ReplayFrame | null = data?.frames[String(frameIndex)] ?? null;
  const renderFrame = data ? getRenderFrame(data, uiPlayhead) : null;
  const currentFrame = renderFrame ?? baseFrame;
  const approxTrackKm = useMemo(() => {
    if (!data) return null;
    const xs = data.track_outline.x;
    const ys = data.track_outline.y;
    if (xs.length < 3 || ys.length < 3) return null;
    let sum = 0;
    for (let i = 1; i < Math.min(xs.length, ys.length); i++) {
      sum += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    sum += Math.hypot(xs[0] - xs[xs.length - 1], ys[0] - ys[ys.length - 1]);
    const km = sum / 1000;
    return Number.isFinite(km) && km > 1 ? km : null;
  }, [data]);

  const toggleFocus = useCallback((code: string) => {
    setFocused((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    );
  }, []);

  const seekPlayhead = useCallback(
    (next: number) => {
      if (!data) return;
      const clamped = Math.max(0, Math.min(next, data.total_frames - 1));
      playheadRef.current = clamped;
      setUiPlayhead(clamped);
    },
    [data],
  );

  /* ── Canvas click → pick driver ── */
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!data || !canvasRef.current) return;
      const frameForHit = getRenderFrame(data, playheadRef.current) ?? currentFrame;
      if (!frameForHit) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cX = e.clientX - rect.left;
      const cY = e.clientY - rect.top;
      const w = canvas.width / dpr, h = canvas.height / dpr;
      const [xMin, xMax] = data.x_range;
      const [yMin, yMax] = data.y_range;
      const scale = Math.min(w / (xMax - xMin), h / (yMax - yMin)) * 0.92;
      const cx = w / 2, cy = h / 2;
      const xM = (xMin + xMax) / 2, yM = (yMin + yMax) / 2;

      let closest: string | null = null;
      let minD = 28;
      const worldTrackHalfWidth = 12 / Math.max(scale, 1e-6);
      for (const d of frameForHit.drivers) {
        const [lx, ly] = lockPointToTrack(
          d.x,
          d.y,
          data.track_outline.x,
          data.track_outline.y,
          worldTrackHalfWidth,
        );
        const sx = cx + (lx - xM) * scale;
        const sy = cy - (ly - yM) * scale;
        const dist = Math.hypot(cX - sx, cY - sy);
        if (dist < minD) { minD = dist; closest = d.driver; }
      }
      if (closest) toggleFocus(closest);
    },
    [data, currentFrame, toggleFocus],
  );

  /* ── Draw one frame on canvas ── */
  const drawFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      f: ReplayFrame,
      rd: ReplayData,
      dark: boolean,
      focusSet: Set<string>,
      lowDetail: boolean,
    ) => {
      const dpr = window.devicePixelRatio || 1;
      const w = ctx.canvas.width / dpr, h = ctx.canvas.height / dpr;
      const [xMin, xMax] = rd.x_range;
      const [yMin, yMax] = rd.y_range;
      const scale = Math.min(w / (xMax - xMin), h / (yMax - yMin)) * 0.92;
      const cx = w / 2, cy = h / 2;
      const xM = (xMin + xMax) / 2, yM = (yMin + yMax) / 2;
      const toS = (x: number, y: number): [number, number] => [cx + (x - xM) * scale, cy - (y - yM) * scale];
      const tx = rd.track_outline.x, ty = rd.track_outline.y;

      if (tx.length < 3) return;

      const staticLayerKey = [
        ctx.canvas.width,
        ctx.canvas.height,
        dark ? "1" : "0",
        rd.x_range[0], rd.x_range[1], rd.y_range[0], rd.y_range[1],
        tx.length,
        rd.corners?.x.length ?? 0,
      ].join("|");

      if (!staticLayerRef.current || staticLayerKeyRef.current !== staticLayerKey) {
        const staticCanvas = document.createElement("canvas");
        staticCanvas.width = ctx.canvas.width;
        staticCanvas.height = ctx.canvas.height;
        const sctx = staticCanvas.getContext("2d");
        if (sctx) {
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          sctx.clearRect(0, 0, w, h);
          sctx.fillStyle = dark ? "#06060c" : "#f0f2f7";
          sctx.fillRect(0, 0, w, h);

          const trackPath = () => {
            sctx.beginPath();
            const [s0x, s0y] = toS(tx[0], ty[0]);
            sctx.moveTo(s0x, s0y);
            for (let i = 1; i < tx.length; i++) {
              const [px, py] = toS(tx[i], ty[i]);
              sctx.lineTo(px, py);
            }
          };

          trackPath();
          sctx.strokeStyle = dark ? "#1e2140" : "#a8b0c4";
          sctx.lineWidth = 28;
          sctx.lineCap = "round";
          sctx.lineJoin = "round";
          sctx.stroke();

          trackPath();
          sctx.strokeStyle = dark ? "#10132a" : "#d0d5e3";
          sctx.lineWidth = 22;
          sctx.stroke();

          trackPath();
          sctx.strokeStyle = dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";
          sctx.lineWidth = 1;
          sctx.setLineDash([14, 10]);
          sctx.stroke();
          sctx.setLineDash([]);

          // Start/finish marker
          if (tx.length > 1) {
            const [sx0, sy0] = toS(tx[0], ty[0]);
            const [sx1, sy1] = toS(tx[1], ty[1]);
            const vx = sx1 - sx0;
            const vy = sy1 - sy0;
            const mag = Math.hypot(vx, vy) || 1;
            const nx = -vy / mag;
            const ny = vx / mag;
            const half = 12;
            const ax = sx0 + nx * half;
            const ay = sy0 + ny * half;
            const bx = sx0 - nx * half;
            const by = sy0 - ny * half;

            sctx.strokeStyle = dark ? "#fff" : "#111";
            sctx.lineWidth = 4;
            sctx.beginPath();
            sctx.moveTo(ax, ay);
            sctx.lineTo(bx, by);
            sctx.stroke();

            const blocks = 6;
            for (let i = 0; i < blocks; i++) {
              const t0 = i / blocks;
              const t1 = (i + 1) / blocks;
              const x0 = ax + (bx - ax) * t0;
              const y0 = ay + (by - ay) * t0;
              const x1 = ax + (bx - ax) * t1;
              const y1 = ay + (by - ay) * t1;
              sctx.strokeStyle = i % 2 === 0 ? "#fff" : "#000";
              sctx.lineWidth = 2;
              sctx.beginPath();
              sctx.moveTo(x0, y0);
              sctx.lineTo(x1, y1);
              sctx.stroke();
            }
          }

          if (rd.corners) {
            sctx.font = "bold 8px system-ui";
            sctx.textAlign = "center";
            for (let i = 0; i < rd.corners.x.length; i++) {
              const [px, py] = toS(rd.corners.x[i], rd.corners.y[i]);
              sctx.beginPath();
              sctx.arc(px, py, 2.5, 0, Math.PI * 2);
              sctx.fillStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
              sctx.fill();
              sctx.fillStyle = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
              sctx.fillText("T" + rd.corners.numbers[i], px, py + 12);
            }
          }
        }
        staticLayerRef.current = staticCanvas;
        staticLayerKeyRef.current = staticLayerKey;
      }

      ctx.clearRect(0, 0, w, h);
      if (staticLayerRef.current) {
        ctx.drawImage(staticLayerRef.current, 0, 0, w, h);
      }

      // Drivers: backmarkers first so leaders render on top
      const sorted = [...f.drivers].sort((a, b) => {
        const aP = f.standings.find((s) => s.d === a.driver)?.p ?? 99;
        const bP = f.standings.find((s) => s.d === b.driver)?.p ?? 99;
        return bP - aP;
      });

      for (const [idx, d] of sorted.entries()) {
        const worldTrackHalfWidth = 12 / Math.max(scale, 1e-6);
        const [lx, ly] = lockPointToTrack(d.x, d.y, tx, ty, worldTrackHalfWidth);
        const [px, py] = toS(lx, ly);
        const isFoc = focusSet.has(d.driver);
        const r = isFoc ? 9 : lowDetail ? 4.5 : 5.5;
        const showLabel = !lowDetail || isFoc || idx < 3;
        const showExtra = !lowDetail || isFoc;

        if (showExtra) {
          // Glow
          const glow = ctx.createRadialGradient(px, py, 0, px, py, r + 14);
          glow.addColorStop(0, d.color + (isFoc ? "70" : "30"));
          glow.addColorStop(1, d.color + "00");
          ctx.beginPath();
          ctx.arc(px, py, r + 14, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Dot
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.strokeStyle = isFoc ? "#fff" : (dark ? "rgba(255,255,255,0.5)" : "#fff");
        ctx.lineWidth = isFoc ? 2.5 : 1.2;
        ctx.stroke();

        // DRS indicator
        if (showExtra && d.drs >= 10) {
          ctx.beginPath();
          ctx.arc(px, py, r + 4, -Math.PI * 0.8, -Math.PI * 0.2);
          ctx.strokeStyle = "#22c55e";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // Brake indicator
        if (showExtra && d.brake > 50) {
          ctx.beginPath();
          ctx.arc(px, py, r + 4, Math.PI * 0.2, Math.PI * 0.8);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (showLabel) {
          // Name label
          ctx.font = `bold ${isFoc ? 9 : 7}px system-ui`;
          const cached = labelWidthCacheRef.current[d.driver];
          const tw = cached ?? ctx.measureText(d.driver).width;
          if (cached == null) labelWidthCacheRef.current[d.driver] = tw;
          const labelX = px - tw / 2 - 3;
          const labelY = py - r - 12;
          ctx.fillStyle = dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.88)";
          ctx.beginPath();
          ctx.roundRect(labelX, labelY, tw + 6, 11, 2);
          ctx.fill();
          ctx.strokeStyle = d.color + (isFoc ? "bb" : "44");
          ctx.lineWidth = isFoc ? 1.2 : 0.4;
          ctx.stroke();
          ctx.fillStyle = dark ? "#eee" : "#1a1a2e";
          ctx.textAlign = "center";
          ctx.fillText(d.driver, px, labelY + 8);
        }
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
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas, data]);

  const drawAtPlayhead = useCallback(
    (ph: number) => {
      if (!data || !canvasRef.current) return;
      const frameToDraw = getRenderFrame(data, ph);
      if (!frameToDraw) return;
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame(ctx, frameToDraw, data, isDark, new Set(focused), playing);
      ctx.restore();
    },
    [data, drawFrame, focused, isDark, playing],
  );

  useEffect(() => {
    drawAtPlayhead(playheadRef.current);
  }, [drawAtPlayhead]);

  useEffect(() => {
    drawAtPlayhead(uiPlayhead);
  }, [uiPlayhead, drawAtPlayhead]);

  useEffect(() => {
    if (!isActive) return;
    const raf = requestAnimationFrame(() => {
      resizeCanvas();
      drawAtPlayhead(playheadRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive, resizeCanvas, drawAtPlayhead]);

  /* ── Animation loop ── */
  useEffect(() => {
    if (!playing || !data) return;
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dtMs = ts - lastTsRef.current;
      lastTsRef.current = ts;
      const frameAdvance = (dtMs / (data.sample_interval * 1000)) * SPEEDS[speedIdx].rate;
      let next = playheadRef.current + frameAdvance;
      if (next >= data.total_frames - 1) {
        next = data.total_frames - 1;
        playheadRef.current = next;
        drawAtPlayhead(next);
        setUiPlayhead(next);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      drawAtPlayhead(next);
      if (ts - lastUiTsRef.current >= 140) {
        lastUiTsRef.current = ts;
        setUiPlayhead(next);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      lastTsRef.current = null;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, data, speedIdx, drawAtPlayhead]);

  /* ── Loading / Error ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)] min-h-[560px] text-muted-foreground rounded-xl border border-border">
        <div className="text-center space-y-3">
          <div className="animate-spin h-10 w-10 border-3 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="font-medium">Building replay data...</p>
          <p className="text-xs">Interpolating telemetry for all 20 drivers</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)] min-h-[560px] text-red-500 rounded-xl border border-border">
        Failed to load replay data
      </div>
    );
  }

  const progress = data.total_frames > 1 ? (uiPlayhead / (data.total_frames - 1)) * 100 : 0;
  const focusedDrivers = currentFrame?.drivers.filter((d) => focused.includes(d.driver)) ?? [];
  const activeStandings = currentFrame?.standings.filter((s) => !s.retired) ?? [];
  const retiredStandings = currentFrame?.standings.filter((s) => s.retired) ?? [];
  const currentWeather = currentFrame ? getWeatherAt(data.weather, currentFrame.elapsed) : null;
  const recentRc = currentFrame ? getRecentRc(data.rc_messages, currentFrame.elapsed) : [];
  const eventFlag = countryToFlag(data.country);

  return (
    <div className="flex flex-col rounded-xl border border-border h-[calc(100vh-8rem)] min-h-[620px]">
      {/* ── Top bar: controls ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/80 backdrop-blur shrink-0">
        <button
          onClick={() => setPlaying(!playing)}
          className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 transition shadow shrink-0"
        >
          {playing ? (
            <svg width="10" height="12" viewBox="0 0 14 16" fill="currentColor"><rect x="1" y="0" width="4" height="16" rx="1" /><rect x="9" y="0" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg width="10" height="12" viewBox="0 0 14 16" fill="currentColor"><path d="M1 1.5L13 8L1 14.5V1.5Z" /></svg>
          )}
        </button>

        <button onClick={() => { seekPlayhead(0); setPlaying(false); }} className="px-2 py-1 rounded text-[10px] font-medium bg-muted hover:bg-muted/80 transition">
          Reset
        </button>

        <div className="flex rounded overflow-hidden border border-border">
          {SPEEDS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSpeedIdx(i)}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${speedIdx === i ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Progress inline */}
        <div className="flex-1 mx-2">
          <div
            className="relative h-1.5 rounded-full bg-muted overflow-hidden cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seekPlayhead(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (data.total_frames - 1));
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-primary rounded-full transition-[width] group-hover:brightness-110" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {currentFrame && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <span className="font-bold">Lap {currentFrame.lap}/{data.total_laps}</span>
            <span className="text-muted-foreground font-mono text-[10px]">{fmt(currentFrame.elapsed)}</span>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-bold"
              style={{ backgroundColor: (STATUS_COLORS[currentFrame.status] ?? "#888") + "20", color: STATUS_COLORS[currentFrame.status] ?? "#888" }}
            >
              {currentFrame.status}
            </span>
          </div>
        )}
      </div>

      {/* ── Main area: Track + Standings ── */}
      <div className="flex min-h-0 overflow-hidden flex-1">
        {/* Track canvas + overlays */}
        <div className="flex-1 min-w-0 relative" style={{ background: isDark ? "#06060c" : "#f0f2f7" }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair"
            onClick={handleCanvasClick}
          />

          {/* Circuit identity badge (top-left) */}
          <div className="absolute top-2 left-2 rounded-lg border border-border/60 bg-card/88 backdrop-blur-md px-3 py-2 text-[10px] shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{eventFlag}</span>
              <div className="min-w-0">
                <p className="font-bold text-foreground leading-tight truncate">
                  {data.event_name ?? "Grand Prix"} {data.year ?? ""}
                </p>
                <p className="text-muted-foreground leading-tight truncate">
                  {data.circuit ?? "Circuit"}{data.country ? `, ${data.country}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 text-muted-foreground">
              <span>{data.corners?.numbers?.length ?? 0} turns</span>
              {approxTrackKm != null && <span>{approxTrackKm.toFixed(2)} km</span>}
            </div>
          </div>

          {/* Weather widget (top-right) */}
          {currentWeather && (
            <div className="absolute top-2 right-2 rounded-lg border border-border/60 bg-card/85 backdrop-blur-md px-2.5 py-1.5 text-[9px] space-y-0.5 pointer-events-none select-none shadow-sm">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-foreground">
                {currentWeather.rainfall ? "🌧" : "☀️"} Weather
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>Air</span><span className="text-foreground font-medium">{currentWeather.airTemp}°C</span>
                <span>Track</span><span className="text-foreground font-medium">{currentWeather.trackTemp}°C</span>
                <span>Humidity</span><span className="text-foreground font-medium">{currentWeather.humidity}%</span>
                <span>Wind</span><span className="text-foreground font-medium">{currentWeather.windSpeed} km/h</span>
              </div>
            </div>
          )}

          {/* Race Control notifications (bottom-left) */}
          {recentRc.length > 0 && (
            <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-none select-none" style={{ maxWidth: "min(360px, 45%)" }}>
              <AnimatePresence mode="popLayout">
                {recentRc.map((msg, i) => {
                  const flagColor = FLAG_COLORS[msg.flag?.toUpperCase()] ?? undefined;
                  const isLatest = i === recentRc.length - 1;
                  const accentColor = flagColor ?? (isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)");
                  return (
                    <motion.div
                      key={`rc-${msg.t}-${msg.msg}`}
                      initial={{ opacity: 0, x: -24, scale: 0.95 }}
                      animate={{ opacity: isLatest ? 1 : 0.45, x: 0, scale: isLatest ? 1 : 0.97 }}
                      exit={{ opacity: 0, x: -16, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="rounded-lg border border-border/50 backdrop-blur-xl shadow-lg overflow-hidden"
                      style={{ backgroundColor: isDark ? "rgba(10,10,20,0.88)" : "rgba(255,255,255,0.92)" }}
                    >
                      <div className="flex items-stretch">
                        {/* Colored accent bar */}
                        <div className="w-1 shrink-0 rounded-l-lg" style={{ backgroundColor: accentColor }} />
                        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
                          {flagColor && (
                            <span
                              className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                              style={{ backgroundColor: flagColor, boxShadow: `0 0 8px ${flagColor}60` }}
                            />
                          )}
                          <div className="flex flex-col min-w-0 gap-0.5">
                            <span className="font-bold text-foreground text-[11px] leading-tight truncate">{msg.msg}</span>
                            <div className="flex items-center gap-2 text-[9px] text-muted-foreground leading-tight">
                              <span className="font-mono">{fmt(msg.t)}</span>
                              {msg.cat && (
                                <span className="uppercase tracking-widest font-semibold text-[8px] px-1.5 py-px rounded-full" style={{ backgroundColor: accentColor + "25", color: flagColor ?? undefined }}>
                                  {msg.cat}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Standings panel */}
        <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0 bg-muted/30">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Live Standings</h3>
              {currentFrame && (
                <p className="text-[10px] text-muted-foreground">Lap {currentFrame.lap}/{data.total_laps} · {fmt(currentFrame.elapsed)}</p>
              )}
            </div>
            <button
              onClick={() => setGapMode((p) => p === "interval" ? "gap" : "interval")}
              className="text-[9px] px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 font-bold transition"
            >
              {gapMode === "interval" ? "INT" : "GAP"}
            </button>
          </div>

          {/* Column headers */}
          <div className="flex items-center px-2.5 py-1 border-b border-border/50 text-[8px] text-muted-foreground uppercase font-bold tracking-wider shrink-0">
            <span className="w-5 text-center">P</span>
            <span className="w-2" />
            <span className="w-10">DRV</span>
            <span className="w-5 text-center">T</span>
            <span className="w-9 text-right">SPD</span>
            <span className="flex-1 text-right pr-1">{gapMode === "interval" ? "INT" : "GAP"}</span>
          </div>

          {/* Driver rows */}
          <div className="flex-1 overflow-y-auto">
            {activeStandings.map((s, i) => {
              const color = data.drivers[s.d]?.color ?? "#888";
              const isFoc = focused.includes(s.d);
              const gapVal = gapMode === "interval" ? s.interval : s.gap;
              const isTop3 = i < 3;

              return (
                <div
                  key={s.d}
                  onClick={() => toggleFocus(s.d)}
                  className={`flex items-center px-2.5 py-[5px] cursor-pointer transition-colors border-b border-border/10 ${
                    isFoc
                      ? "bg-primary/8 border-l-[3px] border-l-primary"
                      : "hover:bg-muted/30"
                  }`}
                >
                  <span className={`w-5 text-center font-bold text-[11px] ${isTop3 ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.p}
                  </span>
                  <DriverAvatar src={data.drivers[s.d]?.headshot} code={s.d} size={18} border={color} />
                  <div className="w-[3px] h-[18px] rounded-full shrink-0 mx-0.5" style={{ backgroundColor: color }} />
                  <span className="font-bold text-[11px] w-10" style={{ color }}>{s.d}</span>
                  {s.inPit && <span className="text-[7px] font-black px-1 py-px rounded bg-yellow-500/20 text-yellow-600 animate-pulse mr-0.5">PIT</span>}
                  <span className="w-5 text-center text-[9px] font-bold" style={{ color: tyreColor(s.compound) }}>
                    {s.compound ? s.compound.charAt(0) : "?"}
                  </span>
                  <span className="w-9 text-right text-[9px] font-mono text-muted-foreground">
                    {s.speed > 0 ? s.speed : ""}
                  </span>
                  <span className="flex-1 text-right text-[9px] font-mono text-muted-foreground pr-1 truncate">
                    {i === 0 ? `L${s.l}` : gapVal || `L${s.l}`}
                  </span>
                </div>
              );
            })}

            {/* Retired block */}
            {retiredStandings.length > 0 && (
              <div className="px-2.5 py-1.5 border-t border-border/30">
                <p className="text-[9px] text-muted-foreground font-bold uppercase mb-1">Retired</p>
                <div className="flex flex-wrap gap-1">
                  {retiredStandings.map((s) => {
                    const color = data.drivers[s.d]?.color ?? "#888";
                    return (
                      <span key={s.d} className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: color + "18", color }}>
                        {s.d}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Driver selection pills */}
          <div className="px-2.5 py-2 border-t border-border bg-muted/20 shrink-0">
            {focused.length > 0 ? (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[8px] text-muted-foreground uppercase font-bold mr-1">Comparing:</span>
                {focused.map((code) => (
                  <button
                    key={code}
                    onClick={() => toggleFocus(code)}
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 hover:brightness-110 transition"
                    style={{ backgroundColor: (data.drivers[code]?.color ?? "#888") + "25", color: data.drivers[code]?.color }}
                  >
                    {code}
                    <span className="text-[7px] opacity-60">✕</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[9px] text-muted-foreground text-center">Click any driver to compare</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom: Focused drivers telemetry ── */}
      <AnimatePresence>
        {focusedDrivers.length > 0 && currentFrame && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-card/80 backdrop-blur shrink-0"
          >
            <div className="flex flex-wrap gap-2 p-2">
              {focusedDrivers.map((d) => {
                const s = currentFrame.standings.find((st) => st.d === d.driver);
                const sectorData = (s && data.sectors[d.driver])
                  ? (data.sectors[d.driver][s.l] ?? data.sectors[d.driver][s.l - 1] ?? null)
                  : null;
                return (
                  <div key={d.driver} className="w-[calc(33.333%-6px)] min-w-[280px]">
                    <TelemetryCard
                      d={d}
                      color={d.color}
                      team={data.drivers[d.driver]?.team ?? ""}
                      compound={s?.compound ?? ""}
                      tyreLife={s?.tyreLife ?? 0}
                      sector={sectorData}
                      inPit={s?.inPit ?? false}
                      headshot={data.drivers[d.driver]?.headshot}
                      onClose={() => toggleFocus(d.driver)}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
