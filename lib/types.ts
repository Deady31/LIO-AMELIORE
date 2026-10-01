// Format de data/network.json (produit par scripts/build-gtfs.mjs).

export interface NetworkMeta {
  source: "gtfs" | "demo";
  feedName: string;
  sourceUrl: string | null;
  generatedAt: string;
  validFrom: string;
  validTo: string;
  timezone: string;
}

export interface Line {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
}

export interface Service {
  /** 7 caractères, lundi → dimanche, "1" = circule */
  days: string;
  start: string;
  end: string;
  add: string[];
  remove: string[];
}

export interface Trip {
  id: string;
  line: string;
  service: string;
  headsign: string;
  direction: 0 | 1;
  /** index dans Network.stops */
  stops: number[];
  /** minutes depuis minuit du jour de service (peut dépasser 1440) */
  arr: number[];
  dep: number[];
}

export interface NetworkData {
  meta: NetworkMeta;
  lines: Line[];
  stops: Stop[];
  services: Record<string, Service>;
  trips: Trip[];
}

/** Un instant en heure de Paris : date AAAAMMJJ + minutes depuis minuit. */
export interface LocalMoment {
  date: string;
  minutes: number;
}
