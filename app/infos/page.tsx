import Header from "@/components/Header";
import { DemoTag, TheoreticalTag } from "@/components/Tags";
import { network } from "@/lib/network";

export const metadata = { title: "Infos – concept" };

const fmt = (d: string) => (d ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : "—");

export default function Infos() {
  const { meta } = network;
  const ai = Boolean(process.env.GROQ_API_KEY);
  const rows = [
    ["Source", meta.source === "demo" ? "Jeu de données factice (GTFS du réseau introuvable au build)" : meta.feedName],
    ["Validité", `${fmt(meta.validFrom)} → ${fmt(meta.validTo)}`],
    ["Lignes", network.lines.map((l) => l.shortName).join(", ")],
    ["Arrêts", String(network.stops.length)],
    ["Compréhension", ai ? "IA (Groq) avec repli automatique sans IA" : "Mode sans IA (clé GROQ_API_KEY absente)"],
    ["Données générées le", new Date(meta.generatedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })],
  ];
  return (
    <main>
      <Header title="À propos du concept" subtitle="Assistant IA d'horaires intégré à une appli de transport." />
      <div className="space-y-4 p-4">
        <section className="rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-[0_1px_3px_rgba(16,24,40,.08)] ring-1 ring-line">
          <h2 className="mb-2 font-semibold">Concept non officiel</h2>
          <p className="text-muted">
            Cette maquette montre comment un assistant conversationnel pourrait s&apos;intégrer à l&apos;appli d&apos;un réseau de cars régional (Haute-Garonne). Elle
            n&apos;est ni produite ni validée par l&apos;exploitant.
          </p>
          <p className="mt-2 text-muted">
            L&apos;IA sert uniquement à comprendre la question. Tous les horaires sont calculés par l&apos;application à partir des fiches horaires (GTFS) : l&apos;IA ne
            fournit jamais d&apos;heure.
          </p>
        </section>
        <section className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)] ring-1 ring-line">
          <h2 className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">
            Données <TheoreticalTag /> <DemoTag source={meta.source} />
          </h2>
          <dl className="divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="px-1 text-xs text-muted">Horaires théoriques : retards, déviations et perturbations ne sont pas pris en compte.</p>
      </div>
    </main>
  );
}
