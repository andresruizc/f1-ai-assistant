/**
 * API client for the dashboard endpoints.
 * All data is fetched from FastAPI /api/dashboard/* routes.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

// -- Types --

export interface OverviewResult {
  position: number | null;
  driver: string;
  name: string;
  team: string;
  color: string;
  grid: number | null;
  status: string;
  points: number;
  headshot: string;
}

export interface OverviewData {
  results: OverviewResult[];
  fastest_lap: { driver: string; lap: number; time: number } | null;
  total_laps: number;
}

export interface DriverStint {
  stint: number;
  compound: string;
  start_lap: number;
  end_lap: number;
  laps: number;
}

export interface StrategyData {
  stints: Record<string, DriverStint[]>;
  drivers: Record<string, { team: string; color: string }>;
  total_laps: number;
}

export interface PaceLap {
  driver: string;
  lap: number;
  time: number;
  compound: string;
  tyre_life: number;
  team: string;
}

export interface TelemetryPoint {
  distance?: number | null;
  speed?: number | null;
  throttle?: number | null;
  brake?: number | null;
  ngear?: number | null;
  drs?: number | null;
}

export interface TelemetryData {
  telemetry: TelemetryPoint[];
  driver: string;
  lap: number;
}

export interface TelemetryCompareTrace {
  points: TelemetryPoint[];
  color: string;
  team: string;
}

export interface TelemetryCompareData {
  traces: Record<string, TelemetryCompareTrace>;
  lap: number;
}

export interface TrackMapData {
  outline: { x: number[]; y: number[] } | null;
  corners: { x: number[]; y: number[]; numbers: number[] } | null;
  rotation: number;
}

export interface ReplayDriver {
  driver: string;
  x: number;
  y: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  drs: number;
  color: string;
}

export interface ReplayStanding {
  p: number;
  d: string;
  l: number;
  compound: string;
  tyreLife: number;
  speed: number;
  gap: string;
  interval: string;
  retired: boolean;
  inPit: boolean;
}

export interface DrsZone {
  x: number[];
  y: number[];
}

export interface WeatherEntry {
  t: number;
  airTemp: number;
  trackTemp: number;
  humidity: number;
  rainfall: boolean;
  windSpeed: number;
  windDir: number;
}

export interface SectorData {
  s1: number | null;
  s2: number | null;
  s3: number | null;
  pb: boolean;
  s1_best: boolean;
  s2_best: boolean;
  s3_best: boolean;
}

export interface RcMessage {
  t: number;
  cat: string;
  msg: string;
  flag: string;
  lap: number;
}

export interface ReplayFrame {
  drivers: ReplayDriver[];
  elapsed: number;
  lap: number;
  status: string;
  standings: ReplayStanding[];
}

export interface ReplayData {
  frames: Record<string, ReplayFrame>;
  total_frames: number;
  total_laps: number;
  race_start: number;
  race_end: number;
  sample_interval: number;
  track_outline: { x: number[]; y: number[] };
  corners: { x: number[]; y: number[]; numbers: number[] } | null;
  drs_zones: DrsZone[];
  weather: WeatherEntry[];
  sectors: Record<string, Record<number, SectorData>>;
  rc_messages: RcMessage[];
  x_range: [number, number];
  y_range: [number, number];
  drivers: Record<string, { team: string; color: string; headshot: string }>;
}

export interface PositionEntry {
  lap: number;
  position: number | null;
}

export interface PositionHistoryData {
  positions: Record<string, PositionEntry[]>;
  drivers: Record<string, { team: string; color: string }>;
  total_laps: number;
}

// -- API calls --

export const dashboardApi = {
  overview: () => get<OverviewData>("/api/dashboard/overview"),
  strategy: () => get<StrategyData>("/api/dashboard/strategy"),
  pace: (filter?: string, driver?: string) => {
    const params = new URLSearchParams();
    if (filter) params.set("filter_type", filter);
    if (driver) params.set("driver", driver);
    const qs = params.toString();
    return get<{ laps: PaceLap[] }>(`/api/dashboard/pace${qs ? "?" + qs : ""}`);
  },
  telemetry: (driver: string, lap: number) =>
    get<TelemetryData>(`/api/dashboard/telemetry?driver=${driver}&lap=${lap}`),
  telemetryCompare: (drivers: string[], lap: number) =>
    get<TelemetryCompareData>(`/api/dashboard/telemetry-compare?drivers=${drivers.join(",")}&lap=${lap}`),
  trackMap: (driver?: string) =>
    get<TrackMapData>(`/api/dashboard/track-map${driver ? "?driver=" + driver : ""}`),
  replay: (interval = 4) =>
    get<ReplayData>(`/api/dashboard/replay?interval=${interval}`),
  positionHistory: () =>
    get<PositionHistoryData>("/api/dashboard/position-history-full"),
};
