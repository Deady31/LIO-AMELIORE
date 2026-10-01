import { describe, expect, it } from "vitest";
import { network } from "./demo";
import { parseFallback, sanitizeIntent } from "../lib/intent";
import { resolveDirection, resolveLine, resolvePlace } from "../lib/resolve";
import { directionsAtStop } from "../lib/schedule";

const name = (r: ReturnType<typeof resolvePlace>) => (r.status === "ok" ? network.stops[r.stopIdxs[0]].name : r.status);

describe("arrêts (tolérance aux fautes)", () => {
  it.each([
    ["Grésille", "Aussonne – Grésille"],
    ["gresille", "Aussonne – Grésille"],
    ["grezille", "Aussonne – Grésille"],
    ["gresil", "Aussonne – Grésille"],
    ["l'arrêt Grésille", "Aussonne – Grésille"],
    ["arenes", "Toulouse – Arènes"],
    ["Arènnes", "Toulouse – Arènes"],
    ["borderouje", "Toulouse – Borderouge"],
    ["odysud", "Blagnac – Odyssud"],
    ["aussonne mairie", "Aussonne – Mairie"],
    ["Cornebarieu", "Cornebarrieu – Centre"],
  ])("%s → %s", (q, expected) => {
    expect(name(resolvePlace(network, q))).toBe(expected);
  });

  it("commune seule → groupe ambigu", () => {
    const r = resolvePlace(network, "Aussonne");
    expect(r).toMatchObject({ status: "ambiguous", group: true });
    expect(r.status === "ambiguous" && r.candidates.length).toBe(2);
  });

  it("« Mairie » est ambigu (Aussonne / Merville)", () => {
    expect(resolvePlace(network, "mairie")).toMatchObject({ status: "ambiguous", group: false });
  });

  it("filtre par ligne : Aussonne sur la 330 → Mairie seulement", () => {
    expect(name(resolvePlace(network, "Aussonne", { lineId: "330" }))).toBe("Aussonne – Mairie");
  });

  it("arrêt inconnu", () => {
    expect(resolvePlace(network, "Montpellier Comédie").status).toBe("notfound");
    expect(resolvePlace(network, "").status).toBe("notfound");
  });
});

describe("lignes et sens", () => {
  it("lignes", () => {
    expect(resolveLine(network, "362")).toEqual({ status: "ok", lineId: "362" });
    expect(resolveLine(network, "ligne 330")).toEqual({ status: "ok", lineId: "330" });
    const r = resolveLine(network, "36");
    expect(r.status).toBe("notfound");
    expect(r.status === "notfound" && r.suggestions).toContain("362");
  });

  it("sens", () => {
    const g = network.stopIndex.get("aussonne-gresille")!;
    const dirs = directionsAtStop(network, [g], "362");
    const toTls = dirs.find((d) => d.label.startsWith("Toulouse"))!.key;
    expect(resolveDirection(dirs, "Toulouse")).toEqual({ status: "ok", key: toTls });
    expect(resolveDirection(dirs, "vers arenes")).toEqual({ status: "ok", key: toTls });
    expect(resolveDirection(dirs, "Odyssud")).toEqual({ status: "ok", key: toTls });
    expect(resolveDirection(dirs, "Merviile").status).toBe("ok");
    expect(resolveDirection(dirs, "Paris").status).toBe("notfound");
  });

  it("sens ambigu entre deux lignes", () => {
    const m = network.stopIndex.get("aussonne-mairie")!;
    expect(resolveDirection(directionsAtStop(network, [m]), "Toulouse").status).toBe("ambiguous");
  });
});

describe("analyse sans IA", () => {
  const lines = ["362", "330"];
  it.each([
    ["prochain 362 à Grésille", { intention: "prochain", ligne: "362", arret: "gresille" }],
    ["Prochain 362 à Grésille vers Toulouse", { intention: "prochain", ligne: "362", arret: "gresille", sens: "toulouse" }],
    ["362 gresille", { intention: "prochain", ligne: "362", arret: "gresille" }],
    ["quand passe le prochain bus à Aussonne Mairie direction Merville", { intention: "prochain", arret: "aussonne mairie", sens: "merville" }],
    ["prochain 362 à Grésille à 18h", { intention: "prochain", ligne: "362", arret: "gresille", heure: "18:00" }],
    ["horaires 330 aussonne 7h30", { intention: "prochain", ligne: "330", arret: "aussonne", heure: "07:30" }],
    ["comment aller de Aussonne à Arènes ?", { intention: "trajet", depart: "aussonne", arrivee: "arenes" }],
    ["Comment aller d'Aussonne à l'arrêt Arènes", { intention: "trajet", depart: "aussonne", arrivee: "l arret arenes" }],
    ["trajet Merville -> Borderouge", { intention: "trajet", depart: "merville", arrivee: "borderouge" }],
    ["je veux aller à Odyssud depuis Grésille", { intention: "trajet", depart: "gresille", arrivee: "odyssud" }],
    ["de Seilh à Borderouge", { intention: "trajet", depart: "seilh", arrivee: "borderouge" }],
  ])("%s", (q, expected) => {
    expect(parseFallback(q, lines)).toMatchObject(expected);
  });
});

describe("validation de la sortie du LLM", () => {
  it("nettoie et normalise", () => {
    expect(sanitizeIntent({ intention: "prochain", ligne: 362, arret: "Grésille", sens: "null", heure: "7h" })).toEqual({
      intention: "prochain", ligne: "362", arret: "Grésille", depart: null, arrivee: null, sens: null, heure: "07:00",
    });
  });
  it("rejette une intention inconnue", () => {
    expect(() => sanitizeIntent({ intention: "meteo" })).toThrow();
    expect(() => sanitizeIntent("texte")).toThrow();
  });
});
