// Texte d'une réponse adapté à la lecture à voix haute (synthèse vocale du téléphone).
import type { Answer } from "./answer-types";

/** « 17h42 » → « 17 heures 42 », « 1 h 05 » → « 1 heure 05 », « 7 min » → « 7 minutes ». */
export function toSpoken(text: string): string {
  return text
    .replace(/\b(\d{1,2})h(\d{2})\b/g, (_, h, m) => `${h} ${Number(h) > 1 ? "heures" : "heure"}${m === "00" ? "" : ` ${m}`}`)
    .replace(/\b(\d{1,2}) h (\d{2})\b/g, (_, h, m) => `${h} ${Number(h) > 1 ? "heures" : "heure"} ${m}`)
    .replace(/\b(\d{1,2}) h\b/g, (_, h) => `${h} ${Number(h) > 1 ? "heures" : "heure"}`)
    .replace(/\b(\d+) min\b/g, (_, n) => `${n} ${n === "1" ? "minute" : "minutes"}`)
    .replace(/\s[–—-]\s/g, ", ")
    .replace(/[«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ce que l'assistant dit pour une réponse : l'essentiel, pas toute la carte. */
export function spokenAnswer(a: Answer): string {
  switch (a.kind) {
    case "departures":
      return toSpoken(`${a.headline}. Arrêt ${a.stopName}.`);
    case "trips":
      return toSpoken(`${a.headline}. Départ de ${a.trips[0].fromStop}.`);
    case "choice":
    case "question": {
      const options = (a.choices ?? []).slice(0, 4).map((c) => c.label);
      return toSpoken([a.headline, options.length ? options.join(" ; ") : ""].filter(Boolean).join(" "));
    }
    default:
      return toSpoken([a.headline, a.detail].filter(Boolean).join(" "));
  }
}
