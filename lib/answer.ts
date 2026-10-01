// Transforme une intention en réponse affichable. Tous les horaires sont calculés ici.
import type { Answer, AskResponse, Choice, DirectionView, LineBadge, TripView } from "./answer-types";
import { GroqError, parseWithGroq } from "./groq";
import { parseFallback, type Intent, type StructuredRequest } from "./intent";
import { REALTIME_ENABLED } from "./config";
import type { Network } from "./network";
import { resolveDirection, resolveLine, resolvePlace } from "./resolve";
import { directionsAtStop, directTrips, nextDepartures } from "./schedule";
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
  const lineStopsChoices = (headline: string): Answer => ({
    kind: "choice",
    headline,
    choices: net.stops
      .filter((s) => s.lines.includes(lineId!))
      .map((s) => ({ label: s.name, request: { ...req, intention: "prochain", arret: null, arretIds: [s.id] } })),
  });
  if (!stopIdxs.length) {
    if (!req.arret) {
      if (lineId) return lineStopsChoices(`À quel arrêt de la ${lineId} ?`);
      return { kind: "error", headline: "Précisez un arrêt.", detail: "Par exemple : « prochain 362 à Grésille ».", examples: examplesFor(net).slice(0, 2) };
    }
    const r = resolvePlace(net, req.arret, { lineId });
    if (r.status === "notfound") {
      if (lineId) return lineStopsChoices(`Je ne trouve pas l'arrêt « ${r.query} ». Arrêts de la ${lineId} :`);
      return { kind: "error", headline: `Je ne trouve pas l'arrêt « ${r.query} ».`, detail: `Arrêts de la démo : ${net.stops.map((s) => s.name).join(", ")}.` };
    }
    if (r.status === "ambiguous") {
      return {
        kind: "choice",
        headline: `Plusieurs arrêts correspondent à « ${r.label} » :`,
        choices: r.candidates.map((i) => ({
          label: net.stops[i].name,
          sub: `Ligne${net.stops[i].lines.length > 1 ? "s" : ""} ${net.stops[i].lines.join(", ")}`,
          request: { ...req, intention: "prochain", arret: null, arretIds: [net.stops[i].id] },
        })),
      };
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

function resolveSide(net: Network, req: StructuredRequest, role: "depart" | "arrivee"): Side | Answer {
  const ids = role === "depart" ? req.departIds : req.arriveeIds;
  if (ids?.length) {
    const idxs = ids.map((id) => net.stopIndex.get(id)).filter((i): i is number => i !== undefined);
    if (idxs.length) return { idxs, label: idxs.length === 1 ? net.stops[idxs[0]].name : (req[role] ?? net.stops[idxs[0]].name) };
  }
  const text = req[role];
  if (!text) {
    return role === "depart"
      ? { kind: "error", headline: "D'où partez-vous ?", detail: "Précisez le départ et l'arrivée, par exemple « de Aussonne à Arènes ».", examples: examplesFor(net).slice(1, 2) }
      : { kind: "error", headline: "Où voulez-vous aller ?", detail: "Précisez l'arrivée, par exemple « de Aussonne à Arènes ».", examples: examplesFor(net).slice(1, 2) };
  }
  const r = resolvePlace(net, text);
  const roleLabel = role === "depart" ? "départ" : "arrivée";
  if (r.status === "ok") return { idxs: r.stopIdxs, label: r.label };
  if (r.status === "notfound") {
    return { kind: "error", headline: `Je ne trouve pas l'arrêt de ${roleLabel} « ${r.query} ».`, detail: `Arrêts de la démo : ${net.stops.map((s) => s.name).join(", ")}.` };
  }
  // Commune entière (ex. « Aussonne ») : on cherche depuis tous ses arrêts.
  if (r.group) return { idxs: r.candidates, label: `${r.label.charAt(0).toUpperCase()}${r.label.slice(1)} (tous arrêts)` };
  const key = role === "depart" ? "departIds" : "arriveeIds";
  return {
    kind: "choice",
    headline: `Plusieurs arrêts de ${roleLabel} correspondent à « ${r.label} » :`,
    choices: r.candidates.map((i) => ({ label: net.stops[i].name, sub: `Ligne${net.stops[i].lines.length > 1 ? "s" : ""} ${net.stops[i].lines.join(", ")}`, request: { ...req, intention: "trajet", [key]: [net.stops[i].id] } })),
  };
}

function answerTrajet(net: Network, req: StructuredRequest, now: LocalMoment): Answer {
  const from = resolveSide(net, req, "depart");
  if ("kind" in from) return from;
  const to = resolveSide(net, req, "arrivee");
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
}

export async function ask(
  net: Network,
  body: AskBody,
  opts: { now?: LocalMoment; groq?: (q: string, net: Network) => Promise<Intent> } = {},
): Promise<AskResponse> {
  const now = opts.now ?? parisMoment();
  const base = { theoretical: !REALTIME_ENABLED, dataSource: net.meta.source, now: formatClock(now.minutes) };

  if (body.request && typeof body.request === "object") {
    return { ...base, mode: "bouton", answer: answerRequest(net, body.request as StructuredRequest, now) };
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return { ...base, mode: "repli", answer: { kind: "error", headline: "Posez une question d'horaire ou de trajet.", examples: examplesFor(net) } };
  }
  if (question.length > 300) {
    return { ...base, mode: "repli", answer: { kind: "error", headline: "Question trop longue (300 caractères maximum)." } };
  }

  let intent: Intent;
  let mode: AskResponse["mode"] = "ia";
  let modeReason: string | undefined;
  try {
    intent = await (opts.groq ?? parseWithGroq)(question, net);
  } catch (e) {
    intent = parseFallback(question, net.lines.map((l) => l.id));
    mode = "repli";
    modeReason = e instanceof GroqError ? e.reason : "IA indisponible";
  }
  return { ...base, mode, modeReason, intent, answer: answerRequest(net, intent, now) };
}
