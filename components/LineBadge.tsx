import type { LineBadge as Badge } from "@/lib/answer-types";

export default function LineBadge({ line, size = "md" }: { line: Badge; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold tabular-nums ${size === "sm" ? "h-5 min-w-8 px-1 text-[11px]" : "h-7 min-w-10 px-1.5 text-sm"}`}
      style={{ backgroundColor: line.color, color: line.textColor }}
      aria-label={`Ligne ${line.id}`}
    >
      {line.id}
    </span>
  );
}
