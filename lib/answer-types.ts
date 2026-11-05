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

/** Question posée par l'assistant : la réponse suivante (tapée, cliquée ou position) complète la demande. */
export interface FollowUp {
  slot: "arret" | "depart" | "arrivee";
  /** demande en cours, gardée en mémoire */
  pending: StructuredRequest;
  /** texte vague d'origine (« mairie »), combiné à la réponse (« Merville » → « Merville mairie ») */
  original?: string;
  /** proposer « Utiliser ma position » */
  geo?: boolean;
}

export type Answer =
  | { kind: "departures"; headline: string; stopName: string; fromTime?: string; directions: DirectionView[] }
  | { kind: "trips"; headline: string; from: string; to: string; fromTime?: string; trips: TripView[] }
  | { kind: "no-direct"; headline: string; detail: string }
  /** information neutre (ex. arrêt hors des lignes de la démo) */
  | { kind: "notice"; headline: string; detail: string }
  | { kind: "choice"; headline: string; choices: Choice[]; followUp?: FollowUp }
  | { kind: "question"; headline: string; detail?: string; choices?: Choice[]; followUp: FollowUp }
  | { kind: "error"; headline: string; detail?: string; examples?: string[] };

export interface AskResponse {
  answer: Answer;
  /** regles = analyse de la phrase par règles ; bouton = choix structuré */
  mode: "regles" | "bouton";
  /** horaires théoriques (pas de temps réel branché) */
  theoretical: boolean;
  dataSource: "gtfs" | "demo";
  intent?: Intent;
  /** heure de Paris utilisée pour le calcul */
  now: string;
}
