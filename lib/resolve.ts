// Reconnaissance des arrêts, lignes et sens, tolérante aux fautes (fuse.js).
import Fuse from "fuse.js";
import type { Network } from "./network";

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEADING_NOISE = new Set(["arret", "arrets", "station", "l", "la", "le", "les", "a", "au", "aux", "de", "du", "des", "d", "bus", "car"]);

function cleanQuery(q: string): string {
  const tokens = normalize(q).split(" ").filter(Boolean);
  while (tokens.length && LEADING_NOISE.has(tokens[0])) tokens.shift();
  return tokens.join(" ");
}

/** "Aussonne – Grésille" → { commune: "aussonne", place: "gresille" } */
function splitName(name: string) {
  const parts = name.split(/\s+[–—-]\s+|\s*[–—]\s*/);
  if (parts.length < 2) return { commune: "", place: normalize(name) };
  return { commune: normalize(parts[0]), place: normalize(parts.slice(1).join(" ")) };
}

export type PlaceResolution =
  | { status: "ok"; stopIdxs: number[]; label: string }
  /** group = tous les candidats sont dans la commune demandée (ex. « Aussonne ») */
  | { status: "ambiguous"; candidates: number[]; group: boolean; label: string }
  | { status: "notfound"; query: string };

interface StopEntry {
  idx: number;
  full: string;
  place: string;
  commune: string;
}

const fuseCache = new WeakMap<Network, { entries: StopEntry[]; fuse: Fuse<StopEntry> }>();

function stopSearch(net: Network) {
  let c = fuseCache.get(net);
  if (!c) {
    const entries = net.stops.map((s, idx) => ({ idx, full: normalize(s.name), ...splitName(s.name) }));
    const fuse = new Fuse(entries, {
      keys: [
        { name: "full", weight: 1 },
        { name: "place", weight: 1 },
        { name: "commune", weight: 0.6 },
      ],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.4,
    });
    c = { entries, fuse };
    fuseCache.set(net, c);
  }
  return c;
}

const containsWords = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

export function resolvePlace(net: Network, raw: string | null | undefined, opts: { lineId?: string } = {}): PlaceResolution {
  const q = cleanQuery(raw ?? "");
  if (!q) return { status: "notfound", query: raw ?? "" };
  const { entries, fuse } = stopSearch(net);
  const label = raw!.trim();

  const finish = (cands: number[], group: boolean): PlaceResolution => {
    if (cands.length === 1) return { status: "ok", stopIdxs: cands, label: net.stops[cands[0]].name };
    // Sur une ligne donnée, on ne garde que les arrêts qu'elle dessert.
    if (opts.lineId) {
      const onLine = cands.filter((i) => net.stops[i].lines.includes(opts.lineId!));
      if (onLine.length === 1) return { status: "ok", stopIdxs: onLine, label: net.stops[onLine[0]].name };
      if (onLine.length > 1) cands = onLine;
    }
    return { status: "ambiguous", candidates: cands, group, label };
  };

  // 1. nom exact
  const exact = entries.filter((e) => e.full === q);
  if (exact.length) return finish(exact.map((e) => e.idx), false);

  // 2. nom de l'arrêt sans la commune, ou commune seule
  const byPlace = entries.filter((e) => e.place === q);
  if (byPlace.length) return finish(byPlace.map((e) => e.idx), false);
  const byCommune = entries.filter((e) => e.commune === q);
  if (byCommune.length) return finish(byCommune.map((e) => e.idx), true);

  // 3. mots contenus dans le nom (« gresille », « mairie »)
  const contained = entries.filter((e) => containsWords(e.full, q));
  if (contained.length) return finish(contained.map((e) => e.idx), false);

  // 4. recherche floue (fautes de frappe)
  const hits = fuse.search(q).filter((h) => (h.score ?? 1) <= 0.45);
  if (!hits.length) return { status: "notfound", query: label };
  const best = hits[0].score ?? 1;
  const second = hits[1]?.score;
  if (best <= 0.25 && (second === undefined || second - best >= 0.1)) return finish([hits[0].item.idx], false);
  if (hits.length === 1) return finish([hits[0].item.idx], false);
  return finish(hits.slice(0, 4).map((h) => h.item.idx), false);
}

export type LineResolution = { status: "ok"; lineId: string } | { status: "notfound"; query: string; suggestions: string[] };

export function resolveLine(net: Network, raw: string | number | null | undefined): LineResolution {
  const q = normalize(String(raw ?? "")).replace(/^(ligne|bus|car|l)\s*/, "");
  if (net.lineById.has(q)) return { status: "ok", lineId: q };
  const byShort = net.lines.find((l) => normalize(l.shortName) === q);
  if (byShort) return { status: "ok", lineId: byShort.id };
  const fuse = new Fuse(net.lines, { keys: ["shortName"], includeScore: true, threshold: 0.5 });
  const suggestions = fuse.search(q).map((h) => h.item.id);
  return { status: "notfound", query: String(raw ?? ""), suggestions };
}

/** Choisit un sens parmi les directions possibles d'après le texte de l'utilisateur. */
export function resolveDirection<T extends { key: string; matchTerms: string[] }>(
  dirs: T[],
  sens: string | null | undefined,
): { status: "ok"; key: string } | { status: "ambiguous" | "notfound" } {
  const q = cleanQuery(sens ?? "").replace(/^(vers|direction|sens|pour)\s+/, "");
  if (!q) return { status: "notfound" };
  const direct = dirs.filter((d) => d.matchTerms.some((t) => containsWords(normalize(t), q)));
  const pick = (list: T[]) => {
    const keys = [...new Set(list.map((d) => d.key))];
    return keys.length === 1 ? ({ status: "ok", key: keys[0] } as const) : ({ status: "ambiguous" } as const);
  };
  if (direct.length) return pick(direct);
  const items = dirs.flatMap((d) => d.matchTerms.map((t) => ({ key: d.key, term: normalize(t) })));
  const hits = new Fuse(items, { keys: ["term"], includeScore: true, ignoreLocation: true, threshold: 0.35 }).search(q);
  if (!hits.length) return { status: "notfound" };
  const bestScore = hits[0].score ?? 0;
  return pick(dirs.filter((d) => hits.some((h) => h.item.key === d.key && (h.score ?? 0) <= bestScore + 0.05)));
}
