// Compréhension d'une phrase libre, sans modèle de langage.
// 1. On repère dans la phrase les noms d'arrêts connus (repérage strict, pas de recherche floue).
// 2. Les petits mots juste avant chaque arrêt donnent son rôle : départ, arrivée, sens, lieu.
// 3. Les mots-clés (« aller », « prochain », « passe »…) donnent l'intention.
import { EMPTY_INTENT, parseFallback, type Intent } from "./intent";
import type { Network } from "./network";
import { spotPlace } from "./resolve";
import { normalize } from "./text";

type Role = "from" | "to" | "dir" | "at" | "none";
interface Mention {
  text: string;
  start: number;
  end: number;
  role: Role;
}

// --------------------------------------------------------------- nombres dits en toutes lettres

const UNITS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const TENS: Record<string, number> = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };

/** « trois cent soixante deux » → « 362 » (0 à 999, suffisant pour des numéros de ligne). */
export function wordsToNumbers(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i, total = 0, cur = 0, used = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t === "et" && used && j + 1 < tokens.length && (UNITS[tokens[j + 1]] !== undefined)) { j++; continue; }
      if (UNITS[t] !== undefined) { cur += UNITS[t]; used = true; j++; continue; }
      if (TENS[t] !== undefined) { cur += TENS[t]; used = true; j++; continue; }
      if (t === "cent" || t === "cents") { cur = (cur || 1) * 100; used = true; j++; continue; }
      if (t === "quatre" && tokens[j + 1]?.startsWith("vingt")) { cur += 80; j += 2; used = true; continue; }
      break;
    }
    // « un » / « une » seuls sont des articles, pas des nombres.
    const single = j - i === 1 && (tokens[i] === "un" || tokens[i] === "une");
    if (used && !single) {
      total += cur;
      out.push(String(total));
      i = j;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out;
}

// --------------------------------------------------------------- vocabulaire

// « va » exclu : « ça va » est trop courant pour signaler un trajet.
const TRAJET_KW = new Set(["aller", "vais", "trajet", "itineraire", "rentrer", "rentre", "rejoindre", "comment", "habite", "travaille", "rendre"]);
const PROCHAIN_KW = new Set(["prochain", "prochains", "prochaine", "passe", "passent", "passage", "passages", "horaire", "horaires", "heure", "quand", "depart", "departs", "part"]);
const TRANSPORT_KW = new Set([...TRAJET_KW, ...PROCHAIN_KW, "bus", "car", "cars", "ligne", "arret", "direction", "station", "autocar"]);

/** Mots qui ne peuvent pas commencer ni finir un nom d'arrêt. */
const EDGE = new Set([
  ...TRANSPORT_KW, "le", "la", "les", "l", "de", "du", "des", "d", "a", "au", "aux", "en", "et", "ou", "vers", "pour", "depuis", "jusqu",
  "je", "j", "suis", "veux", "voudrais", "dois", "il", "elle", "on", "c", "est", "qui", "que", "quel", "quelle", "quels", "dis", "moi",
  "chez", "partant", "pars", "sens", "euh", "bah", "ben", "alors", "demain", "aujourd", "hui", "matin", "soir", "maintenant", "prendre",
  "s", "il", "y", "a", "t", "un", "une", "mon", "ma", "me", "te", "plait", "stp", "svp", "merci",
]);

/** Petits mots ignorés en remontant vers l'indice de rôle. */
const SKIP = new Set(["la", "le", "l", "les", "arret", "station", "chez", "moi", "lui", "elle"]);

const CUES: [string[], Role][] = [
  ["en partant de", "from"], ["en partant d", "from"], ["partant de", "from"], ["partant d", "from"], ["part de", "from"], ["pars de", "from"],
  ["je suis a", "from"], ["je suis au", "from"], ["je suis aux", "from"], ["habite a", "from"], ["habite au", "from"],
  ["depuis", "from"], ["de", "from"], ["du", "from"], ["d", "from"], ["des", "from"],
  ["en direction de", "dir"], ["en direction d", "dir"], ["direction", "dir"], ["vers", "dir"], ["pour", "dir"], ["sens", "dir"],
  ["jusqu a", "to"], ["jusqu au", "to"], ["jusqu aux", "to"], ["travaille a", "to"], ["travaille au", "to"],
  ["a", "at"], ["au", "at"], ["aux", "at"],
].map(([p, r]) => [(p as string).split(" "), r as Role]);

function roleBefore(tokens: string[], start: number): Role {
  let k = start;
  while (k > 0 && SKIP.has(tokens[k - 1])) k--;
  let best: [number, Role] = [0, "none"];
  for (const [cue, role] of CUES) {
    if (cue.length > k || cue.length <= best[0]) continue;
    if (cue.every((w, n) => tokens[k - cue.length + n] === w)) best = [cue.length, role];
  }
  return best[1];
}

/** Repère les arrêts cités : spans les plus longs d'abord, de gauche à droite. */
function findMentions(net: Network, tokens: string[]): Mention[] {
  const found: Mention[] = [];
  let i = 0;
  while (i < tokens.length) {
    let taken = 0;
    for (let len = Math.min(6, tokens.length - i); len >= 1 && !taken; len--) {
      const span = tokens.slice(i, i + len);
      const last = span[span.length - 1];
      // « aux sonnes » (dictée de « Aussonne ») : on essaie aussi le mot recollé.
      const glued = (span[0] === "aux" || span[0] === "au" || span[0] === "o") && len >= 2 ? ["au" + span[1], ...span.slice(2)] : null;
      const candidates = [EDGE.has(span[0]) || EDGE.has(last) ? null : span, glued && !EDGE.has(glued[glued.length - 1]) ? glued : null];
      for (const c of candidates) {
        if (c && spotPlace(net, c.join(" ")) > 0) {
          found.push({ text: c.join(" "), start: i, end: i + len, role: roleBefore(tokens, i) });
          taken = len;
          break;
        }
      }
    }
    i += taken || 1;
  }
  return found;
}

// --------------------------------------------------------------- analyse

export function understand(question: string, net: Network): Intent {
  const knownLines = net.lines.map((l) => l.id);
  const intent: Intent = { ...EMPTY_INTENT };
  let text = question.toLowerCase().replace(/[’']/g, " ");

  // Flèche « Aussonne -> Arènes » : tournure explicite, gérée par l'analyse classique.
  if (/(->|→|=>)/.test(text)) return parseFallback(question, knownLines);

  // Heure : « à 18h », « 7h05 », « 17:42 »
  const h = /(?:\b(?:a|à|vers|pour|apres|après|des|dès)\s+)?\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/.exec(text);
  if (h) {
    intent.heure = `${h[1].padStart(2, "0")}:${h[2] ?? "00"}`;
    text = text.replace(h[0], " ");
  }

  let tokens = wordsToNumbers(normalize(text).split(" ").filter(Boolean));

  // Ligne : un numéro connu, ou « ligne X »
  const li = tokens.findIndex((t) => knownLines.includes(t));
  // Sinon le premier nombre : une ligne inconnue doit être signalée, pas ignorée.
  const ln = li >= 0 ? li : tokens.findIndex((t) => /^\d{1,4}$/.test(t));
  if (ln >= 0) {
    intent.ligne = tokens[ln];
    tokens = [...tokens.slice(0, ln), ...tokens.slice(ln + 1)];
  }

  const has = (set: Set<string>) => tokens.some((t) => set.has(t));
  const trajetKw = has(TRAJET_KW);
  const prochainKw = has(PROCHAIN_KW) || !!intent.ligne;
  const mentions = findMentions(net, tokens);

  // Rien de reconnu : hors sujet si aucun mot de transport, sinon analyse classique (recherche floue).
  if (!mentions.length) {
    if (!has(TRANSPORT_KW) && !intent.ligne) return { ...EMPTY_INTENT };
    const old = parseFallback(question, knownLines);
    return { ...old, heure: old.heure ?? intent.heure };
  }

  const dirMention = mentions.find((m) => m.role === "dir");
  const fromMention = mentions.find((m) => m.role === "from");

  // Prochain passage : un seul arrêt, ou un arrêt + un sens (« à Grésille vers Toulouse »).
  const isProchain =
    !trajetKw &&
    (mentions.length === 1 || (mentions.length === 2 && !!dirMention && !(fromMention && mentions.some((m) => m.role === "at"))));
  if (isProchain) {
    intent.intention = "prochain";
    const stop = mentions.length === 1 ? mentions[0] : mentions.find((m) => m !== dirMention)!;
    intent.arret = stop.text;
    if (mentions.length === 2) intent.sens = dirMention!.text;
    return intent;
  }

  // Trajet : rôle donné par l'indice, sinon par l'ordre (premier = départ).
  intent.intention = "trajet";
  if (mentions.length === 1) {
    const m = mentions[0];
    if (m.role === "from") intent.depart = m.text;
    else intent.arrivee = m.text;
    // L'autre côté n'est pas un arrêt connu (« de Paris à Arènes ») : on le garde tel quel
    // pour pouvoir dire lequel est introuvable, au lieu de l'oublier.
    const old = parseFallback(question, knownLines);
    const other = intent.depart ? old.arrivee : old.depart;
    if (other && normalize(other) !== normalize(m.text)) {
      if (intent.depart) intent.arrivee = other;
      else intent.depart = other;
    }
    return intent;
  }
  const from = fromMention ?? mentions.find((m) => m.role !== "to" && m.role !== "dir" && m.role !== "at") ?? mentions[0];
  const to = mentions.find((m) => m !== from && (m.role === "to" || m.role === "dir" || m.role === "at")) ?? mentions.find((m) => m !== from)!;
  intent.depart = from.text;
  intent.arrivee = to.text;
  return intent;
}
