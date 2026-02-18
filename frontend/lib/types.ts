export interface Driver {
  code: string;
  name: string;
  team: string;
  color: string;
}

export interface StandingsEntry {
  position: number | null;
  driver: string;
  team: string;
  compound: "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | null;
  tyre_age: number | null;
  gap_to_leader: number | null;
  last_lap_time: number | null;
  last_lap_time_str: string | null;
}

export interface RaceMetadata {
  total_laps: number;
  circuit: string;
  country: string;
  event_name: string;
  year: number;
  drivers: Driver[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  lap?: number;
  tools_used?: string[];
}

export interface TrackStatus {
  status: string;
  history: { lap: number; status: string; message: string }[];
  weather: {
    air_temp: number | null;
    track_temp: number | null;
    humidity: number | null;
    wind_speed: number | null;
    rainfall: boolean;
  };
}

export interface RaceScheduleEntry {
  round: number;
  name: string;
  country: string;
  location: string;
}

export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";

export const TYRE_COLORS: Record<TyreCompound, string> = {
  SOFT: "#FF3333",
  MEDIUM: "#FFC700",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#43B02A",
  WET: "#0067FF",
};
