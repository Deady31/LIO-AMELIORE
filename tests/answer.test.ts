import { describe, expect, it } from "vitest";
import { ask, answerRequest } from "../lib/answer";
import { network } from "./demo";

const NOW = { date: "20261001", minutes: 17 * 60 + 35 }; // jeudi 17h35

describe("/api/ask (logique)", () => {
  it("sans sens : les deux directions", async () => {
    const r = await ask(network, { question: "prochain 362 à grezille" }, { now: NOW });
    expect(r.answer.kind === "departures" && r.answer.directions.map((d) => d.label).sort()).toEqual(["Merville", "Toulouse – Arènes"]);
  });

  it("arrêt ambigu → boutons, puis réponse via le bouton", async () => {
    const r = await ask(network, { question: "prochain bus à mairie" }, { now: NOW });
    expect(r.answer.kind).toBe("choice");
    if (r.answer.kind !== "choice") return;
    expect(r.answer.choices.map((c) => c.label).sort()).toEqual(["Aussonne – Mairie", "Merville – Mairie"]);
    const next = await ask(network, { request: r.answer.choices.find((c) => c.label.startsWith("Merville"))!.request }, { now: NOW });
    expect(next.mode).toBe("bouton");
    expect(next.answer).toMatchObject({ kind: "departures", stopName: "Merville – Mairie" });
  });

  it("sens ambigu → boutons", async () => {
    const r = await ask(network, { question: "prochain bus à Aussonne Mairie vers Toulouse" }, { now: NOW });
    expect(r.answer.kind).toBe("choice");
    expect(r.answer.kind === "choice" && r.answer.choices.length).toBeGreaterThanOrEqual(3);
  });

  it("ligne qui ne dessert pas l'arrêt", async () => {
    const r = await ask(network, { question: "prochain 330 à Grésille" }, { now: NOW });
    expect(r.answer).toMatchObject({ kind: "choice", headline: expect.stringContaining("La 330 ne dessert pas") });
  });

  it("ligne inconnue", async () => {
    const r = await ask(network, { question: "prochain 999 à Grésille" }, { now: NOW });
    expect(r.answer).toMatchObject({ kind: "error", detail: "Lignes disponibles : 362, 330." });
  });

  it("trajet Aussonne → Arènes (commune entière)", async () => {
    const r = await ask(network, { question: "comment aller de Aussonne à Arènes ?" }, { now: NOW });
    expect(r.answer.kind).toBe("trips");
    if (r.answer.kind !== "trips") return;
    expect(r.answer.from).toBe("Aussonne (tous arrêts)");
    expect(r.answer.trips[0]).toMatchObject({ fromStop: "Aussonne – Grésille", depTime: "17h49", arrTime: "18h27", duration: "38 min", wait: "dans 14 min" });
  });

  it("pas de trajet direct", async () => {
    const r = await ask(network, { question: "trajet de Merville à Borderouge" }, { now: NOW });
    expect(r.answer).toMatchObject({ kind: "no-direct", headline: "Pas de trajet direct sur les lignes de la démo" });
  });

  it("heure demandée déjà passée → demain", () => {
    const a = answerRequest(network, { intention: "trajet", depart: "Grésille", arrivee: "Arènes", heure: "07:00" }, NOW);
    expect(a).toMatchObject({ kind: "trips", fromTime: "demain à partir de 7h00" });
    expect(a.kind === "trips" && a.trips[0]).toMatchObject({ day: "demain", wait: "" });
  });

  it("arrêt introuvable et question vide : erreurs en français", async () => {
    const r = await ask(network, { question: "trajet de Paris à Arènes" }, { now: NOW });
    expect(r.answer).toMatchObject({ kind: "error", headline: "Je ne trouve pas l'arrêt de départ « paris »." });
    const empty = await ask(network, { question: "  " }, { now: NOW });
    expect(empty.answer.kind).toBe("error");
  });

  it("hors sujet : erreur claire, sans modèle de langage", async () => {
    const r = await ask(network, { question: "quel temps fait-il ?" }, { now: NOW });
    expect(r.answer.kind).toBe("error");
  });

  it("arrêt du réseau hors des lignes de la démo (Saint-Cyprien)", async () => {
    for (const question of ["prochain bus à saint cyprien", "prochain 362 à St-Cyprien", "comment aller de stcyprien à Arènes"]) {
      const r = await ask(network, { question }, { now: NOW });
      expect(r.answer).toMatchObject({
        kind: "notice",
        headline: "Toulouse – St Cyprien République n'est pas desservi par les lignes de la démo.",
        detail: expect.stringContaining("ligne 345"),
      });
    }
  });

});
