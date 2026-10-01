import Link from "next/link";
import Header from "@/components/Header";
import LineBadge from "@/components/LineBadge";
import { DemoTag, TheoreticalTag } from "@/components/Tags";
import { IconChevron } from "@/components/icons";
import { network } from "@/lib/network";

export const metadata = { title: "Horaires – concept" };

/** Arrêts d'une ligne dans l'ordre de la course la plus longue (sens 0). */
function orderedStops(lineId: string) {
  const trips = network.trips.filter((t) => t.line === lineId);
  const ref = trips.filter((t) => t.direction === 0).sort((a, b) => b.stops.length - a.stops.length)[0] ?? trips[0];
  return ref ? ref.stops.map((i) => network.stops[i]) : [];
}

export default function Lignes() {
  return (
    <main>
      <Header title="Horaires" subtitle="Choisissez un arrêt pour voir les prochains passages." />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">
          <TheoreticalTag />
          <DemoTag source={network.meta.source} />
        </div>
        {network.lines.map((line) => (
          <section key={line.id} className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)] ring-1 ring-line">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <LineBadge line={{ id: line.id, color: line.color, textColor: line.textColor }} />
              <h2 className="text-sm font-semibold leading-snug">{line.longName || `Ligne ${line.id}`}</h2>
            </div>
            <ol className="py-1">
              {orderedStops(line.id).map((s, i, arr) => (
                <li key={s.id}>
                  <Link
                    href={`/?q=${encodeURIComponent(`prochain ${line.id} à ${s.name}`)}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface"
                  >
                    <span className="relative flex w-4 items-center justify-center self-stretch" aria-hidden>
                      <span className={`absolute w-0.5 ${i === 0 ? "top-1/2" : "-top-2"} ${i === arr.length - 1 ? "bottom-1/2" : "-bottom-2"}`} style={{ backgroundColor: line.color }} />
                      <span className="relative h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: line.color }} />
                    </span>
                    <span className="flex-1">{s.name}</span>
                    {s.lines.length > 1 && <span className="text-[11px] text-muted">+ {s.lines.filter((l) => l !== line.id).join(", ")}</span>}
                    <IconChevron className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
