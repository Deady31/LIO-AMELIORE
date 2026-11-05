// Suggestions d'arrêts pendant la frappe : on cherche sur la fin de la phrase en cours de saisie.
import type { Network } from "./network";
import { suggestPlaces, type PlaceSuggestion } from "./resolve";
import { significantTokens } from "./text";

export interface SuggestResult {
  /** morceau de la saisie (tel que tapé) que le choix d'une suggestion remplace */
  fragment: string;
  items: PlaceSuggestion[];
}

const MAX_WORDS = 3;
const MIN_CHARS = 3;

export function suggestFor(net: Network, text: string): SuggestResult {
  const trimmedEnd = text.replace(/\s+$/, "");
  // Pas de suggestion quand l'utilisateur a fini le mot (espace final) : il passe au suivant.
  if (trimmedEnd.length !== text.length) return { fragment: "", items: [] };
  const words = trimmedEnd.split(/\s+/).filter(Boolean).slice(-MAX_WORDS);
  for (let len = words.length; len >= 1; len--) {
    const suffix = words.slice(-len);
    // Le fragment ne commence jamais par un petit mot ou un mot de commande (« bus », « à », « le »…).
    if (significantTokens(suffix[0]).length === 0) continue;
    const fragment = suffix.join(" ");
    if (fragment.replace(/\s/g, "").length < MIN_CHARS) continue;
    const items = suggestPlaces(net, fragment);
    if (items.length) return { fragment, items };
  }
  return { fragment: "", items: [] };
}
