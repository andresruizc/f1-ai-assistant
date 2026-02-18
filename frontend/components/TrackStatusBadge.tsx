"use client";

interface Props {
  status: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  Green: { bg: "bg-green-500", text: "text-white", label: "GREEN" },
  Yellow: { bg: "bg-yellow-400", text: "text-black", label: "YELLOW" },
  "Safety Car": { bg: "bg-orange-500", text: "text-white", label: "SAFETY CAR" },
  VSC: { bg: "bg-orange-400", text: "text-white", label: "VSC" },
  "VSC Ending": { bg: "bg-orange-300", text: "text-black", label: "VSC ENDING" },
  "Red Flag": { bg: "bg-red-600", text: "text-white", label: "RED FLAG" },
};

export default function TrackStatusBadge({ status }: Props) {
  const style = STATUS_STYLES[status] ?? {
    bg: "bg-gray-500",
    text: "text-white",
    label: status.toUpperCase(),
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}
