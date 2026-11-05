// Phrases de contrôle, écrites APRÈS le code et jamais utilisées pour le régler.
// Elles mesurent la généralisation. Ne pas modifier le code pour les faire passer
// sans le signaler : sinon ce score ne veut plus rien dire. Lancer : npm run bench:holdout
//
// Historique :
// - 1er passage (code jamais réglé sur ces phrases) : 16/18.
//   Échecs : « bus pour Merville depuis les Arènes » (compris comme prochain passage aux Arènes
//   vers Merville : horaire juste, mais pas de trajet avec heure d'arrivée) et « salut ça va »
//   (le mot « va » était pris pour un mot de trajet).
// - Correctif général ensuite (« va » retiré des mots de trajet) : ce jeu n'est plus vierge.
//   Pour un nouveau score honnête, écrire un nouveau jeu de contrôle.
// - Étape 4 (questions de précision) : « aller aux arènes » attend désormais la question
//   « D'où partez-vous ? » au lieu d'une erreur (changement de comportement voulu, pas un réglage).
// - « comment aller à la plage » passait jusque-là POUR UNE MAUVAISE RAISON : la recherche floue
//   avait choisi « Seilh – Village » en silence (score 0,32), puis l'appli demandait le départ.
//   Corrigé : au-delà d'une correspondance quasi certaine, l'appli propose « Vouliez-vous dire… ? ».
import { describe, expect, it } from "vitest";
import { ask } from "../lib/answer";
import type { Answer } from "../lib/answer-types";
import { network } from "../tests/demo";

const NOW = { date: "20261001", minutes: 10 * 60 }; // jeudi 10h00
const GRE = "Aussonne – Grésille", AMA = "Aussonne – Mairie", MER = "Merville – Mairie", COR = "Cornebarrieu – Centre";
const ODY = "Blagnac – Odyssud", ARE = "Toulouse – Arènes", SEI = "Seilh – Village", BOR = "Toulouse – Borderouge";

type Expect = { d: string; dir?: string } | { from: string; to: string } | { kind: Answer["kind"] | "offtopic" };

const CASES: [string, Expect][] = [
  ["c'est quand le prochain à Odyssud ?", { d: ODY }],
  ["y a un bus bientôt à Seilh ?", { d: SEI }],
  ["je pars de Cornebarrieu, je vais à Odyssud", { from: COR, to: ODY }],
  ["bus pour Merville depuis les Arènes", { from: ARE, to: MER }],
  ["le 330 il passe à quelle heure à Aussonne mairie", { d: AMA }],
  ["prochain 362 en direction de Toulouse à Cornebarrieu", { d: COR, dir: "Toulouse" }],
  ["comment je vais à Borderouge en partant de Seilh", { from: SEI, to: BOR }],
  ["horaire du bus Odyssud direction Arènes", { d: ODY, dir: "Toulouse" }],
  ["je veux rejoindre Merville, je suis à Cornebarrieu", { from: COR, to: MER }],
  ["quand part le prochain bus de Merville pour Toulouse", { d: MER, dir: "Toulouse" }],
  ["aller aux arènes", { kind: "question" }],
  ["de grésil à odisud", { from: GRE, to: ODY }],
  ["le prochain trois cent trente à Seilh", { d: SEI }],
  ["prochain bus Borderouge", { d: BOR }],
  ["trajet seilh arènes", { kind: "no-direct" }],
  ["salut ça va", { kind: "offtopic" }],
  ["tu peux m'aider ?", { kind: "offtopic" }],
  ["comment aller à la plage", { kind: "choice" }],
];

function check(a: Answer, e: Expect) {
  if ("d" in e) {
    expect(a.kind).toBe("departures");
    if (a.kind !== "departures") return;
    expect(a.stopName).toBe(e.d);
    if (e.dir) expect(a.directions.length === 1 && a.directions[0].label.startsWith(e.dir)).toBe(true);
  } else if ("from" in e) {
    expect(a.kind).toBe("trips");
    if (a.kind !== "trips") return;
    expect([a.trips[0].fromStop, a.trips[0].toStop]).toEqual([e.from, e.to]);
  } else if (e.kind === "offtopic") {
    expect(a.headline).toBe("Je n'ai pas compris la demande.");
  } else expect(a.kind).toBe(e.kind);
}

describe("phrases de contrôle (jamais vues pendant le réglage)", () => {
  it.each(CASES)("%s", async (question, expected) => {
    const r = await ask(network, { question }, { now: NOW });
    check(r.answer, expected);
  });
});
