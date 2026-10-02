// Types de réponse partagés entre /api/ask et l'interface.
import type { Intent, StructuredRequest } from "./intent";

export interface LineBadge {
  id: string;
  color: string;
  textColor: string;
}

export interface DepartureView {
  time: string;
  /** "dans 7 min" */
  wait: string;
  /** "" ou "demain" */
  day: string;
  headsign: string;
}

export interface DirectionView {
  line: LineBadge;
  label: string;
  departures: DepartureView[];
  /** pour n'afficher que ce sens */
  request: StructuredRequest;
}

export interface TripView {
  line: LineBadge;
  headsign: string;
  fromStop: string;
  toStop: string;
  depTime: string;
  arrTime: string;
  duration: string;
  wait: string;
  day: string;
  stopsCount: number;
}

export interface Choice {
  label: string;
  sub?: string;
  line?: LineBadge;
  request: StructuredRequest;
}

export type Answer =
  | { kind: "departures"; headline: string; stopName: string; fromTime?: string; directions: DirectionView[] }
  | { kind: "trips"; headline: string; from: string; to: string; fromTime?: string; trips: TripView[] }
  | { kind: "no-direct"; headline: string; detail: string }
  /** information neutre (ex. arrêt hors des lignes de la démo) */
  | { kind: "notice"; headline: string; detail: string }
  | { kind: "choice"; headline: string; choices: Choice[] }
  | { kind: "error"; headline: string; detail?: string; examples?: string[] };

export interface AskResponse {
  answer: Answer;
  /** ia = Groq ; repli = analyse sans IA ; bouton = choix structuré */
  mode: "ia" | "repli" | "bouton";
  modeReason?: string;
  /** horaires théoriques (pas de temps réel branché) */
  theoretical: boolean;
  dataSource: "gtfs" | "demo";
  intent?: Intent;
  /** heure de Paris utilisée pour le calcul */
  now: string;
}
