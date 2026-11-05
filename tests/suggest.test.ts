import { describe, expect, it } from "vitest";
import { suggestFor } from "../lib/suggest";
import { network } from "./demo";

const names = (text: string) => suggestFor(network, text).items.map((i) => i.name);

describe("suggestions pendant la frappe", () => {
  it("début de mot", () => {
    expect(names("gresi")[0]).toBe("Aussonne – Grésille");
    expect(names("prochain 362 à gres")[0]).toBe("Aussonne – Grésille");
  });

  it("fragment remplacé tel que tapé", () => {
    expect(suggestFor(network, "prochain 362 à gresi").fragment).toBe("gresi");
    expect(suggestFor(network, "bus à saint cypr").fragment).toBe("saint cypr");
  });

  it("Saint-Cyprien, hors démo, sous toutes ses orthographes", () => {
    for (const t of ["st cyp", "saint cyprien", "cyprien", "stcyprien", "saint ciprien"]) {
      const r = suggestFor(network, t);
      expect(r.items[0]?.name, t).toBe("Toulouse – St Cyprien République");
      expect(r.items[0].demo).toBe(false);
    }
  });

  it("arrêts de la démo avant les autres à score proche", () => {
    const r = suggestFor(network, "toulouse");
    expect(r.items.length).toBeGreaterThan(1);
    expect(r.items.slice(0, 2).every((i) => i.demo)).toBe(true);
  });

  it("commune seule : tous ses arrêts", () => {
    expect(names("aussonne").sort()).toEqual(["Aussonne – Grésille", "Aussonne – Mairie"]);
  });

  it("rien quand il n'y a rien à proposer", () => {
    expect(names("")).toEqual([]);
    expect(names("ab")).toEqual([]);
    expect(names("prochain bus")).toEqual([]);
    expect(names("zzzzzz")).toEqual([]);
    expect(names("gresille ")).toEqual([]); // mot terminé par un espace
    expect(names("362")).toEqual([]);
  });

  it("au plus 5 suggestions", () => {
    expect(names("toulouse").length).toBeLessThanOrEqual(5);
  });
});
