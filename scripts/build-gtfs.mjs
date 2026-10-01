// Construit data/network.json à partir du GTFS liO (transport.data.gouv.fr).
// - garde la ligne 362 + jusqu'à 2 lignes qui partagent le plus d'arrêts avec elle ;
// - si le GTFS est introuvable (réseau, format, ligne absente…), se rabat sur le
//   jeu factice data/demo-gtfs et l'indique dans meta.source = "demo".
//
// Options (variables d'environnement) :
//   LIO_GTFS_FILE=chemin/vers/gtfs.zip   GTFS local (zip ou dossier)
//   LIO_GTFS_URL=https://…/gtfs.zip      URL directe du zip
//   LIO_LINES=362,330                    lignes à garder (la 1re est la ligne pivot)
//   --demo                               force le jeu factice
import { createWriteStream, existsSync, mkdtempSync, readdirSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "network.json");
const OUT_DEMO = join(ROOT, "data", "network.demo.json"); // toujours régénéré : sert aux tests
const DEMO_DIR = join(ROOT, "data", "demo-gtfs");
const DATASETS_API = "https://transport.data.gouv.fr/api/datasets";
const WANTED = (process.env.LIO_LINES || "362").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_LINES = 3;

const log = (...a) => console.log("[gtfs]", ...a);

// ---------------------------------------------------------------- lecture CSV

export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function eachRow(stream, onRow) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  for await (let line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, "")).map((h) => h.trim());
      continue;
    }
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    onRow(row);
  }
}

// Source GTFS : dossier ou zip, lu en flux (stop_times peut être volumineux).
async function openSource(path) {
  if (statSync(path).isDirectory()) {
    const files = new Set(readdirSync(path));
    return {
      has: (n) => files.has(n),
      read: (n, onRow) => eachRow(createReadStream(join(path, n)), onRow),
      close() {},
    };
  }
  const zip = await new Promise((res, rej) => yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e ? rej(e) : res(z))));
  const entries = new Map();
  await new Promise((res, rej) => {
    zip.on("entry", (e) => { entries.set(e.fileName.split("/").pop(), e); zip.readEntry(); });
    zip.on("end", res);
    zip.on("error", rej);
    zip.readEntry();
  });
  return {
    has: (n) => entries.has(n),
    read: async (n, onRow) => {
      const stream = await new Promise((res, rej) => zip.openReadStream(entries.get(n), (e, s) => (e ? rej(e) : res(s))));
      await eachRow(stream, onRow);
    },
    close: () => zip.close(),
  };
}

// --------------------------------------------------------------- utilitaires

const toMinutes = (t) => {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s) => normalize(s).replace(/ /g, "-");
const distanceM = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "assistant-horaires-concept" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function download(url) {
  const dir = mkdtempSync(join(tmpdir(), "gtfs-"));
  const file = join(dir, "gtfs.zip");
  log("téléchargement", url);
  const res = await fetchWithTimeout(url, 120_000);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

// Liste les ressources GTFS candidates « liO » sur transport.data.gouv.fr.
async function findLioGtfsUrls() {
  const res = await fetchWithTimeout(DATASETS_API, 30_000);
  const datasets = await res.json();
  const scored = [];
  for (const d of datasets) {
    const text = normalize(`${d.title || ""} ${d.slug || ""} ${d.publisher?.name || ""}`);
    if (!/\blio\b/.test(text)) continue;
    let score = 1;
    if (/haute garonne|\b31\b|arc en ciel/.test(text)) score += 2;
    for (const r of d.resources || []) {
      if (String(r.format).toUpperCase() !== "GTFS") continue;
      const url = r.url || r.original_url;
      if (url) scored.push({ score: score + (r.is_available === false ? -5 : 0), url, title: d.title });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ----------------------------------------------------------- construction

async function build(src, meta) {
  for (const f of ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
    if (!src.has(f)) throw new Error(`fichier ${f} absent du GTFS`);
  }

  // Lignes : regroupées par numéro (route_short_name).
  const routes = new Map(); // route_id -> route
  await src.read("routes.txt", (r) => routes.set(r.route_id, r));
  const byShort = new Map();
  for (const r of routes.values()) {
    const short = r.route_short_name || r.route_id;
    if (!byShort.has(short)) byShort.set(short, []);
    byShort.get(short).push(r.route_id);
  }
  const pivot = WANTED[0];
  if (!byShort.has(pivot)) throw new Error(`ligne ${pivot} absente du GTFS`);

  const trips = new Map(); // trip_id -> trip
  const routeShortOf = (routeId) => routes.get(routeId)?.route_short_name || routeId;
  await src.read("trips.txt", (t) => trips.set(t.trip_id, t));

  const stopsRaw = new Map();
  await src.read("stops.txt", (s) => stopsRaw.set(s.stop_id, s));

  // Choix des lignes : celles demandées, sinon la pivot + celles qui partagent le plus d'arrêts.
  let selected = WANTED.filter((l) => byShort.has(l));
  if (selected.length < MAX_LINES && WANTED.length === 1) {
    const namesByLine = new Map();
    await src.read("stop_times.txt", (st) => {
      const t = trips.get(st.trip_id);
      if (!t) return;
      const line = routeShortOf(t.route_id);
      if (!namesByLine.has(line)) namesByLine.set(line, new Set());
      const s = stopsRaw.get(st.stop_id);
      if (s) namesByLine.get(line).add(normalize(s.stop_name));
    });
    const pivotNames = namesByLine.get(pivot) || new Set();
    const ranked = [...namesByLine.entries()]
      .filter(([l]) => l !== pivot)
      .map(([l, names]) => [l, [...names].filter((n) => pivotNames.has(n)).length])
      .filter(([, shared]) => shared > 0)
      .sort((a, b) => b[1] - a[1]);
    selected = [pivot, ...ranked.slice(0, MAX_LINES - 1).map(([l]) => l)];
  }
  const selectedSet = new Set(selected);
  log("lignes retenues :", selected.join(", "));

  // Passages des courses retenues.
  const tripStops = new Map(); // trip_id -> [{seq, stop_id, arr, dep}]
  await src.read("stop_times.txt", (st) => {
    const t = trips.get(st.trip_id);
    if (!t || !selectedSet.has(routeShortOf(t.route_id))) return;
    const arr = toMinutes(st.arrival_time) ?? toMinutes(st.departure_time);
    const dep = toMinutes(st.departure_time) ?? arr;
    if (arr == null) return; // arrêt non horodaté : ignoré
    if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
    tripStops.get(st.trip_id).push({ seq: Number(st.stop_sequence), stopId: st.stop_id, arr, dep });
  });

  // Arrêts : les quais de même nom à moins de 500 m sont fusionnés en un seul « lieu ».
  const usedStopIds = new Set();
  for (const list of tripStops.values()) for (const s of list) usedStopIds.add(s.stopId);
  const places = [];
  const placeOfStop = new Map();
  for (const id of usedStopIds) {
    const s = stopsRaw.get(id);
    if (!s) continue;
    const pt = { lat: Number(s.stop_lat), lon: Number(s.stop_lon) };
    const key = normalize(s.stop_name);
    let place = places.find((p) => p.key === key && distanceM(p, pt) < 500);
    if (!place) {
      place = { key, name: s.stop_name, lat: pt.lat, lon: pt.lon, lines: new Set() };
      places.push(place);
    }
    placeOfStop.set(id, place);
  }
  places.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const usedIds = new Set();
  places.forEach((p, i) => {
    let id = slug(p.name) || `arret-${i}`;
    while (usedIds.has(id)) id += "-b";
    usedIds.add(id);
    p.id = id;
    p.index = i;
  });

  const outTrips = [];
  const usedServices = new Set();
  for (const [tripId, list] of tripStops) {
    list.sort((a, b) => a.seq - b.seq);
    const t = trips.get(tripId);
    const line = routeShortOf(t.route_id);
    const stops = [], arr = [], dep = [];
    for (const s of list) {
      const place = placeOfStop.get(s.stopId);
      if (!place) continue;
      if (stops.length && stops[stops.length - 1] === place.index) { dep[dep.length - 1] = s.dep; continue; }
      stops.push(place.index); arr.push(s.arr); dep.push(s.dep);
      place.lines.add(line);
    }
    if (stops.length < 2) continue;
    usedServices.add(t.service_id);
    outTrips.push({
      id: tripId,
      line,
      service: t.service_id,
      headsign: t.trip_headsign || places[stops[stops.length - 1]].name,
      direction: Number(t.direction_id) === 1 ? 1 : 0,
      stops, arr, dep,
    });
  }
  outTrips.sort((a, b) => a.line.localeCompare(b.line) || a.dep[0] - b.dep[0]);

  // Calendriers.
  const services = {};
  const ensure = (id) => (services[id] ??= { days: "0000000", start: "", end: "", add: [], remove: [] });
  if (src.has("calendar.txt")) {
    await src.read("calendar.txt", (c) => {
      if (!usedServices.has(c.service_id)) return;
      const s = ensure(c.service_id);
      s.days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => (c[d] === "1" ? "1" : "0")).join("");
      s.start = c.start_date;
      s.end = c.end_date;
    });
  }
  if (src.has("calendar_dates.txt")) {
    await src.read("calendar_dates.txt", (c) => {
      if (!usedServices.has(c.service_id)) return;
      const s = ensure(c.service_id);
      (c.exception_type === "1" ? s.add : s.remove).push(c.date);
    });
  }
  for (const id of usedServices) ensure(id);

  let validFrom = "", validTo = "";
  for (const s of Object.values(services)) {
    const dates = [s.start, s.end, ...s.add].filter(Boolean).sort();
    if (!dates.length) continue;
    if (!validFrom || dates[0] < validFrom) validFrom = dates[0];
    if (!validTo || dates[dates.length - 1] > validTo) validTo = dates[dates.length - 1];
  }

  const lines = selected
    .filter((l) => outTrips.some((t) => t.line === l))
    .map((l) => {
      const r = routes.get(byShort.get(l)[0]);
      return {
        id: l,
        shortName: l,
        longName: r.route_long_name || "",
        color: `#${(r.route_color || "C8102E").replace("#", "")}`,
        textColor: `#${(r.route_text_color || "FFFFFF").replace("#", "")}`,
      };
    });

  return {
    meta: { ...meta, generatedAt: new Date().toISOString(), validFrom, validTo, timezone: "Europe/Paris" },
    lines,
    stops: places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, lines: [...p.lines].sort() })),
    services,
    trips: outTrips,
  };
}

// ------------------------------------------------------------------ main

async function tryReal() {
  if (process.env.LIO_GTFS_FILE) return [{ path: process.env.LIO_GTFS_FILE, title: "GTFS local" }];
  if (process.env.LIO_GTFS_URL) return [{ url: process.env.LIO_GTFS_URL, title: "GTFS (LIO_GTFS_URL)" }];
  return (await findLioGtfsUrls()).slice(0, 4);
}

async function buildDemo() {
  if (!existsSync(join(DEMO_DIR, "stops.txt"))) throw new Error("data/demo-gtfs manquant : lancez npm run demo-gtfs");
  const src = await openSource(DEMO_DIR);
  const data = await build(src, { source: "demo", feedName: "Jeu de données factice (démo)", sourceUrl: null });
  writeFileSync(OUT_DEMO, JSON.stringify(data));
  return data;
}

async function main() {
  const demo = await buildDemo();
  const forceDemo = process.argv.includes("--demo");
  if (!forceDemo) {
    try {
      const candidates = await tryReal();
      if (!candidates.length) throw new Error("aucun jeu GTFS liO trouvé sur transport.data.gouv.fr");
      for (const c of candidates) {
        try {
          const path = c.path || (await download(c.url));
          const src = await openSource(path);
          try {
            const data = await build(src, { source: "gtfs", feedName: c.title, sourceUrl: c.url || null });
            writeFileSync(OUT, JSON.stringify(data));
            log(`OK : ${data.trips.length} courses, ${data.stops.length} arrêts → data/network.json`);
            return;
          } finally {
            src.close();
          }
        } catch (e) {
          log(`ressource ignorée (${c.title}) :`, e.message);
        }
      }
      throw new Error("aucune ressource exploitable");
    } catch (e) {
      log("GTFS liO indisponible :", e.cause?.message || e.message);
      log("→ repli sur le jeu de données factice (data/demo-gtfs)");
    }
  }
  writeFileSync(OUT, JSON.stringify(demo));
  log(`démo : ${demo.trips.length} courses, ${demo.stops.length} arrêts → data/network.json`);
}

main().catch((e) => {
  console.error("[gtfs] échec :", e);
  process.exit(1);
});
