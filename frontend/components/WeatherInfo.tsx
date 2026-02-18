"use client";

interface Props {
  weather: {
    air_temp: number | null;
    track_temp: number | null;
    humidity: number | null;
    wind_speed: number | null;
    rainfall: boolean;
  } | null;
}

export default function WeatherInfo({ weather }: Props) {
  if (!weather) return null;

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Air: {weather.air_temp ?? "—"}°C</span>
        <span>Track: {weather.track_temp ?? "—"}°C</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Humidity: {weather.humidity ?? "—"}%</span>
        <span>Wind: {weather.wind_speed ?? "—"} m/s</span>
      </div>
      {weather.rainfall && (
        <span className="text-blue-400 font-semibold">Rain detected</span>
      )}
    </div>
  );
}
