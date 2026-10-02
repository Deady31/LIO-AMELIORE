// Intention extraite d'une question (par le LLM ou par le repli sans IA).
import { normalize } from "./resolve";

export type Intention = "prochain" | "trajet";

export interface Intent {
  intention: Intention | null;
  ligne: string | null;
  arret: string | null;
  depart: string | null;
  arrivee: string | null;
  sens: string | null;
  /** "HH:MM" */
  heure: string | null;
}

/** Requête structurée envoyée par un bouton de choix (pas de LLM). */
export interface StructuredRequest extends Partial<Intent> {
  arretIds?: string[];
  departIds?: string[];
  arriveeIds?: string[];
  directionKey?: string;
  /** noms d'arrêts extraits du texte brut, essayés si ceux de l'IA ne correspondent à rien */
  alt?: { arret?: string | null; depart?: string | null; arrivee?: string | null };
}

export const EMPTY_INTENT: Intent = { intention: null, ligne: null, arret: null, depart: null, arrivee: null, sens: null, heure: null };

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && !/^(null|none|undefined|aucun|aucune)$/i.test(s) ? s : null;
};

/** Valide et nettoie la sortie JSON du LLM ; lève une erreur si inutilisable. */
export function sanitizeIntent(raw: unknown): Intent {
  if (!raw || typeof raw !== "object") throw new Error("réponse IA non JSON");
  const o = raw as Record<string, unknown>;
  const intention = str(o.intention)?.toLowerCase();
  if (intention !== "prochain" && intention !== "trajet" && intention !== null && intention !== undefined) {
    throw new Error(`intention inconnue : ${intention}`);
  }
  let heure = str(o.heure);
  const m = heure ? /^(\d{1,2})\s*[h:]\s*(\d{2})?/i.exec(heure) : null;
  heure = m ? `${m[1].padStart(2, "0")}:${m[2] ?? "00"}` : null;
  return {
    intention: (intention as Intention) ?? null,
    ligne: str(o.ligne)?.replace(/^ligne\s*/i, "") ?? null,
    arret: str(o.arret),
    depart: str(o.depart),
    arrivee: str(o.arrivee),
    sens: str(o.sens),
    heure,
  };
}

// ------------------------------------------------------------ repli sans IA

const TRAJET_WORDS = /\b(aller|trajet|itineraire|rejoindre|comment|me rendre|se rendre)\b/;
const PROCHAIN_WORDS = /\b(prochain|prochains|prochaine|passage|passages|horaire|horaires|quand|depart|departs|passe)\b/;
const FILLER = new Set([
  "prochain", "prochains", "prochaine", "passage", "passages", "horaire", "horaires", "quand", "passe", "le", "la", "les", "l",
  "du", "de", "des", "d", "bus", "car", "ligne", "a", "au", "aux", "arret", "est", "c", "quel", "quelle", "il", "y", "un", "une",
  "depart", "departs", "pour", "moi", "donne", "donner", "dis", "je", "veux", "voudrais", "savoir", "s", "il", "te", "plait", "stp",
]);

/**
 * Analyse par règles quand le LLM est indisponible. Les noms d'arrêts et de lignes
 * extraits sont ensuite rapprochés des données par fuse.js (lib/resolve.ts).
 */
export function parseFallback(question: string, knownLines: string[]): Intent {
  const intent: Intent = { ...EMPTY_INTENT };
  let text = question.toLowerCase().replace(/[’']/g, " ");

  // heure : « à 18h », « 7h05 », « 17:42 »
  const h = /(?:\b(?:a|à|vers|pour|apres|après|des|dès)\s+)?\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/.exec(text);
  if (h) {
    intent.heure = `${h[1].padStart(2, "0")}:${h[2] ?? "00"}`;
    text = text.replace(h[0], " ");
  }

  // flèches « Aussonne -> Arènes »
  const arrow = /^(.*?)\s*(?:->|→|=>|>)\s*(.*)$/.exec(text);
  let n = normalize(text);

  // ligne : un nombre connu, ou « ligne X »
  const numbers = n.match(/\b\d{1,4}\b/g) ?? [];
  const lineToken = numbers.find((x) => knownLines.includes(x)) ?? /\bligne\s+(\w+)/.exec(n)?.[1] ?? numbers[0] ?? null;
  if (lineToken) {
    intent.ligne = lineToken;
    n = ` ${n} `.replace(new RegExp(`\\s(?:ligne\\s+)?${lineToken}\\s`), " ").trim();
  }

  const wantsTrajet = TRAJET_WORDS.test(n) || !!arrow;
  const wantsProchain = PROCHAIN_WORDS.test(n) || !!intent.ligne;

  if (arrow && arrow[1].trim() && arrow[2].trim()) {
    intent.intention = "trajet";
    intent.depart = normalize(arrow[1]).replace(/^((trajet|itineraire|comment|aller|de|depuis|du|d)\s+)+/, "") || null;
    intent.arrivee = normalize(arrow[2]) || null;
    return intent;
  }

  if (wantsTrajet || !wantsProchain) {
    // « de X à Y », « depuis X jusqu'à Y »
    const fromTo = /\b(?:de|depuis|du|d)\s+(.+?)\s+(?:a|au|aux|jusqu a|vers|pour)\s+(.+)$/.exec(n);
    // « aller à Y depuis X »
    const toFrom = /\b(?:a|au|aux|vers)\s+(.+?)\s+(?:depuis|en partant de|de|du)\s+(.+)$/.exec(n);
    if (fromTo && !/\bdepuis\b/.test(fromTo[2])) {
      intent.intention = "trajet";
      intent.depart = fromTo[1].trim();
      intent.arrivee = fromTo[2].trim();
      return intent;
    }
    if (toFrom) {
      intent.intention = "trajet";
      intent.arrivee = toFrom[1].trim();
      intent.depart = toFrom[2].trim();
      return intent;
    }
    if (wantsTrajet) {
      intent.intention = "trajet";
      const onlyTo = /\b(?:a|au|aux|vers|pour)\s+(.+)$/.exec(n);
      if (onlyTo) intent.arrivee = onlyTo[1].trim();
      return intent;
    }
  }

  // prochain passage : « … à X vers Y »
  intent.intention = "prochain";
  const sens = /\b(?:vers|direction|sens|en direction de)\s+(.+)$/.exec(n);
  if (sens) {
    intent.sens = sens[1].trim();
    n = n.slice(0, sens.index).trim();
  }
  const at = /\b(?:a|au|aux|arret)\s+(.+)$/.exec(n);
  const rest = (at ? at[1] : n)
    .split(" ")
    .filter((t) => t && !FILLER.has(t))
    .join(" ");
  intent.arret = rest || null;
  return intent;
}
