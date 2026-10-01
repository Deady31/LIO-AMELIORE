// Calculs d'horaires : tout est fait ici, jamais par le LLM.
import type { Network } from "./network";
import { formatClock, shiftDate, weekdayIndex } from "./time";
import type { LocalMoment, Service, Trip } from "./types";

export function isServiceActive(svc: Service | undefined, ymd: string): boolean {
  if (!svc) return false;
  if (svc.remove.includes(ymd)) return false;
  if (svc.add.includes(ymd)) return true;
  if (!svc.start || ymd < svc.start || ymd > svc.end) return false;
  return svc.days[weekdayIndex(ymd)] === "1";
}

/** Jours de service à examiner : la veille (courses après minuit), le jour même, le lendemain. */
const DAY_OFFSETS = [-1, 0, 1] as const;

function activeTrips(net: Network, at: LocalMoment, filter: (t: Trip) => boolean) {
  const out: { trip: Trip; base: number }[] = [];
  for (const offset of DAY_OFFSETS) {
    const ymd = shiftDate(at.date, offset);
    const cache = new Map<string, boolean>();
    for (const trip of net.trips) {
      if (!filter(trip)) continue;
      let active = cache.get(trip.service);
      if (active === undefined) {
        active = isServiceActive(net.services[trip.service], ymd);
        cache.set(trip.service, active);
      }
      if (active) out.push({ trip, base: offset * 1440 });
    }
  }
  return out;
}

export interface Departure {
  tripId: string;
  lineId: string;
  headsign: string;
  /** minutes depuis minuit du jour de `at` (≥ 1440 = lendemain) */
  abs: number;
  time: string;
  dayOffset: number;
  waitMin: number;
}

export interface DirectionGroup {
  lineId: string;
  direction: 0 | 1;
  /** libellé du sens : destination la plus fréquente */
  label: string;
  /** toutes les destinations et arrêts en aval, pour reconnaître un « sens » */
  matchTerms: string[];
  departures: Departure[];
}

function toDeparture(trip: Trip, abs: number, at: LocalMoment): Departure {
  return {
    tripId: trip.id,
    lineId: trip.line,
    headsign: trip.headsign,
    abs,
    time: formatClock(abs),
    dayOffset: Math.floor(abs / 1440),
    waitMin: abs - at.minutes,
  };
}

/** Sens (ligne + direction) desservant un arrêt, avec leur libellé. Indépendant de la date. */
export function directionsAtStop(net: Network, stopIdxs: number[], lineId?: string) {
  const groups = new Map<string, { lineId: string; direction: 0 | 1; headsigns: Map<string, number>; downstream: Set<string> }>();
  for (const trip of net.trips) {
    if (lineId && trip.line !== lineId) continue;
    for (let i = 0; i < trip.stops.length - 1; i++) {
      if (!stopIdxs.includes(trip.stops[i])) continue;
      const key = `${trip.line}|${trip.direction}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { lineId: trip.line, direction: trip.direction, headsigns: new Map(), downstream: new Set() }));
      g.headsigns.set(trip.headsign, (g.headsigns.get(trip.headsign) ?? 0) + 1);
      for (let j = i + 1; j < trip.stops.length; j++) g.downstream.add(net.stops[trip.stops[j]].name);
      break;
    }
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    lineId: g.lineId,
    direction: g.direction,
    label: [...g.headsigns.entries()].sort((a, b) => b[1] - a[1])[0][0],
    matchTerms: [...g.headsigns.keys(), ...g.downstream],
  }));
}

/**
 * Prochains passages à un arrêt (un ou plusieurs quais/lieux), groupés par ligne et sens.
 * L'arrêt terminus d'une course (arrivée seule) n'est pas un départ.
 */
export function nextDepartures(
  net: Network,
  opts: { stopIdxs: number[]; at: LocalMoment; lineId?: string; directionKey?: string; limit?: number },
): DirectionGroup[] {
  const { stopIdxs, at, lineId, directionKey, limit = 3 } = opts;
  const dirs = directionsAtStop(net, stopIdxs, lineId).filter((d) => !directionKey || d.key === directionKey);
  const byKey = new Map<string, Departure[]>(dirs.map((d) => [d.key, []]));

  for (const { trip, base } of activeTrips(net, at, (t) => !lineId || t.line === lineId)) {
    const list = byKey.get(`${trip.line}|${trip.direction}`);
    if (!list) continue;
    for (let i = 0; i < trip.stops.length - 1; i++) {
      if (!stopIdxs.includes(trip.stops[i])) continue;
      const abs = base + trip.dep[i];
      if (abs >= at.minutes) list.push(toDeparture(trip, abs, at));
    }
  }

  return dirs
    .map((d) => ({
      lineId: d.lineId,
      direction: d.direction,
      label: d.label,
      matchTerms: d.matchTerms,
      departures: byKey
        .get(d.key)!
        .sort((a, b) => a.abs - b.abs)
        .filter((dep, i, arr) => i === 0 || dep.abs !== arr[i - 1].abs || dep.lineId !== arr[i - 1].lineId)
        .slice(0, limit),
    }))
    .sort((a, b) => (a.departures[0]?.abs ?? Infinity) - (b.departures[0]?.abs ?? Infinity));
}

export interface DirectTrip {
  tripId: string;
  lineId: string;
  headsign: string;
  fromStop: string;
  toStop: string;
  depAbs: number;
  arrAbs: number;
  depTime: string;
  arrTime: string;
  dayOffset: number;
  durationMin: number;
  waitMin: number;
  stopsCount: number;
}

/**
 * Pour une course : premier arrêt d'arrivée situé après un arrêt de départ,
 * et le dernier arrêt de départ qui le précède (trajet le plus court sur la course).
 */
export function matchOnTrip(trip: Trip, fromIdxs: number[], toIdxs: number[]): [number, number] | null {
  let lastFrom = -1;
  for (let k = 0; k < trip.stops.length; k++) {
    const s = trip.stops[k];
    if (lastFrom >= 0 && toIdxs.includes(s) && !fromIdxs.includes(s)) return [lastFrom, k];
    if (fromIdxs.includes(s)) lastFrom = k;
  }
  return null;
}

export type DirectResult =
  | { status: "ok"; trips: DirectTrip[]; lines: string[] }
  | { status: "no-direct" }
  | { status: "none-soon"; lines: string[] };

/** Trajets directs uniquement : l'arrêt de départ précède l'arrêt d'arrivée sur la même course. */
export function directTrips(
  net: Network,
  opts: { fromIdxs: number[]; toIdxs: number[]; at: LocalMoment; limit?: number },
): DirectResult {
  const { fromIdxs, toIdxs, at, limit = 5 } = opts;
  const lines = new Set<string>();
  for (const trip of net.trips) if (matchOnTrip(trip, fromIdxs, toIdxs)) lines.add(trip.line);
  if (!lines.size) return { status: "no-direct" };

  const found: DirectTrip[] = [];
  for (const { trip, base } of activeTrips(net, at, (t) => lines.has(t.line))) {
    const m = matchOnTrip(trip, fromIdxs, toIdxs);
    if (!m) continue;
    const [i, j] = m;
    const depAbs = base + trip.dep[i];
    if (depAbs < at.minutes) continue;
    const arrAbs = base + trip.arr[j];
    found.push({
      tripId: trip.id,
      lineId: trip.line,
      headsign: trip.headsign,
      fromStop: net.stops[trip.stops[i]].name,
      toStop: net.stops[trip.stops[j]].name,
      depAbs,
      arrAbs,
      depTime: formatClock(depAbs),
      arrTime: formatClock(arrAbs),
      dayOffset: Math.floor(depAbs / 1440),
      durationMin: arrAbs - depAbs,
      waitMin: depAbs - at.minutes,
      stopsCount: j - i,
    });
  }
  found.sort((a, b) => a.depAbs - b.depAbs || a.arrAbs - b.arrAbs);
  const trips = found.filter((t, k) => k === 0 || t.depAbs !== found[k - 1].depAbs || t.lineId !== found[k - 1].lineId).slice(0, limit);
  if (!trips.length) return { status: "none-soon", lines: [...lines] };
  return { status: "ok", trips, lines: [...lines] };
}
