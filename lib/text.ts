// Normalisation des noms d'arrêts : accents, abréviations, phonétique, fautes de frappe.

/** Minuscules, sans accents, tout ce qui n'est ni lettre ni chiffre devient une espace. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Abréviations courantes des noms d'arrêts (dans les deux sens : « St » ↔ « Saint »). */
const ABBREVIATIONS: Record<string, string> = {
  st: "saint",
  ste: "sainte",
  sts: "saints",
  stes: "saintes",
  av: "avenue",
  ave: "avenue",
  bd: "boulevard",
  bld: "boulevard",
  boul: "boulevard",
  pl: "place",
  chem: "chemin",
  rte: "route",
  fg: "faubourg",
  fbg: "faubourg",
  imp: "impasse",
  sq: "square",
  crf: "carrefour",
  carref: "carrefour",
  rdpt: "rond point",
  rpt: "rond point",
  hop: "hopital",
  univ: "universite",
  gal: "general",
  mal: "marechal",
  pdt: "president",
  cdt: "commandant",
  dr: "docteur",
  pr: "professeur",
  lyc: "lycee",
  coll: "college",
  gd: "grand",
  gde: "grande",
  ctre: "centre",
  cc: "centre commercial",
  egl: "eglise",
  cim: "cimetiere",
  res: "residence",
  resid: "residence",
  ham: "hameau",
  za: "zone activites",
  zi: "zone industrielle",
};

/** Petits mots ignorés lors de la comparaison mot à mot. */
const STOPWORDS = new Set(["le", "la", "les", "l", "de", "du", "des", "d", "a", "au", "aux", "et", "en", "sur", "sous"]);

/** Mots « de commande » sans valeur pour identifier un arrêt. */
const NOISE = new Set(["arret", "arrets", "station", "bus", "car", "cars", "autocar", "lio"]);

/** Forme canonique : normalisée et abréviations développées. */
export function canonical(s: string): string {
  return normalize(s)
    .split(" ")
    .map((t) => ABBREVIATIONS[t] ?? t)
    .join(" ");
}

/** Mots significatifs d'un nom (forme canonique, sans petits mots ni bruit). */
export function significantTokens(s: string): string[] {
  return canonical(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && !NOISE.has(t));
}

/** Clé phonétique simplifiée du français : « grezille » ≈ « gresille », « ciprien » ≈ « cyprien ». */
export function phonetic(word: string): string {
  let w = word;
  w = w.replace(/ph/g, "f").replace(/qu/g, "k").replace(/gu(?=[eiy])/g, "g");
  w = w.replace(/c(?=[eiy])/g, "s").replace(/g(?=[eiy])/g, "j");
  w = w.replace(/ch/g, "#").replace(/sh/g, "#");
  w = w.replace(/ck|c|q/g, "k").replace(/h/g, "").replace(/#/g, "ch");
  w = w.replace(/y/g, "i").replace(/z/g, "s").replace(/w/g, "v");
  w = w.replace(/eau|au/g, "o").replace(/ai|ei/g, "e").replace(/[ea]([nm])(?![aeiou])/g, "an");
  w = w.replace(/(.)\1+/g, "$1");
  w = w.replace(/(?<=.{2})e$/, "").replace(/(?<=.{2})[stdxp]$/, "");
  return w;
}

/** Distance d'édition (une inversion de deux lettres voisines compte pour une seule faute). */
export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Ressemblance entre un mot tapé et un mot du nom d'arrêt (0 = aucune, 1 = identique). */
export function tokenSimilarity(q: string, s: string): number {
  if (q === s) return 1;
  // Chiffres : égalité stricte (« 2 » ne doit pas valoir « 3 »).
  if (/\d/.test(q) || /\d/.test(s)) return 0;
  if (q.length >= 3 && s.startsWith(q)) return 0.9;
  if (q.length >= 3 && phonetic(q) === phonetic(s)) return 0.85;
  const allowed = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  if (!allowed) return 0;
  const d = levenshtein(q, s, allowed);
  if (d <= allowed) return d === 1 ? 0.8 : 0.7;
  // Faute + début de mot (« cypr » mal tapé) : on compare au préfixe de même longueur.
  if (q.length >= 4 && s.length > q.length && levenshtein(q, s.slice(0, q.length), 1) <= 1) return 0.7;
  return 0;
}
