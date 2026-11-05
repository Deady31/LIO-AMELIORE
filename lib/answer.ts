// Transforme une intention en réponse affichable. Tous les horaires sont calculés ici.
import type { Answer, AskResponse, Choice, DirectionView, FollowUp, LineBadge, TripView } from "./answer-types";
import type { StructuredRequest } from "./intent";
import { looksLikeNewQuestion, placeInReply, understand } from "./understand";
import { REALTIME_ENABLED } from "./config";
import type { Network } from "./network";
import { normalize, resolveDirection, resolveLine, resolvePlace, type PlaceResolution } from "./resolve";
import { directionsAtStop, directTrips, matchOnTrip, nextDepartures } from "./schedule";
import { dayLabel, formatClock, formatDuration, formatWait, parisMoment, parseClock, shiftDate } from "./time";
import type { LocalMoment } from "./types";

const DEMO_EXAMPLES = [
  "Prochain 362 à Grésille",
  "Comment aller de Aussonne à Arènes ?",
  "362 à Aussonne Mairie vers Merville",
  "Trajet de Merville à Borderouge",
];

/** Exemples cliquables, construits d'après les données réellement chargées. */
export function examplesFor(net: Network): string[] {
  if (net.meta.source === "demo") return DEMO_EXAMPLES;
  const line = net.lines[0];
  const trip = net.trips.filter((t) => t.line === line?.id).sort((a, b) => b.stops.length - a.stops.length)[0];
  if (!trip) return [];
  const name = (k: number) => net.stops[trip.stops[k]].name;
  const last = trip.stops.length - 1;
  return [
    `Prochain ${line.id} à ${name(Math.floor(last / 2))}`,
    `Comment aller de ${name(0)} à ${name(last)} ?`,
    `${line.id} à ${name(1)} vers ${name(0)}`,
  ];
}

const badge = (net: Network, lineId: string): LineBadge => {
  const l = net.lineById.get(lineId);
  return { id: lineId, color: l?.color ?? "#555", textColor: l?.textColor ?? "#fff" };
};

const lineList = (net: Network) => net.lines.map((l) => l.shortName).join(", ");

/** Résout un arrêt ; si le nom (souvent celui renvoyé par l'IA) ne donne rien, réessaie avec le texte tapé. */
function resolveWithAlt(net: Network, primary: string, alt: string | null | undefined, opts: { lineId?: string } = {}): PlaceResolution {
  const r = resolvePlace(net, primary, opts);
  if (r.status !== "notfound" || !alt || normalize(alt) === normalize(primary)) return r;
  const r2 = resolvePlace(net, alt, opts);
  return r2.status === "notfound" ? { ...r, suggestions: r.suggestions.length ? r.suggestions : r2.suggestions } : r2;
}

/** Arrêt connu du réseau mais hors des lignes de la démo. */
function elsewhereAnswer(net: Network, r: Extract<PlaceResolution, { status: "elsewhere" }>): Answer {
  const lines = (l: string[]) => `${l.length > 1 ? "lignes" : "ligne"} ${l.slice(0, 6).join(", ")}${l.length > 6 ? "…" : ""}`;
  const demo = `La démo ne contient que les horaires des lignes ${lineList(net)}.`;
  if (r.matches.length === 1) {
    const m = r.matches[0];
    return {
      kind: "notice",
      headline: `${m.name} n'est pas desservi par les lignes de la démo.`,
      detail: `Cet arrêt est desservi par la ${lines(m.lines)}. ${demo}`,
    };
  }
  return {
    kind: "notice",
    headline: `« ${r.query} » n'est pas desservi par les lignes de la démo.`,
    detail: `Arrêts correspondants sur le réseau : ${r.matches.map((m) => `${m.name} (${lines(m.lines)})`).join(" ; ")}. ${demo}`,
  };
}

const linesSub = (net: Network, i: number) => `Ligne${net.stops[i].lines.length > 1 ? "s" : ""} ${net.stops[i].lines.join(", ")}`;

type Slot = FollowUp["slot"];
const SLOT_IDS = { arret: "arretIds", depart: "departIds", arrivee: "arriveeIds" } as const;

/** Demande complétée par un arrêt précis (les autres champs sont gardés). */
const withStop = (req: StructuredRequest, slot: Slot, id: string): StructuredRequest => ({ ...req, [slot]: null, [SLOT_IDS[slot]]: [id] });

/** Commune d'un nom d'arrêt « Commune – Arrêt » (vide si absente). */
const communeOf = (name: string) => {
  const parts = name.split(/\s+[–—-]\s+/);
  return parts.length > 1 ? parts[0].trim() : "";
};

/**
 * Plusieurs arrêts possibles : boutons par arrêt, ou d'abord par commune quand la liste est longue
 * (« Mairie » dans dix communes). La demande reste en mémoire : une réponse tapée la complète.
 */
function stopChoices(net: Network, cands: number[], req: StructuredRequest, slot: Slot, original: string, headline: string): Answer {
  const followUp: FollowUp = { slot, pending: { ...req, [slot]: null, [SLOT_IDS[slot]]: undefined }, original, geo: slot !== "arrivee" };
  const byCommune = new Map<string, number[]>();
  for (const i of cands) {
    const c = communeOf(net.stops[i].name);
    byCommune.set(c, [...(byCommune.get(c) ?? []), i]);
  }
  if (cands.length > 5 && byCommune.size > 1) {
    return {
      kind: "choice",
      headline: `« ${original} » existe dans plusieurs communes. Laquelle ?`,
      choices: [...byCommune.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "fr"))
        .map(([c, list]) => ({
          label: c || "Autre",
          sub: `${list.length} arrêt${list.length > 1 ? "s" : ""}`,
          request: list.length === 1 ? withStop(req, slot, net.stops[list[0]].id) : { ...req, [slot]: `${c} ${original}`, [SLOT_IDS[slot]]: undefined },
        })),
      followUp,
    };
  }
  return {
    kind: "choice",
    headline,
    choices: cands.map((i) => ({ label: net.stops[i].name, sub: linesSub(net, i), request: withStop(req, slot, net.stops[i].id) })),
    followUp,
  };
}

/** L'assistant pose une question et garde la demande en mémoire. */
function question(headline: string, detail: string, req: StructuredRequest, slot: Slot, choices?: Choice[]): Answer {
  return { kind: "question", headline, detail, choices, followUp: { slot, pending: req, geo: slot !== "arrivee" } };
}

/** Arrêt introuvable : propose les plus proches plutôt qu'une erreur sèche. */
function notFoundAnswer(net: Network, r: Extract<PlaceResolution, { status: "notfound" }>, role: string, req: StructuredRequest, slot: Slot): Answer {
  if (r.suggestions.length) {
    return {
      kind: "choice",
      headline: `Je ne trouve pas exactement l'arrêt${role} « ${r.query} ». Vouliez-vous dire :`,
      choices: r.suggestions.map((i) => ({ label: net.stops[i].name, sub: linesSub(net, i), request: withStop(req, slot, net.stops[i].id) })),
      followUp: { slot, pending: { ...req, [slot]: null }, geo: slot !== "arrivee" },
    };
  }
  return {
    kind: "error",
    headline: `Je ne trouve pas l'arrêt${role} « ${r.query} ».`,
    detail: `Vérifiez le nom ou choisissez un arrêt dans l'onglet Horaires. Lignes de la démo : ${lineList(net)}.`,
  };
}

/** Instant de départ de la recherche : maintenant, ou l'heure demandée (demain si déjà passée). */
function startMoment(now: LocalMoment, heure: string | null | undefined) {
  const m = parseClock(heure);
  if (m === null) return { at: now, shift: 0, fromTime: undefined };
  if (m < now.minutes - 60) return { at: { date: shiftDate(now.date, 1), minutes: m }, shift: 1, fromTime: `demain à partir de ${formatClock(m)}` };
  return { at: { date: now.date, minutes: m }, shift: 0, fromTime: `à partir de ${formatClock(m)}` };
}

/** Libellés relatifs à l'heure réelle (« dans 7 min », « demain »). */
function relative(abs: number, shift: number, now: LocalMoment) {
  const total = abs + shift * 1440;
  const waitMin = total - now.minutes;
  return { day: dayLabel(Math.floor(total / 1440)), wait: waitMin <= 720 ? formatWait(waitMin) : "" };
}

// ------------------------------------------------------------- prochain

function answerProchain(net: Network, req: StructuredRequest, now: LocalMoment): Answer {
  let lineId: string | undefined;
  if (req.ligne) {
    const r = resolveLine(net, req.ligne);
    if (r.status === "notfound") {
      if (r.suggestions.length) {
        return {
          kind: "choice",
          headline: `La ligne ${r.query} n'est pas dans la démo. Vouliez-vous dire :`,
          choices: r.suggestions.map((id) => ({ label: `Ligne ${id}`, line: badge(net, id), request: { ...req, ligne: id } })),
        };
      }
      return { kind: "error", headline: `La ligne ${r.query} n'est pas disponible dans cette démo.`, detail: `Lignes disponibles : ${lineList(net)}.` };
    }
    lineId = r.lineId;
  }

  // Arrêt
  let stopIdxs: number[] = (req.arretIds ?? []).map((id) => net.stopIndex.get(id)).filter((i): i is number => i !== undefined);
  let stopLabel = stopIdxs.length === 1 ? net.stops[stopIdxs[0]].name : "";
  const pendingProchain: StructuredRequest = { ...req, intention: "prochain", arret: null, arretIds: undefined };
  const lineStopsChoices = (headline: string): Answer =>
    question(
      headline,
      "Touchez un arrêt, tapez son nom ou utilisez votre position.",
      pendingProchain,
      "arret",
      net.stops.filter((s) => s.lines.includes(lineId!)).map((s) => ({ label: s.name, request: withStop(pendingProchain, "arret", s.id) })),
    );
  if (!stopIdxs.length) {
    if (!req.arret) {
      if (lineId) return lineStopsChoices(`À quel arrêt de la ${lineId} ?`);
      return question("À quel arrêt ?", "Tapez le nom de l'arrêt (par exemple « Grésille ») ou utilisez votre position.", pendingProchain, "arret");
    }
    const r = resolveWithAlt(net, req.arret, req.alt?.arret, { lineId });
    if (r.status === "elsewhere") return elsewhereAnswer(net, r);
    if (r.status === "notfound") {
      if (lineId && !r.suggestions.length) return lineStopsChoices(`Je ne trouve pas l'arrêt « ${r.query} ». Arrêts de la ${lineId} :`);
      return notFoundAnswer(net, r, "", pendingProchain, "arret");
    }
    if (r.status === "ambiguous") {
      return stopChoices(net, r.candidates, pendingProchain, "arret", r.label, `Plusieurs arrêts correspondent à « ${r.label} » :`);
    }
    stopIdxs = r.stopIdxs;
    stopLabel = r.label;
  }
  const stopIds = stopIdxs.map((i) => net.stops[i].id);

  // La ligne dessert-elle l'arrêt ?
  if (lineId && !stopIdxs.some((i) => net.stops[i].lines.includes(lineId!))) {
    const others = [...new Set(stopIdxs.flatMap((i) => net.stops[i].lines))];
    if (!others.length) return { kind: "error", headline: `Aucune ligne de la démo ne dessert ${stopLabel}.` };
    return {
      kind: "choice",
      headline: `La ${lineId} ne dessert pas ${stopLabel}. Lignes disponibles à cet arrêt :`,
      choices: others.map((l) => ({ label: `Ligne ${l}`, line: badge(net, l), request: { ...req, intention: "prochain", ligne: l, arretIds: stopIds } })),
    };
  }

  // Sens
  const dirs = directionsAtStop(net, stopIdxs, lineId);
  if (!dirs.length) return { kind: "error", headline: `${stopLabel} est un terminus : aucun départ${lineId ? ` de la ${lineId}` : ""} depuis cet arrêt.` };
  let directionKey = req.directionKey && dirs.some((d) => d.key === req.directionKey) ? req.directionKey : undefined;
  if (!directionKey && req.sens) {
    const r = resolveDirection(dirs, req.sens);
    if (r.status === "ok") directionKey = r.key;
    else {
      return {
        kind: "choice",
        headline: r.status === "ambiguous" ? `Plusieurs sens correspondent à « ${req.sens} » :` : `Je ne reconnais pas le sens « ${req.sens} ». Choisissez :`,
        choices: dirs.map((d) => ({
          label: `vers ${d.label}`,
          line: badge(net, d.lineId),
          request: { ...req, intention: "prochain", ligne: d.lineId, arretIds: stopIds, sens: null, directionKey: d.key },
        })),
      };
    }
  }

  const { at, shift, fromTime } = startMoment(now, req.heure);
  const groups = nextDepartures(net, { stopIdxs, at, lineId, directionKey, limit: 4 });
  if (groups.every((g) => !g.departures.length)) {
    return {
      kind: "error",
      headline: `Aucun passage prévu à ${stopLabel}${lineId ? ` sur la ${lineId}` : ""} d'ici demain soir.`,
      detail: "Le service peut être réduit le week-end et les jours fériés.",
    };
  }
  const directions: DirectionView[] = groups.map((g) => ({
    line: badge(net, g.lineId),
    label: g.label,
    departures: g.departures.map((d) => ({ time: d.time, headsign: d.headsign, ...relative(d.abs, shift, now) })),
    request: { intention: "prochain", ligne: g.lineId, arretIds: stopIds, directionKey: `${g.lineId}|${g.direction}`, heure: req.heure ?? null },
  }));
  const first = directions.find((d) => d.departures.length)!;
  const d0 = first.departures[0];
  const when = [d0.day, d0.time].filter(Boolean).join(" ");
  return {
    kind: "departures",
    headline: `Prochain ${first.line.id} vers ${first.label} : ${when}${d0.wait ? ` (${d0.wait})` : ""}`,
    stopName: stopLabel,
    fromTime,
    directions,
  };
}

// --------------------------------------------------------------- trajet

type Side = { idxs: number[]; label: string };

/** Résolution silencieuse d'un côté du trajet (sans poser de question), pour filtrer l'autre côté. */
function quietSide(net: Network, req: StructuredRequest, role: "depart" | "arrivee"): number[] | undefined {
  const ids = role === "depart" ? req.departIds : req.arriveeIds;
  const fromIds = ids?.map((id) => net.stopIndex.get(id)).filter((i): i is number => i !== undefined);
  if (fromIds?.length) return fromIds;
  const text = req[role];
  if (!text) return undefined;
  const r = resolveWithAlt(net, text, req.alt?.[role]);
  if (r.status === "ok") return r.stopIdxs;
  if (r.status === "ambiguous" && r.group) return r.candidates;
  return undefined;
}

/** Garde les arrêts qui ont une liaison directe avec l'autre côté (s'il est connu). */
function usefulStops(net: Network, cands: number[], role: "depart" | "arrivee", other?: number[]): number[] {
  if (!other?.length) return cands;
  return cands.filter((c) => net.trips.some((t) => (role === "depart" ? matchOnTrip(t, [c], other) : matchOnTrip(t, other, [c]))));
}

function resolveSide(net: Network, req: StructuredRequest, role: "depart" | "arrivee", other?: number[]): Side | Answer {
  const ids = role === "depart" ? req.departIds : req.arriveeIds;
  if (ids?.length) {
    const idxs = ids.map((id) => net.stopIndex.get(id)).filter((i): i is number => i !== undefined);
    if (idxs.length) return { idxs, label: idxs.length === 1 ? net.stops[idxs[0]].name : (req[role] ?? net.stops[idxs[0]].name) };
  }
  const text = req[role];
  const pending: StructuredRequest = { ...req, intention: "trajet" };
  if (!text) {
    return role === "depart"
      ? question("D'où partez-vous ?", "Tapez l'arrêt de départ (par exemple « Aussonne ») ou utilisez votre position.", pending, "depart")
      : question("Où voulez-vous aller ?", "Tapez l'arrêt d'arrivée, par exemple « Arènes ».", pending, "arrivee");
  }
  const r = resolveWithAlt(net, text, req.alt?.[role]);
  if (r.status === "ok") return { idxs: r.stopIdxs, label: r.label };
  if (r.status === "elsewhere") return elsewhereAnswer(net, r);
  if (r.status === "notfound") return notFoundAnswer(net, r, role === "depart" ? " de départ" : " d'arrivée", pending, role);
  // Commune entière (ex. « Aussonne ») : on cherche depuis tous ses arrêts.
  if (r.group) return { idxs: r.candidates, label: `${r.label.charAt(0).toUpperCase()}${r.label.slice(1)} (tous arrêts)` };
  // Ne proposer que les arrêts utiles : ceux qui ont une liaison directe avec l'autre côté.
  const useful = usefulStops(net, r.candidates, role, other);
  if (useful.length === 1) return { idxs: useful, label: net.stops[useful[0]].name };
  const cands = useful.length ? useful : r.candidates;
  return stopChoices(net, cands, pending, role, r.label, `Plusieurs arrêts ${role === "depart" ? "de départ" : "d'arrivée"} correspondent à « ${r.label} » :`);
}

function answerTrajet(net: Network, req: StructuredRequest, now: LocalMoment): Answer {
  // Arrivée donnée mais introuvable : le dire tout de suite, plutôt que demander le départ pour rien.
  if (!req.depart && !req.departIds?.length && req.arrivee) {
    const to = resolveSide(net, req, "arrivee");
    if ("kind" in to && to.kind !== "question") return to;
  }
  const from = resolveSide(net, req, "depart", quietSide(net, req, "arrivee"));
  if ("kind" in from) return from;
  const to = resolveSide(net, req, "arrivee", from.idxs);
  if ("kind" in to) return to;
  if (from.idxs.every((i) => to.idxs.includes(i)) || to.idxs.every((i) => from.idxs.includes(i))) {
    return { kind: "error", headline: "Le départ et l'arrivée désignent le même arrêt.", detail: `${from.label} → ${to.label}` };
  }

  const { at, shift, fromTime } = startMoment(now, req.heure);
  const r = directTrips(net, { fromIdxs: from.idxs, toIdxs: to.idxs, at, limit: 5 });
  if (r.status === "no-direct") {
    return {
      kind: "no-direct",
      headline: "Pas de trajet direct sur les lignes de la démo",
      detail: `Aucune course ne relie directement ${from.label} à ${to.label} (lignes ${lineList(net)}). Les correspondances ne sont pas calculées.`,
    };
  }
  if (r.status === "none-soon") {
    return {
      kind: "error",
      headline: `Liaison directe par la ${r.lines.join(" / ")}, mais aucun départ prévu d'ici demain soir.`,
      detail: "Le service peut être réduit le week-end et les jours fériés.",
    };
  }
  const trips: TripView[] = r.trips.map((t) => ({
    line: badge(net, t.lineId),
    headsign: t.headsign,
    fromStop: t.fromStop,
    toStop: t.toStop,
    depTime: t.depTime,
    arrTime: t.arrTime,
    duration: formatDuration(t.durationMin),
    stopsCount: t.stopsCount,
    ...relative(t.depAbs, shift, now),
  }));
  const t0 = trips[0];
  return {
    kind: "trips",
    headline: `Ligne ${t0.line.id} : départ ${[t0.day, t0.depTime].filter(Boolean).join(" ")}, arrivée ${t0.arrTime} (${t0.duration})`,
    from: from.label,
    to: to.label,
    fromTime,
    trips,
  };
}

// ----------------------------------------------------------------- entrée

export function answerRequest(net: Network, req: StructuredRequest, now: LocalMoment): Answer {
  const intention = req.intention ?? (req.departIds || req.arriveeIds ? "trajet" : req.arretIds ? "prochain" : null);
  if (intention === "prochain") return answerProchain(net, req, now);
  if (intention === "trajet") return answerTrajet(net, req, now);
  return {
    kind: "error",
    headline: "Je n'ai pas compris la demande.",
    detail: "Je réponds aux prochains passages et aux trajets directs sur les lignes de la démo.",
    examples: examplesFor(net),
  };
}

export interface AskBody {
  question?: unknown;
  request?: unknown;
  /** question en attente posée par l'assistant (la phrase tapée la complète) */
  followUp?: unknown;
  /** position de l'utilisateur, pour proposer les arrêts les plus proches */
  near?: unknown;
}

const SLOTS = new Set(["arret", "depart", "arrivee"]);

function readFollowUp(v: unknown): FollowUp | null {
  if (!v || typeof v !== "object") return null;
  const f = v as FollowUp;
  if (!SLOTS.has(f.slot) || !f.pending || typeof f.pending !== "object") return null;
  return f;
}

function readNear(v: unknown): { lat: number; lon: number } | null {
  if (!v || typeof v !== "object") return null;
  const { lat, lon } = v as { lat: unknown; lon: unknown };
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** La réponse tapée complète la demande en attente. */
export function fillFollowUp(net: Network, f: FollowUp, reply: string): StructuredRequest {
  const place = placeInReply(reply, net);
  let text = place;
  // « mairie » + « Merville » → « Merville mairie », si cela désigne bien un seul arrêt.
  if (f.original) {
    const combined = `${place} ${f.original}`;
    const r = resolvePlace(net, combined);
    if (r.status === "ok" || (r.status === "ambiguous" && r.group)) text = combined;
  }
  return { ...f.pending, [f.slot]: text, [SLOT_IDS[f.slot]]: undefined };
}

const MAX_NEAR_M = 3000;

function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

/** Arrêts de la démo les plus proches de l'utilisateur, utiles pour la demande en cours. */
export function answerNear(net: Network, f: FollowUp, pos: { lat: number; lon: number }): Answer {
  let cands = net.stops.map((s, i) => ({ i, d: distanceM(pos, s) })).filter((c) => c.d <= MAX_NEAR_M);
  if (f.slot !== "arret") {
    const role = f.slot;
    const other = quietSide(net, f.pending, role === "depart" ? "arrivee" : "depart");
    const useful = new Set(usefulStops(net, cands.map((c) => c.i), role, other));
    if (useful.size) cands = cands.filter((c) => useful.has(c.i));
  }
  cands.sort((a, b) => a.d - b.d);
  if (!cands.length) {
    return {
      kind: "error",
      headline: "Aucun arrêt de la démo à moins de 3 km de votre position.",
      detail: "Tapez plutôt le nom de l'arrêt.",
    };
  }
  const fmt = (d: number) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1).replace(".", ",")} km`);
  return {
    kind: "choice",
    headline: "Arrêts les plus proches de vous :",
    choices: cands.slice(0, 3).map((c) => ({
      label: net.stops[c.i].name,
      sub: `à ${fmt(c.d)} · ${linesSub(net, c.i)}`,
      request: withStop(f.pending, f.slot, net.stops[c.i].id),
    })),
    followUp: { ...f, geo: false },
  };
}

export async function ask(
  net: Network,
  body: AskBody,
  opts: { now?: LocalMoment } = {},
): Promise<AskResponse> {
  const now = opts.now ?? parisMoment();
  const base = { theoretical: !REALTIME_ENABLED, dataSource: net.meta.source, now: formatClock(now.minutes) };

  const followUp = readFollowUp(body.followUp);
  const near = readNear(body.near);
  if (followUp && near) {
    return { ...base, mode: "bouton", answer: answerNear(net, followUp, near) };
  }
  if (body.request && typeof body.request === "object") {
    return { ...base, mode: "bouton", answer: answerRequest(net, body.request as StructuredRequest, now) };
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return { ...base, mode: "regles", answer: { kind: "error", headline: "Posez une question d'horaire ou de trajet.", examples: examplesFor(net) } };
  }
  if (question.length > 300) {
    return { ...base, mode: "regles", answer: { kind: "error", headline: "Question trop longue (300 caractères maximum)." } };
  }

  // Réponse à une question de l'assistant : elle complète la demande en mémoire.
  if (followUp && !looksLikeNewQuestion(question, net)) {
    const req = fillFollowUp(net, followUp, question);
    return { ...base, mode: "regles", answer: answerRequest(net, req, now) };
  }
  // Analyse sans modèle de langage : arrêts repérés dans la phrase, rôle donné par les mots voisins.
  const intent = understand(question, net);
  return { ...base, mode: "regles", intent, answer: answerRequest(net, intent, now) };
}
