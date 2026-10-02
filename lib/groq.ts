// Extraction d'intention par Groq. Le LLM ne calcule jamais d'horaire.
import type { Network } from "./network";
import { sanitizeIntent, type Intent } from "./intent";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
export const GROQ_TIMEOUT_MS = 4000;

export class GroqError extends Error {
  constructor(
    message: string,
    /** raison lisible affichée à l'utilisateur */
    readonly reason: string,
  ) {
    super(message);
  }
}

function systemPrompt(net: Network): string {
  const lines = net.lines.map((l) => `${l.shortName} (${l.longName})`).join(" ; ");
  const stops = net.stops.map((s) => s.name).join(" ; ");
  return [
    "Tu analyses des questions sur les bus régionaux de Haute-Garonne.",
    "Réponds UNIQUEMENT par un objet JSON avec exactement ces clés :",
    '{"intention": "prochain" | "trajet" | null, "ligne": string|null, "arret": string|null, "depart": string|null, "arrivee": string|null, "sens": string|null, "heure": "HH:MM"|null}',
    "- prochain : l'utilisateur veut le prochain passage d'une ligne ou à un arrêt (remplis ligne, arret, sens si précisé).",
    "- trajet : l'utilisateur veut aller d'un lieu à un autre (remplis depart et arrivee).",
    "- sens : destination ou direction citée (« vers Toulouse » → \"Toulouse\").",
    "- heure : seulement si une heure est demandée (« à 18h » → \"18:00\").",
    "- Pour arret, depart et arrivee : si tu reconnais un arrêt de la liste ci-dessous, renvoie son nom EXACT tel qu'écrit dans la liste,",
    "  quelle que soit l'orthographe de l'utilisateur (abréviations « St » = « Saint », « Av » = « Avenue », accents, fautes).",
    "  Sinon, recopie le nom tel que l'utilisateur l'a écrit (il peut exister ailleurs sur le réseau).",
    "- Ne calcule JAMAIS d'horaire, ne donne aucune autre clé, mets null si l'information manque.",
    "- Hors sujet → intention null.",
    `Lignes : ${lines}.`,
    `Arrêts : ${stops}.`,
  ].join("\n");
}

export async function parseWithGroq(question: string, net: Network, apiKey = process.env.GROQ_API_KEY): Promise<Intent> {
  if (!apiKey) throw new GroqError("GROQ_API_KEY absente", "clé IA non configurée");
  const ctrl = new AbortController();
  // Le délai couvre toute la requête, lecture du corps comprise.
  const timer = setTimeout(() => ctrl.abort(), GROQ_TIMEOUT_MS);
  let content: string | undefined;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt(net) },
          { role: "user", content: question.slice(0, 300) },
        ],
      }),
    });
    if (res.status === 429) throw new GroqError("429", "limite d'utilisation de l'IA atteinte");
    if (!res.ok) throw new GroqError(`HTTP ${res.status}`, `erreur du service IA (${res.status})`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    content = body?.choices?.[0]?.message?.content;
  } catch (e) {
    if (e instanceof GroqError) throw e;
    if (ctrl.signal.aborted) throw new GroqError("timeout", "IA trop lente (> 4 s)");
    throw new GroqError(String(e), "IA injoignable");
  } finally {
    clearTimeout(timer);
  }
  if (!content) throw new GroqError("réponse vide", "réponse IA vide");
  try {
    return sanitizeIntent(JSON.parse(content));
  } catch (e) {
    throw new GroqError(String(e), "réponse IA illisible");
  }
}
