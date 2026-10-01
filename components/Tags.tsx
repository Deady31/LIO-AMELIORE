import { REALTIME_ENABLED } from "@/lib/config";
import { IconClock } from "./icons";

/** Affiché partout tant que le temps réel n'est pas branché. */
export function TheoreticalTag({ theoretical = !REALTIME_ENABLED }: { theoretical?: boolean }) {
  if (!theoretical) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
      <IconClock className="h-3.5 w-3.5" />
      Horaires théoriques
    </span>
  );
}

export function DemoTag({ source }: { source: "gtfs" | "demo" }) {
  if (source !== "demo") return null;
  return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Données factices</span>;
}
