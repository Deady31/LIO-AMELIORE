// Jeu de phrases de référence : ce que l'assistant doit comprendre SANS modèle de langage.
// Le nombre de tests qui passent = le score. Lancer : npm run bench
// Phrases écrites par l'équipe (pas par de vrais utilisateurs), sur le jeu de données de démo.
import { describe, expect, it } from "vitest";
import { ask } from "../lib/answer";
import type { Answer } from "../lib/answer-types";
import { network } from "./demo";

const NOW = { date: "20261001", minutes: 10 * 60 }; // jeudi 10h00

type Expect =
  | { kind: "departures"; stop: string; dir?: string }
  | { kind: "trips"; from: string; to: string }
  | { kind: "no-direct" }
  | { kind: "choice" }
  | { kind: "notice" }
  | { kind: "offtopic" };

const D = (stop: string, dir?: string): Expect => ({ kind: "departures", stop, dir });
const T = (from: string, to: string): Expect => ({ kind: "trips", from, to });
const CHOICE: Expect = { kind: "choice" };

const GRE = "Aussonne – Grésille", AMA = "Aussonne – Mairie", MER = "Merville – Mairie", COR = "Cornebarrieu – Centre";
const ODY = "Blagnac – Odyssud", ARE = "Toulouse – Arènes", SEI = "Seilh – Village", BOR = "Toulouse – Borderouge";

export const PHRASES: [string, string, Expect][] = [
  // [style, phrase, attendu]
  ["tapé", "prochain 362 à Grésille", D(GRE)],
  ["tapé", "362 grésille", D(GRE)],
  ["tapé", "prochain bus à Grésille vers Toulouse", D(GRE, "Toulouse")],
  ["parlé", "il passe quand le bus pour Toulouse à Grésille ?", D(GRE, "Toulouse")],
  ["parlé", "le prochain car qui part de Grésille", D(GRE)],
  ["tapé", "quand passe le 362 à Cornebarrieu", D(COR)],
  ["parlé", "dis-moi quand passe le prochain bus à Odyssud", D(ODY)],
  ["parlé", "à quelle heure passe le bus à Seilh", D(SEI)],
  ["tapé", "prochain départ de Merville", D(MER)],
  ["tapé", "horaires 330 Seilh direction Borderouge", D(SEI, "Toulouse – Borderouge")],
  ["tapé", "le prochain 362 direction Merville à Cornebarrieu", D(COR, "Merville")],
  ["parlé", "euh le bus de grésille il passe à quelle heure", D(GRE)],
  ["tapé", "prochain bus à Grésille à 18h", D(GRE)],
  ["faute", "prochain 362 à grezille", D(GRE)],
  ["tapé", "bus Aussonne Mairie vers Merville", D(AMA, "Merville")],
  ["vague", "prochain bus à la mairie", CHOICE],
  ["vague", "prochain bus à Aussonne", CHOICE],
  ["tapé", "comment aller de Aussonne à Arènes", T(GRE, ARE)],
  ["tapé", "de Merville à Odyssud", T(MER, ODY)],
  ["tapé", "Merville -> Arènes", T(MER, ARE)],
  ["parlé", "je suis à Grésille, je veux rentrer à Merville", T(GRE, MER)],
  ["parlé", "je dois aller aux Arènes en partant d'Aussonne vers 18h", T(GRE, ARE)],
  ["parlé", "quel bus prendre pour aller à Blagnac depuis Merville", T(MER, ODY)],
  ["parlé", "comment je rentre chez moi à Seilh depuis Borderouge ?", T(BOR, SEI)],
  ["tapé", "pour aller à Borderouge depuis Aussonne mairie", T(AMA, BOR)],
  ["tapé", "itinéraire Cornebarrieu Arènes", T(COR, ARE)],
  ["tapé", "aller de grésille à arènes demain à 8h", T(GRE, ARE)],
  ["parlé", "je voudrais aller à Toulouse depuis Cornebarrieu", T(COR, ARE)],
  ["tapé", "trajet de Merville à Borderouge", { kind: "no-direct" }],
  ["tapé", "comment aller de Seilh à Odyssud", { kind: "no-direct" }],
  ["tapé", "trajet Odyssud vers Merville", T(ODY, MER)],
  ["parlé", "j'habite à Merville et je travaille à Blagnac, quel bus ?", T(MER, ODY)],
  ["tapé", "de Arènes jusqu'à Cornebarrieu", T(ARE, COR)],
  ["dictée", "prochain bus à aux sonnes mairie", D(AMA)],
  ["dictée", "le trois cent soixante deux à Grésille", D(GRE)],
  ["faute", "prochain bus à Cornebarrieux", D(COR)],
  ["parlé", "comment aller de la mairie de Merville à Odyssud", T(MER, ODY)],
  ["hors démo", "prochain bus à saint cyprien", { kind: "notice" }],
  ["hors sujet", "quel temps fait-il ?", { kind: "offtopic" }],
  ["hors sujet", "bonjour", { kind: "offtopic" }],
  ["hors sujet", "merci beaucoup", { kind: "offtopic" }],
  ["hors sujet", "raconte-moi une blague", { kind: "offtopic" }],
];

function check(a: Answer, e: Expect) {
  switch (e.kind) {
    case "departures":
      expect(a.kind).toBe("departures");
      if (a.kind !== "departures") return;
      expect(a.stopName).toBe(e.stop);
      if (e.dir) {
        expect(a.directions.map((d) => d.label)).toHaveLength(1);
        expect(a.directions[0].label.startsWith(e.dir)).toBe(true);
      }
      return;
    case "trips":
      expect(a.kind).toBe("trips");
      if (a.kind !== "trips") return;
      expect([a.trips[0].fromStop, a.trips[0].toStop]).toEqual([e.from, e.to]);
      return;
    case "offtopic":
      expect(a.kind).toBe("error");
      expect(a.headline).toBe("Je n'ai pas compris la demande.");
      return;
    default:
      expect(a.kind).toBe(e.kind);
  }
}

describe("jeu de phrases de référence (sans modèle de langage)", () => {
  it.each(PHRASES)("[%s] %s", async (_style, question, expected) => {
    const r = await ask(network, { question }, { now: NOW });
    check(r.answer, expected);
  });
});
