import { describe, expect, it } from "vitest";
import { answerNear, answerRequest, ask } from "../lib/answer";
import type { Answer, FollowUp } from "../lib/answer-types";
import { createNetwork } from "../lib/network";
import { network } from "./demo";

const NOW = { date: "20261001", minutes: 10 * 60 }; // jeudi 10h00
const followUpOf = (a: Answer): FollowUp => {
  if ((a.kind === "question" || a.kind === "choice") && a.followUp) return a.followUp;
  throw new Error(`pas de question en attente : ${a.kind} ${a.headline}`);
};

describe("questions de précision avec mémoire", () => {
  it("départ manquant : l'assistant demande, la réponse tapée complète la demande", async () => {
    const r1 = await ask(network, { question: "je veux aller aux Arènes" }, { now: NOW });
    expect(r1.answer).toMatchObject({ kind: "question", headline: "D'où partez-vous ?" });
    const r2 = await ask(network, { question: "Aussonne", followUp: followUpOf(r1.answer) }, { now: NOW });
    expect(r2.answer.kind).toBe("trips");
    if (r2.answer.kind === "trips") expect([r2.answer.trips[0].fromStop, r2.answer.trips[0].toStop]).toEqual(["Aussonne – Grésille", "Toulouse – Arènes"]);
  });

  it("arrêt manquant : « prochain bus » puis « grésille »", async () => {
    const r1 = await ask(network, { question: "prochain bus" }, { now: NOW });
    expect(r1.answer).toMatchObject({ kind: "question", headline: "À quel arrêt ?" });
    const r2 = await ask(network, { question: "euh à grésille", followUp: followUpOf(r1.answer) }, { now: NOW });
    expect(r2.answer).toMatchObject({ kind: "departures", stopName: "Aussonne – Grésille" });
  });

  it("nom ambigu : « la mairie » puis « Merville » donne Merville – Mairie", async () => {
    const r1 = await ask(network, { question: "prochain bus à la mairie" }, { now: NOW });
    expect(r1.answer.kind).toBe("choice");
    const r2 = await ask(network, { question: "Merville", followUp: followUpOf(r1.answer) }, { now: NOW });
    expect(r2.answer).toMatchObject({ kind: "departures", stopName: "Merville – Mairie" });
  });

  it("une nouvelle demande n'est pas prise pour une réponse", async () => {
    const r1 = await ask(network, { question: "je veux aller aux Arènes" }, { now: NOW });
    const r2 = await ask(network, { question: "prochain 330 à Seilh", followUp: followUpOf(r1.answer) }, { now: NOW });
    expect(r2.answer).toMatchObject({ kind: "departures", stopName: "Seilh – Village" });
  });

  it("la ligne demandée sans arrêt : boutons + réponse tapée", async () => {
    const r1 = await ask(network, { question: "prochain 362" }, { now: NOW });
    expect(r1.answer.kind).toBe("question");
    const r2 = await ask(network, { question: "Odyssud", followUp: followUpOf(r1.answer) }, { now: NOW });
    expect(r2.answer).toMatchObject({ kind: "departures", stopName: "Blagnac – Odyssud" });
  });
});

describe("arrêts utiles uniquement", () => {
  it("« de la mairie à Borderouge » : seule Aussonne – Mairie a une liaison directe, choisie d'office", async () => {
    const r = await ask(network, { question: "comment aller de la mairie à Borderouge" }, { now: NOW });
    expect(r.answer.kind).toBe("trips");
    if (r.answer.kind === "trips") expect(r.answer.trips[0].fromStop).toBe("Aussonne – Mairie");
  });
});

describe("choix par commune quand la liste est longue", () => {
  const towns = ["Aucamville", "Blagnac", "Colomiers", "Fenouillet", "Launaguet", "Seilh"];
  const net = createNetwork({
    meta: network.meta,
    lines: network.lines,
    stops: towns.map((t, i) => ({ id: `m${i}`, name: `${t} – Mairie`, lat: 0, lon: 0, lines: ["362"] })),
    services: {},
    trips: [],
  });

  it("d'abord la commune, puis un seul arrêt", () => {
    const a = answerRequest(net, { intention: "prochain", arret: "mairie" }, NOW);
    expect(a).toMatchObject({ kind: "choice", headline: "« mairie » existe dans plusieurs communes. Laquelle ?" });
    if (a.kind !== "choice") return;
    expect(a.choices.map((c) => c.label)).toEqual(towns);
    // une commune = un seul arrêt ici : le bouton désigne directement l'arrêt
    expect(a.choices[2].request.arretIds).toEqual(["m2"]);
  });
});

describe("Utiliser ma position", () => {
  const pending: FollowUp = { slot: "arret", pending: { intention: "prochain" }, geo: true };

  it("propose les arrêts les plus proches, avec la distance", () => {
    const a = answerNear(network, pending, { lat: 43.6765, lon: 1.3315 }); // à côté de Grésille
    expect(a.kind).toBe("choice");
    if (a.kind !== "choice") return;
    expect(a.choices[0].label).toBe("Aussonne – Grésille");
    expect(a.choices[0].sub).toMatch(/^à \d+ m/);
    expect(a.choices.length).toBeLessThanOrEqual(3);
  });

  it("trajet : seulement les arrêts proches qui mènent à la destination", () => {
    const a = answerNear(network, { slot: "depart", pending: { intention: "trajet", arrivee: "Borderouge" } }, { lat: 43.68, lon: 1.327 });
    // Grésille est plus près mais n'a pas de liaison directe vers Borderouge : écartée.
    expect(a.kind === "choice" && a.choices.map((c) => c.label)).toEqual(["Aussonne – Mairie", "Seilh – Village"]);
  });

  it("trop loin : message clair", () => {
    expect(answerNear(network, pending, { lat: 48.85, lon: 2.35 })).toMatchObject({ kind: "error" });
  });

  it("position invalide ignorée par l'API", async () => {
    const r = await ask(network, { question: "prochain bus à Seilh", followUp: pending, near: { lat: "x", lon: 1 } }, { now: NOW });
    expect(r.answer).toMatchObject({ kind: "departures", stopName: "Seilh – Village" });
  });
});
