"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { dashboardApi, type ReplayData, type ReplayFrame, type ReplayDriver, type WeatherEntry, type SectorData, type RcMessage } from "@/lib/dashboard-api";
import { tyreColor } from "@/lib/tyre-colors";

const SPEEDS = [
  { label: "0.5×", val: 400 },
  { label: "1×", val: 200 },
  { label: "2×", val: 100 },
  { label: "5×", val: 40 },
  { label: "10×", val: 20 },
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
export default function ReplayTab() {
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [focused, setFocused] = useState<string[]>([]);
  const [gapMode, setGapMode] = useState<"interval" | "gap">("interval");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const isDark = useIsDark();

  useEffect(() => {
    dashboardApi.replay(4).then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  const currentFrame: ReplayFrame | null = data?.frames[String(frame)] ?? null;

  const toggleFocus = useCallback((code: string) => {
    setFocused((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    );
  }, []);

  /* ── Canvas click → pick driver ── */
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!data || !currentFrame || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cX = (e.clientX - rect.left) * dpr;
      const cY = (e.clientY - rect.top) * dpr;
      const w = canvas.width, h = canvas.height;
      const [xMin, xMax] = data.x_range;
      const [yMin, yMax] = data.y_range;
      const scale = Math.min(w / (xMax - xMin), h / (yMax - yMin)) * 0.92;
      const cx = w / 2, cy = h / 2;
      const xM = (xMin + xMax) / 2, yM = (yMin + yMax) / 2;

      let closest: string | null = null;
      let minD = 28 * dpr;
      for (const d of currentFrame.drivers) {
        const sx = cx + (d.x - xM) * scale;
        const sy = cy - (d.y - yM) * scale;
        const dist = Math.hypot(cX - sx, cY - sy);
        if (dist < minD) { minD = dist; closest = d.driver; }
      }
      if (closest) toggleFocus(closest);
    },
    [data, currentFrame, toggleFocus],
  );

  /* ── Draw one frame on canvas ── */
  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, f: ReplayFrame, rd: ReplayData, dark: boolean, focusSet: Set<string>) => {
      const w = ctx.canvas.width, h = ctx.canvas.height;
      const [xMin, xMax] = rd.x_range;
      const [yMin, yMax] = rd.y_range;
      const scale = Math.min(w / (xMax - xMin), h / (yMax - yMin)) * 0.92;
      const cx = w / 2, cy = h / 2;
      const xM = (xMin + xMax) / 2, yM = (yMin + yMax) / 2;
      const toS = (x: number, y: number): [number, number] => [cx + (x - xM) * scale, cy - (y - yM) * scale];

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = dark ? "#06060c" : "#f0f2f7";
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
        ctx.closePath();
      };

      // Track layers
      trackPath();
      ctx.strokeStyle = dark ? "#1e2140" : "#a8b0c4";
      ctx.lineWidth = 28;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      trackPath();
      ctx.strokeStyle = dark ? "#10132a" : "#d0d5e3";
      ctx.lineWidth = 22;
      ctx.stroke();

      trackPath();
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      ctx.setLineDash([14, 10]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corners
      if (rd.corners) {
        ctx.font = "bold 8px system-ui";
        ctx.textAlign = "center";
        for (let i = 0; i < rd.corners.x.length; i++) {
          const [px, py] = toS(rd.corners.x[i], rd.corners.y[i]);
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
          ctx.fill();
          ctx.fillStyle = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
          ctx.fillText("T" + rd.corners.numbers[i], px, py + 12);
        }
      }

      // Drivers: backmarkers first so leaders render on top
      const sorted = [...f.drivers].sort((a, b) => {
        const aP = f.standings.find((s) => s.d === a.driver)?.p ?? 99;
        const bP = f.standings.find((s) => s.d === b.driver)?.p ?? 99;
        return bP - aP;
      });

      for (const d of sorted) {
        const [px, py] = toS(d.x, d.y);
        const isFoc = focusSet.has(d.driver);
        const r = isFoc ? 9 : 5.5;

        // Glow
        const glow = ctx.createRadialGradient(px, py, 0, px, py, r + 14);
        glow.addColorStop(0, d.color + (isFoc ? "70" : "30"));
        glow.addColorStop(1, d.color + "00");
        ctx.beginPath();
        ctx.arc(px, py, r + 14, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.strokeStyle = isFoc ? "#fff" : (dark ? "rgba(255,255,255,0.5)" : "#fff");
        ctx.lineWidth = isFoc ? 2.5 : 1.2;
        ctx.stroke();

        // DRS indicator
        if (d.drs >= 10) {
          ctx.beginPath();
          ctx.arc(px, py, r + 4, -Math.PI * 0.8, -Math.PI * 0.2);
          ctx.strokeStyle = "#22c55e";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // Brake indicator
        if (d.brake > 50) {
          ctx.beginPath();
          ctx.arc(px, py, r + 4, Math.PI * 0.2, Math.PI * 0.8);
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Name label
        ctx.font = `bold ${isFoc ? 9 : 7}px system-ui`;
        const tw = ctx.measureText(d.driver).width;
        const lx = px - tw / 2 - 3, ly = py - r - 12;
        ctx.fillStyle = dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.88)";
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 6, 11, 2);
        ctx.fill();
        ctx.strokeStyle = d.color + (isFoc ? "bb" : "44");
        ctx.lineWidth = isFoc ? 1.2 : 0.4;
        ctx.stroke();
        ctx.fillStyle = dark ? "#eee" : "#1a1a2e";
        ctx.textAlign = "center";
        ctx.fillText(d.driver, px, ly + 8);
      }
    },
    [],
  );

  /* ── Canvas resize ── */
  useEffect(() => {
    const resize = () => {
      const c = canvasRef.current;
      if (!c) return;
      const p = c.parentElement;
      if (!p) return;
      const dpr = window.devicePixelRatio || 1;
      const r = p.getBoundingClientRect();
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [data]);

  /* ── Render current frame ── */
  useEffect(() => {
    if (!data || !currentFrame || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(ctx, currentFrame, data, isDark, new Set(focused));
    ctx.restore();
  }, [frame, data, currentFrame, drawFrame, isDark, focused]);

  /* ── Animation loop ── */
  useEffect(() => {
    if (!playing || !data) return;
    const tick = (ts: number) => {
      if (ts - lastTickRef.current >= SPEEDS[speedIdx].val) {
        lastTickRef.current = ts;
        setFrame((prev) => {
          if (prev + 1 >= data.total_frames) { setPlaying(false); return prev; }
          return prev + 1;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, data, speedIdx]);

  /* ── Loading / Error ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-3">
          <div className="animate-spin h-10 w-10 border-3 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="font-medium">Building replay data...</p>
          <p className="text-xs">Interpolating telemetry for all 20 drivers</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="flex items-center justify-center h-full text-red-500">Failed to load replay data</div>;

  const progress = data.total_frames > 1 ? (frame / (data.total_frames - 1)) * 100 : 0;
  const focusedDrivers = currentFrame?.drivers.filter((d) => focused.includes(d.driver)) ?? [];
  const activeStandings = currentFrame?.standings.filter((s) => !s.retired) ?? [];
  const retiredStandings = currentFrame?.standings.filter((s) => s.retired) ?? [];
  const currentWeather = currentFrame ? getWeatherAt(data.weather, currentFrame.elapsed) : null;
  const recentRc = currentFrame ? getRecentRc(data.rc_messages, currentFrame.elapsed) : [];

  return (
    <div className="flex flex-col rounded-xl border border-border">
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

        <button onClick={() => { setFrame(0); setPlaying(false); }} className="px-2 py-1 rounded text-[10px] font-medium bg-muted hover:bg-muted/80 transition">
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
              setFrame(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (data.total_frames - 1)));
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
      <div className="flex min-h-0 overflow-hidden" style={{ height: "min(70vh, 600px)" }}>
        {/* Track canvas + overlays */}
        <div className="flex-1 min-w-0 relative" style={{ background: isDark ? "#06060c" : "#f0f2f7" }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair"
            onClick={handleCanvasClick}
          />

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

          {/* Race Control ticker (bottom-left) */}
          {recentRc.length > 0 && (
            <div className="absolute bottom-1 left-1 right-1 flex flex-col gap-0.5 pointer-events-none select-none">
              {recentRc.map((msg, i) => {
                const flagColor = FLAG_COLORS[msg.flag?.toUpperCase()] ?? undefined;
                const isLatest = i === recentRc.length - 1;
                return (
                  <div
                    key={`${msg.t}-${i}`}
                    className={`flex items-center gap-1.5 rounded px-2 py-0.5 backdrop-blur-sm text-[9px] transition-opacity ${isLatest ? "opacity-100" : "opacity-50"}`}
                    style={{ backgroundColor: isDark ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)" }}
                  >
                    {flagColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: flagColor }} />}
                    <span className="font-mono text-muted-foreground shrink-0">{fmt(msg.t)}</span>
                    <span className="font-medium text-foreground truncate">{msg.msg}</span>
                    {msg.cat && <span className="text-[8px] text-muted-foreground shrink-0">{msg.cat}</span>}
                  </div>
                );
              })}
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
