export const TYRE_COLORS: Record<string, string> = {
  SOFT: "#FF3333",
  MEDIUM: "#FFC700",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#43B02A",
  WET: "#0067FF",
  UNKNOWN: "#888888",
};

export function tyreColor(compound: string): string {
  return TYRE_COLORS[compound?.toUpperCase()] ?? "#888888";
}

export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
}
