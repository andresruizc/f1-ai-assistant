import type {
  ChatMessage,
  RaceMetadata,
  RaceScheduleEntry,
  StandingsEntry,
  TrackStatus,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getSchedule(year: number): Promise<RaceScheduleEntry[]> {
  const res = await fetch(`${API_BASE}/api/race/schedules/${year}`);
  if (!res.ok) throw new Error(`Failed to get schedule: ${res.statusText}`);
  return res.json();
}

export async function loadRace(
  year: number,
  round: number
): Promise<RaceMetadata> {
  const res = await fetch(`${API_BASE}/api/race/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year, round_number: round }),
  });
  if (!res.ok) throw new Error(`Failed to load race: ${res.statusText}`);
  return res.json();
}

export async function getStandings(lap: number): Promise<StandingsEntry[]> {
  const res = await fetch(`${API_BASE}/api/race/standings?lap=${lap}`);
  if (!res.ok) throw new Error(`Failed to get standings: ${res.statusText}`);
  return res.json();
}

export async function getPositionHistory(
  lap: number
): Promise<Record<string, (number | null)[]>> {
  const res = await fetch(
    `${API_BASE}/api/race/position-history?lap=${lap}`
  );
  if (!res.ok) throw new Error(`Failed to get position history: ${res.statusText}`);
  return res.json();
}

export async function getTrackStatus(lap: number): Promise<TrackStatus> {
  const res = await fetch(`${API_BASE}/api/race/track-status?lap=${lap}`);
  if (!res.ok) throw new Error(`Failed to get track status: ${res.statusText}`);
  return res.json();
}

export async function getDrivers(): Promise<
  { code: string; name: string; team: string; color: string }[]
> {
  const res = await fetch(`${API_BASE}/api/race/drivers`);
  if (!res.ok) throw new Error(`Failed to get drivers: ${res.statusText}`);
  return res.json();
}

export async function sendChatMessage(
  message: string,
  driverCode: string,
  currentLap: number,
  history: ChatMessage[]
): Promise<{ reply: string; tools_used: string[] }> {
  const res = await fetch(`${API_BASE}/api/chat/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      driver_code: driverCode,
      current_lap: currentLap,
      conversation_history: history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.statusText}`);
  return res.json();
}
