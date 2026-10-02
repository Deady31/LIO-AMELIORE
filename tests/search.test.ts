import { describe, expect, it } from "vitest";
import { createNetwork } from "../lib/network";
import { resolvePlace } from "../lib/resolve";
import { canonical, phonetic, tokenSimilarity } from "../lib/text";
import type { NetworkData } from "../lib/types";

const NAMES = [
  "Toulouse - St Cyprien République",
  "Blagnac - Av. du Général de Gaulle",
  "Saint-Jory - Mairie",
  "Toulouse - Matabiau Gare SNCF",
  "Colomiers - Lycée International",
  "Toulouse - Arènes",
  "Aussonne - Grésille",
  "Merville - Mairie",
];

function mini(names: string[], otherStops: NetworkData["otherStops"] = []) {
  return createNetwork({
    meta: { source: "demo", feedName: "t", sourceUrl: null, generatedAt: "", validFrom: "", validTo: "", timezone: "Europe/Paris" },
    lines: [{ id: "1", shortName: "1", longName: "", color: "#000", textColor: "#fff" }],
    stops: names.map((name, i) => ({ id: `s${i}`, name, lat: 0, lon: 0, lines: ["1"] })),
    services: {},
    trips: [],
    otherStops,
  });
}

const net = mini(NAMES, [
  { name: "Toulouse - Jean Jaurès", lines: ["L1", "A", "B"] },
  { name: "Tournefeuille - Gare", lines: ["345"] },
]);
const found = (q: string) => {
  const r = resolvePlace(net, q);
  return r.status === "ok" ? net.stops[r.stopIdxs[0]].name : r.status;
};

describe("normalisation", () => {
  it("développe les abréviations", () => {
    expect(canonical("St-Cyprien")).toBe("saint cyprien");
    expect(canonical("Ste Marguerite")).toBe("sainte marguerite");
    expect(canonical("Av. du Gal de Gaulle")).toBe("avenue du general de gaulle");
    expect(canonical("Bd Lascrosses")).toBe("boulevard lascrosses");
  });
  it("phonétique française", () => {
    expect(phonetic("ciprien")).toBe(phonetic("cyprien"));
    expect(phonetic("grezille")).toBe(phonetic("gresille"));
    expect(phonetic("matabio")).toBe(phonetic("matabiau"));
    expect(phonetic("jaures")).not.toBe(phonetic("jory"));
  });
  it("ressemblance mot à mot", () => {
    expect(tokenSimilarity("cyprien", "cyprien")).toBe(1);
    expect(tokenSimilarity("cypr", "cyprien")).toBeGreaterThan(0.8);
    expect(tokenSimilarity("cyprein", "cyprien")).toBeGreaterThan(0.6);
    expect(tokenSimilarity("2", "3")).toBe(0);
    expect(tokenSimilarity("mairie", "merville")).toBe(0);
  });
});

describe("Saint-Cyprien, quelle que soit l'orthographe", () => {
  it.each([
    "saint cyprien",
    "Saint Cyprien",
    "St Cyprien",
    "st-cyprien",
    "Saint-Cyprien",
    "ST CYPRIEN",
    "stcyprien",
    "saintcyprien",
    "saint ciprien",
    "saint cyprein",
    "cyprien",
    "Cyprien République",
    "république st cyprien",
    "s cyprien",
    "l'arrêt Saint Cyprien",
    "Toulouse Saint Cyprien",
    "saint cypr",
  ])("%s", (q) => {
    expect(found(q)).toBe("Toulouse - St Cyprien République");
  });
});

describe("autres abréviations et surnoms", () => {
  it.each([
    ["avenue du general de gaulle", "Blagnac - Av. du Général de Gaulle"],
    ["av gal de gaulle", "Blagnac - Av. du Général de Gaulle"],
    ["general de gaulle", "Blagnac - Av. du Général de Gaulle"],
    ["st jory", "Saint-Jory - Mairie"],
    ["saint jory mairie", "Saint-Jory - Mairie"],
    ["matabiau", "Toulouse - Matabiau Gare SNCF"],
    ["matabio", "Toulouse - Matabiau Gare SNCF"],
    ["gare de toulouse", "Toulouse - Matabiau Gare SNCF"],
    ["lycee international colomiers", "Colomiers - Lycée International"],
    ["lyc international", "Colomiers - Lycée International"],
    ["grezille", "Aussonne - Grésille"],
    ["arenes", "Toulouse - Arènes"],
  ])("%s → %s", (q, expected) => {
    expect(found(q)).toBe(expected);
  });
});

describe("cas particuliers", () => {
  it("« mairie » reste ambigu", () => {
    expect(resolvePlace(net, "mairie").status).toBe("ambiguous");
  });

  it("deux arrêts Saint-Cyprien → choix", () => {
    const two = mini(["Toulouse - St Cyprien République", "Toulouse - Saint-Cyprien Église", "Toulouse - Arènes"]);
    const r = resolvePlace(two, "st cyprien");
    expect(r.status).toBe("ambiguous");
    expect(r.status === "ambiguous" && r.candidates.length).toBe(2);
    expect(resolvePlace(two, "saint cyprien eglise")).toMatchObject({ status: "ok", label: "Toulouse - Saint-Cyprien Église" });
  });

  it("arrêt du réseau hors démo", () => {
    expect(resolvePlace(net, "Jean Jaures")).toMatchObject({ status: "elsewhere", name: "Toulouse - Jean Jaurès", lines: ["L1", "A", "B"] });
    expect(resolvePlace(net, "jaures")).toMatchObject({ status: "elsewhere" });
    expect(resolvePlace(net, "tournefeuille gare")).toMatchObject({ status: "elsewhere", name: "Tournefeuille - Gare" });
  });

  it("introuvable : pas de faux positif, suggestions si proche", () => {
    expect(resolvePlace(net, "Montpellier Comédie")).toMatchObject({ status: "notfound" });
    const r = resolvePlace(net, "saint martin");
    expect(r.status).toBe("notfound");
    expect(r.status === "notfound" && r.suggestions.length).toBeGreaterThan(0);
  });
});
