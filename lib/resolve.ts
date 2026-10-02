// Reconnaissance des arrêts, lignes et sens, tolérante aux fautes et aux abréviations.
import Fuse from "fuse.js";
import aliasesRaw from "../data/aliases.json";
import type { Network } from "./network";
import { canonical, normalize, significantTokens, tokenSimilarity } from "./text";

export { normalize } from "./text";

const LEADING_NOISE = new Set(["arret", "arrets", "station", "l", "la", "le", "les", "a", "au", "aux", "de", "du", "des", "d", "bus", "car"]);

function cleanQuery(q: string): string {
  const tokens = normalize(q).split(" ").filter(Boolean);
  while (tokens.length && LEADING_NOISE.has(tokens[0])) tokens.shift();
  return tokens.join(" ");
}

/** "Aussonne – Grésille" → { commune: "aussonne", place: "gresille" } (formes canoniques) */
function splitName(name: string) {
  const parts = name.split(/\s+[–—-]\s+|\s*[–—]\s*/);
  if (parts.length < 2) return { commune: "", place: canonical(name) };
  return { commune: canonical(parts[0]), place: canonical(parts.slice(1).join(" ")) };
}

export type PlaceResolution =
  | { status: "ok"; stopIdxs: number[]; label: string }
  /** group = tous les candidats sont dans la commune demandée (ex. « Aussonne ») */
  | { status: "ambiguous"; candidates: number[]; group: boolean; label: string }
  /** arrêt connu du réseau mais desservi par aucune ligne de la démo */
  | { status: "elsewhere"; query: string; name: string; lines: string[] }
  /** suggestions = arrêts les plus proches (index dans net.stops) */
  | { status: "notfound"; query: string; suggestions: number[] };

// ------------------------------------------------------------------ index

interface Variant {
  tokens: string[];
}

interface Entry {
  idx: number;
  canon: string;
  place: string;
  commune: string;
  /** nom complet, nom sans commune, surnoms */
  variants: Variant[];
  /** formes sans espaces, pour « stcyprien » */
  compacts: string[];
  fuzzyText: string;
}

interface PlaceIndex {
  entries: Entry[];
  fuse: Fuse<Entry>;
}

const aliases: [string, string[]][] = Object.entries(aliasesRaw as Record<string, string[] | string>)
  .filter((e): e is [string, string[]] => !e[0].startsWith("_") && Array.isArray(e[1]))
  .map(([k, v]) => [canonical(k), v]);

const containsWords = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

function buildIndex(names: string[]): PlaceIndex {
  const entries = names.map((name, idx) => {
    const canon = canonical(name);
    const { commune, place } = splitName(name);
    const extra = aliases.filter(([k]) => containsWords(canon, k)).flatMap(([, v]) => v);
    const phrases = [name, place, ...extra];
    return {
      idx,
      canon,
      place,
      commune,
      variants: phrases.map((p) => ({ tokens: significantTokens(p) })).filter((v) => v.tokens.length),
      compacts: [...new Set([normalize(name), canon, ...extra.map(canonical)].map((x) => x.replace(/ /g, "")))],
      fuzzyText: [canon, ...extra.map(canonical)].join(" | "),
    };
  });
  const fuse = new Fuse(entries, {
    keys: [
      { name: "canon", weight: 1 },
      { name: "place", weight: 1 },
      { name: "fuzzyText", weight: 0.8 },
      { name: "commune", weight: 0.5 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4,
  });
  return { entries, fuse };
}

const indexCache = new WeakMap<Network, { served: PlaceIndex; other: PlaceIndex }>();

function indexes(net: Network) {
  let c = indexCache.get(net);
  if (!c) {
    c = { served: buildIndex(net.stops.map((s) => s.name)), other: buildIndex((net.otherStops ?? []).map((s) => s.name)) };
    indexCache.set(net, c);
  }
  return c;
}

// --------------------------------------------------------------- matching

/** Score d'un arrêt pour les mots de la requête : part des mots retrouvés (0-1) et part du nom couverte. */
function scoreEntry(e: Entry, q: string[]) {
  let best = { qScore: 0, total: 0 };
  for (const v of e.variants) {
    let sum = 0;
    const used = new Set<number>();
    for (const qt of q) {
      let m = 0, at = -1;
      v.tokens.forEach((st, i) => {
        const sim = tokenSimilarity(qt, st);
        if (sim > m) { m = sim; at = i; }
      });
      sum += m;
      if (at >= 0) used.add(at);
    }
    const qScore = sum / q.length;
    const total = qScore * 0.85 + (used.size / v.tokens.length) * 0.15;
    if (total > best.total) best = { qScore, total };
  }
  return best;
}

function rank(index: PlaceIndex, q: string[], minQ: number) {
  return index.entries
    .map((e) => ({ idx: e.idx, ...scoreEntry(e, q) }))
    .filter((r) => r.qScore >= minQ)
    .sort((a, b) => b.total - a.total);
}

function queryTokens(q: string): string[] {
  const t = significantTokens(q);
  // « s cyprien » : une lettre isolée n'aide pas, on l'ignore s'il reste d'autres mots.
  const long = t.filter((x) => x.length > 1 || /\d/.test(x));
  return long.length ? long : t;
}

type Match = { cands: number[]; group: boolean; score: number } | null;

/** Correspondances sûres : exacte, commune, mot à mot, mots collés. */
function strictMatch(index: PlaceIndex, q: string): Match {
  const qc = canonical(q);
  const { entries } = index;
  const exact = entries.filter((e) => e.canon === qc || e.place === qc);
  if (exact.length) return { cands: exact.map((e) => e.idx), group: false, score: 1 };
  const byCommune = entries.filter((e) => e.commune && e.commune === qc);
  if (byCommune.length) return { cands: byCommune.map((e) => e.idx), group: true, score: 1 };

  const qt = queryTokens(q);
  if (qt.length) {
    const ranked = rank(index, qt, 0.7);
    if (ranked.length) {
      const top = ranked[0].total;
      const close = ranked.filter((r) => top - r.total < 0.06).slice(0, 5);
      return { cands: close.map((r) => r.idx), group: false, score: top };
    }
  }

  const compact = [normalize(q), qc].map((x) => x.replace(/ /g, "")).filter((x) => x.length >= 5);
  if (compact.length) {
    const hits = entries.filter((e) => e.compacts.some((c) => compact.some((x) => c.includes(x))));
    if (hits.length && hits.length <= 5) return { cands: hits.map((e) => e.idx), group: false, score: 0.75 };
  }
  return null;
}

/** Dernier recours : recherche floue sur le nom entier. */
function fuzzyMatch(index: PlaceIndex, q: string): Match {
  const hits = index.fuse.search(canonical(q)).filter((h) => (h.score ?? 1) <= 0.45);
  if (!hits.length) return null;
  const best = hits[0].score ?? 1;
  const second = hits[1]?.score;
  if (hits.length === 1 || (best <= 0.25 && (second === undefined || second - best >= 0.1))) return { cands: [hits[0].item.idx], group: false, score: 0 };
  return { cands: hits.slice(0, 4).map((h) => h.item.idx), group: false, score: 0 };
}

/** Arrêts les plus proches, pour « Vouliez-vous dire… ? ». */
function suggestions(index: PlaceIndex, q: string): number[] {
  const out = new Set<number>();
  const qt = queryTokens(q);
  if (qt.length) for (const r of rank(index, qt, 0.4).slice(0, 3)) out.add(r.idx);
  for (const h of index.fuse.search(canonical(q))) {
    if (out.size >= 3 || (h.score ?? 1) > 0.6) break;
    out.add(h.item.idx);
  }
  return [...out].slice(0, 3);
}

export function resolvePlace(net: Network, raw: string | null | undefined, opts: { lineId?: string } = {}): PlaceResolution {
  const q = cleanQuery(raw ?? "");
  const label = (raw ?? "").trim();
  if (!q) return { status: "notfound", query: label, suggestions: [] };
  const { served, other } = indexes(net);

  const finish = ({ cands, group }: { cands: number[]; group: boolean }): PlaceResolution => {
    if (cands.length === 1) return { status: "ok", stopIdxs: cands, label: net.stops[cands[0]].name };
    // Sur une ligne donnée, on ne garde que les arrêts qu'elle dessert.
    if (opts.lineId) {
      const onLine = cands.filter((i) => net.stops[i].lines.includes(opts.lineId!));
      if (onLine.length === 1) return { status: "ok", stopIdxs: onLine, label: net.stops[onLine[0]].name };
      if (onLine.length > 1) cands = onLine;
    }
    return { status: "ambiguous", candidates: cands, group, label };
  };

  const m = strictMatch(served, q);
  // Arrêt du réseau hors des lignes de la démo, nettement plus ressemblant ?
  const o = net.otherStops?.length && !(m && m.score >= 1) ? strictMatch(other, q) : null;
  if (o && (!m || o.score > m.score + 0.1)) {
    const s = net.otherStops![o.cands[0]];
    return { status: "elsewhere", query: label, name: s.name, lines: s.lines };
  }
  if (m) return finish(m);
  const f = fuzzyMatch(served, q);
  if (f) return finish(f);
  return { status: "notfound", query: label, suggestions: suggestions(served, q) };
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
  const q = canonical(cleanQuery(sens ?? "").replace(/^(vers|direction|sens|pour)\s+/, ""));
  if (!q) return { status: "notfound" };
  const direct = dirs.filter((d) => d.matchTerms.some((t) => containsWords(canonical(t), q)));
  const pick = (list: T[]) => {
    const keys = [...new Set(list.map((d) => d.key))];
    return keys.length === 1 ? ({ status: "ok", key: keys[0] } as const) : ({ status: "ambiguous" } as const);
  };
  if (direct.length) return pick(direct);
  const items = dirs.flatMap((d) => d.matchTerms.map((t) => ({ key: d.key, term: canonical(t) })));
  const hits = new Fuse(items, { keys: ["term"], includeScore: true, ignoreLocation: true, threshold: 0.35 }).search(q);
  if (!hits.length) return { status: "notfound" };
  const bestScore = hits[0].score ?? 0;
  return pick(dirs.filter((d) => hits.some((h) => h.item.key === d.key && (h.score ?? 0) <= bestScore + 0.05)));
}
