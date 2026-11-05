import { describe, expect, it } from "vitest";
import { spokenAnswer, toSpoken } from "../lib/speech";

describe("lecture à voix haute", () => {
  it("heures et durées lisibles", () => {
    expect(toSpoken("Prochain 362 vers Toulouse – Arènes : 17h42 (dans 7 min)")).toBe("Prochain 362 vers Toulouse, Arènes : 17 heures 42 (dans 7 minutes)");
    expect(toSpoken("départ 8h00, arrivée 9h05 (1 h 05)")).toBe("départ 8 heures, arrivée 9 heures 05 (1 heure 05)");
    expect(toSpoken("dans 1 min")).toBe("dans 1 minute");
    expect(toSpoken("dans 2 h")).toBe("dans 2 heures");
  });

  it("une réponse de passage", () => {
    const s = spokenAnswer({ kind: "departures", headline: "Prochain 362 vers Merville : 10h12 (dans 12 min)", stopName: "Aussonne – Grésille", directions: [] });
    expect(s).toBe("Prochain 362 vers Merville : 10 heures 12 (dans 12 minutes). Arrêt Aussonne, Grésille.");
  });

  it("une question lit les options", () => {
    const s = spokenAnswer({ kind: "question", headline: "À quel arrêt ?", followUp: { slot: "arret", pending: {} }, choices: [{ label: "Aussonne – Mairie", request: {} }] });
    expect(s).toBe("À quel arrêt ? Aussonne, Mairie");
  });
});
