// Génère un GTFS factice mais réaliste (data/demo-gtfs/*.txt).
// Utilisé uniquement si le vrai GTFS est introuvable. Lancer : npm run demo-gtfs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "demo-gtfs");

const stops = [
  ["MERV_MAI", "Merville – Mairie", 43.7228, 1.2969],
  ["AUS_MAI", "Aussonne – Mairie", 43.6825, 1.3221],
  ["AUS_GRE", "Aussonne – Grésille", 43.676, 1.332],
  ["COR_CEN", "Cornebarrieu – Centre", 43.6497, 1.3268],
  ["BLA_ODY", "Blagnac – Odyssud", 43.6408, 1.3858],
  ["TLS_ARE", "Toulouse – Arènes", 43.5933, 1.4183],
  ["SEI_VIL", "Seilh – Village", 43.6939, 1.3553],
  ["TLS_BOR", "Toulouse – Borderouge", 43.6407, 1.4527],
];

// [stop_id, minutes depuis le départ (hors pointe)]
const L362_ALLER = [["MERV_MAI", 0], ["AUS_MAI", 9], ["AUS_GRE", 12], ["COR_CEN", 19], ["BLA_ODY", 28], ["TLS_ARE", 45]];
const L362_RETOUR = [["TLS_ARE", 0], ["BLA_ODY", 16], ["COR_CEN", 25], ["AUS_GRE", 32], ["AUS_MAI", 35], ["MERV_MAI", 44]];
const L330_ALLER = [["AUS_MAI", 0], ["SEI_VIL", 8], ["TLS_BOR", 30]];
const L330_RETOUR = [["TLS_BOR", 0], ["SEI_VIL", 22], ["AUS_MAI", 30]];

const hm = (s) => s.split(" ").map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
const range = (from, to, step) => { const r = []; for (let t = from; t <= to; t += step) r.push(t); return r; };

const timetable = [
  // ligne, direction, headsign, pattern, service, départs (minutes)
  ["362", 0, "Toulouse – Arènes", L362_ALLER, "SEM", hm("6:05 6:35 7:00 7:20 7:40 8:05 8:35 9:15 10:15 11:15 12:15 13:15 14:15 15:15 16:05 16:35 17:05 17:35 18:05 18:35 19:15 20:15 21:15")],
  ["362", 1, "Merville", L362_RETOUR, "SEM", hm("6:45 7:15 7:45 8:15 9:00 10:00 11:00 12:00 13:00 14:00 15:00 16:00 16:30 17:00 17:20 17:40 18:00 18:20 18:45 19:15 19:45 20:30 21:30 22:30 23:40")],
  ["362", 0, "Toulouse – Arènes", L362_ALLER, "SAM", range(hm("7:15")[0], hm("20:15")[0], 60)],
  ["362", 1, "Merville", L362_RETOUR, "SAM", range(hm("8:00")[0], hm("21:00")[0], 60)],
  ["362", 0, "Toulouse – Arènes", L362_ALLER, "DIM", hm("9:15 12:15 15:15 18:15")],
  ["362", 1, "Merville", L362_RETOUR, "DIM", hm("10:15 13:15 16:15 19:15")],
  ["330", 0, "Toulouse – Borderouge", L330_ALLER, "SEM", range(hm("6:50")[0], hm("19:50")[0], 60)],
  ["330", 1, "Aussonne", L330_RETOUR, "SEM", range(hm("7:30")[0], hm("20:30")[0], 60)],
];

const peak = (t) => (t >= 420 && t < 540) || (t >= 1020 && t < 1140); // 7h-9h, 17h-19h
const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}:00`;

const trips = [];
const stopTimes = [];
let n = 0;
for (const [line, dir, headsign, pattern, service, departures] of timetable) {
  for (const dep of departures) {
    const tripId = `${line}_${service}_${dir}_${String(++n).padStart(3, "0")}`;
    trips.push([`L${line}`, service, tripId, headsign, dir]);
    // En heure de pointe, chaque inter-arrêt prend ~15 % de plus.
    const factor = peak(dep) ? 1.15 : 1;
    pattern.forEach(([stopId, offset], i) => {
      const t = dep + Math.round(offset * factor);
      stopTimes.push([tripId, fmt(t), fmt(t), stopId, i + 1]);
    });
  }
}

const csv = (header, rows) => [header.join(","), ...rows.map((r) => r.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))].join("\n") + "\n";

mkdirSync(OUT, { recursive: true });
const files = {
  "agency.txt": csv(["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"], [["DEMO", "Réseau régional (données factices)", "https://example.org", "Europe/Paris", "fr"]]),
  "stops.txt": csv(["stop_id", "stop_name", "stop_lat", "stop_lon"], stops),
  "routes.txt": csv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"], [
    ["L362", "DEMO", "362", "Merville – Aussonne – Toulouse Arènes", 3, "C8102E", "FFFFFF"],
    ["L330", "DEMO", "330", "Aussonne – Seilh – Toulouse Borderouge", 3, "0B6FB8", "FFFFFF"],
  ]),
  "trips.txt": csv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], trips),
  "stop_times.txt": csv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stopTimes),
  "calendar.txt": csv(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], [
    ["SEM", 1, 1, 1, 1, 1, 0, 0, "20250901", "20270831"],
    ["SAM", 0, 0, 0, 0, 0, 1, 0, "20250901", "20270831"],
    ["DIM", 0, 0, 0, 0, 0, 0, 1, "20250901", "20270831"],
  ]),
  // Jours fériés en semaine : service du dimanche.
  "calendar_dates.txt": csv(["service_id", "date", "exception_type"], ["20261111", "20261225", "20270101", "20270405", "20270508", "20270513", "20270714"].flatMap((d) => [["SEM", d, 2], ["DIM", d, 1]])),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
console.log(`GTFS factice écrit dans ${OUT} (${trips.length} courses, ${stopTimes.length} passages)`);
