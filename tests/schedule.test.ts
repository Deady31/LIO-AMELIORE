import { describe, expect, it } from "vitest";
import { createNetwork } from "../lib/network";
import { network } from "./demo";
import { directTrips, isServiceActive, matchOnTrip, nextDepartures } from "../lib/schedule";
import type { NetworkData } from "../lib/types";

// Jeu de démo : jeudi 1er octobre 2026 = semaine, samedi 3 = SAM, dimanche 4 = DIM, 11 novembre = férié.
const idx = (id: string) => network.stopIndex.get(id)!;
const GRESILLE = idx("aussonne-gresille");
const AUSSONNE_MAIRIE = idx("aussonne-mairie");
const ARENES = idx("toulouse-arenes");
const MERVILLE = idx("merville-mairie");
const BORDEROUGE = idx("toulouse-borderouge");
const SEILH = idx("seilh-village");

describe("calendrier", () => {
  it("applique jours de semaine et exceptions", () => {
    const s = network.services;
    expect(isServiceActive(s.SEM, "20261001")).toBe(true);
    expect(isServiceActive(s.SEM, "20261003")).toBe(false);
    expect(isServiceActive(s.SAM, "20261003")).toBe(true);
    expect(isServiceActive(s.DIM, "20261004")).toBe(true);
    // 11 novembre (mercredi) : service du dimanche
    expect(isServiceActive(s.SEM, "20261111")).toBe(false);
    expect(isServiceActive(s.DIM, "20261111")).toBe(true);
    // hors période de validité
    expect(isServiceActive(s.SEM, "20300101")).toBe(false);
  });
});

describe("prochains passages", () => {
  it("362 à Grésille vers Toulouse, jeudi 17h35", () => {
    const groups = nextDepartures(network, { stopIdxs: [GRESILLE], lineId: "362", at: { date: "20261001", minutes: 17 * 60 + 35 } });
    const toTls = groups.find((g) => g.label.startsWith("Toulouse"))!;
    // Départ Merville 17h35 en pointe : +12 min * 1,15 ≈ 14 → 17h49 ; celui de 17h05 passe à 17h19.
    expect(toTls.departures[0].time).toBe("17h49");
    expect(toTls.departures[0].waitMin).toBe(14);
    expect(toTls.departures).toHaveLength(3);
    expect(groups.map((g) => g.label).sort()).toEqual(["Merville", "Toulouse – Arènes"]);
  });

  it("filtre par sens", () => {
    const all = nextDepartures(network, { stopIdxs: [GRESILLE], lineId: "362", at: { date: "20261001", minutes: 600 } });
    const key = `362|${all.find((g) => g.label === "Merville")!.direction}`;
    const one = nextDepartures(network, { stopIdxs: [GRESILLE], lineId: "362", at: { date: "20261001", minutes: 600 }, directionKey: key });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe("Merville");
  });

  it("le terminus n'est pas un départ dans le sens d'arrivée", () => {
    const groups = nextDepartures(network, { stopIdxs: [ARENES], lineId: "362", at: { date: "20261001", minutes: 600 } });
    expect(groups.map((g) => g.label)).toEqual(["Merville"]);
  });

  it("après le dernier départ, propose le lendemain", () => {
    const groups = nextDepartures(network, { stopIdxs: [GRESILLE], lineId: "362", at: { date: "20261001", minutes: 23 * 60 } });
    const toTls = groups.find((g) => g.label.startsWith("Toulouse"))!;
    expect(toTls.departures[0].dayOffset).toBe(1);
    expect(toTls.departures[0].time).toBe("6h17");
  });

  it("course après minuit (24h+) prise en compte la nuit suivante", () => {
    // Départ Arènes 23h40 → Merville 24h24, soit 0h24 le lendemain.
    const groups = nextDepartures(network, { stopIdxs: [AUSSONNE_MAIRIE], lineId: "362", at: { date: "20261002", minutes: 10 } });
    const toMerville = groups.find((g) => g.label === "Merville")!;
    expect(toMerville.departures[0].time).toBe("0h15");
    expect(toMerville.departures[0].dayOffset).toBe(0);
  });

  it("samedi : service réduit, pas de 330", () => {
    const groups = nextDepartures(network, { stopIdxs: [AUSSONNE_MAIRIE], at: { date: "20261003", minutes: 600 } });
    const l330 = groups.filter((g) => g.lineId === "330");
    // la 330 n'apparaît que le lundi suivant… hors horizon (48 h) → aucun départ
    expect(l330.every((g) => g.departures.length === 0)).toBe(true);
    expect(groups.find((g) => g.lineId === "362" && g.departures.length)!.departures[0].time).toBe("10h24"); // Merville 10h15 + 9
  });
});

describe("trajet direct", () => {
  it("Aussonne Mairie → Arènes : départ, arrivée, durée", () => {
    const r = directTrips(network, { fromIdxs: [AUSSONNE_MAIRIE], toIdxs: [ARENES], at: { date: "20261001", minutes: 10 * 60 } });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const t = r.trips[0];
    expect(t.lineId).toBe("362");
    expect(t.depTime).toBe("10h24"); // Merville 10h15 + 9
    expect(t.arrTime).toBe("11h00");
    expect(t.durationMin).toBe(36);
    expect(r.trips.every((x, i) => i === 0 || x.depAbs >= r.trips[i - 1].depAbs)).toBe(true);
  });

  it("groupe d'arrêts (Aussonne) : part du dernier arrêt avant la destination", () => {
    const r = directTrips(network, { fromIdxs: [AUSSONNE_MAIRIE, GRESILLE], toIdxs: [ARENES], at: { date: "20261001", minutes: 600 } });
    expect(r.status === "ok" && r.trips[0].fromStop).toBe("Aussonne – Grésille");
  });

  it("sens inverse sur la même ligne", () => {
    const r = directTrips(network, { fromIdxs: [ARENES], toIdxs: [GRESILLE], at: { date: "20261001", minutes: 600 } });
    expect(r.status === "ok" && r.trips[0]).toMatchObject({ depTime: "10h00", arrTime: "10h32" });
  });

  it("autre ligne (330)", () => {
    const r = directTrips(network, { fromIdxs: [AUSSONNE_MAIRIE], toIdxs: [BORDEROUGE], at: { date: "20261001", minutes: 600 } });
    expect(r.status === "ok" && r.trips[0]).toMatchObject({ lineId: "330", depTime: "10h50", arrTime: "11h20", durationMin: 30 });
  });

  it("pas de trajet direct entre lignes différentes", () => {
    expect(directTrips(network, { fromIdxs: [MERVILLE], toIdxs: [BORDEROUGE], at: { date: "20261001", minutes: 600 } }).status).toBe("no-direct");
    expect(directTrips(network, { fromIdxs: [GRESILLE], toIdxs: [SEILH], at: { date: "20261001", minutes: 600 } }).status).toBe("no-direct");
  });

  it("liaison existante mais aucun départ dans l'horizon (week-end, ligne 330)", () => {
    const r = directTrips(network, { fromIdxs: [AUSSONNE_MAIRIE], toIdxs: [BORDEROUGE], at: { date: "20261003", minutes: 600 } });
    expect(r.status).toBe("none-soon");
  });
});

describe("cas limites sur un mini réseau", () => {
  const mini = createNetwork({
    meta: { source: "demo", feedName: "t", sourceUrl: null, generatedAt: "", validFrom: "", validTo: "", timezone: "Europe/Paris" },
    lines: [{ id: "1", shortName: "1", longName: "", color: "#000", textColor: "#fff" }],
    stops: ["A", "B", "C"].map((n) => ({ id: n, name: n, lat: 0, lon: 0, lines: ["1"] })),
    services: { S: { days: "1111111", start: "20200101", end: "20991231", add: [], remove: [] } },
    trips: [
      // boucle A → B → C → A
      { id: "t1", line: "1", service: "S", headsign: "Boucle", direction: 0, stops: [0, 1, 2, 0], arr: [600, 610, 620, 630], dep: [600, 610, 620, 630] },
    ],
  } satisfies NetworkData);

  it("A précède C ; C précède A dans la boucle", () => {
    expect(matchOnTrip(mini.trips[0], [0], [2])).toEqual([0, 2]);
    expect(matchOnTrip(mini.trips[0], [2], [0])).toEqual([2, 3]);
    expect(matchOnTrip(mini.trips[0], [2], [1])).toBeNull();
  });

  it("un départ à l'heure pile est inclus", () => {
    const g = nextDepartures(mini, { stopIdxs: [1], at: { date: "20261001", minutes: 610 } });
    expect(g[0].departures[0]).toMatchObject({ time: "10h10", waitMin: 0 });
  });
});
