import type { LocalMoment } from "./types";

const TZ = "Europe/Paris";

/** Instant courant (ou `d`) exprimé en heure de Paris, quel que soit le fuseau du serveur. */
export function parisMoment(d: Date = new Date()): LocalMoment {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}${parts.month}${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function toUtcDate(ymd: string): Date {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
}

export function shiftDate(ymd: string, days: number): string {
  const d = toUtcDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** 0 = lundi … 6 = dimanche */
export function weekdayIndex(ymd: string): number {
  return (toUtcDate(ymd).getUTCDay() + 6) % 7;
}

/** 1062 → "17h42" (les minutes au-delà de 24 h sont ramenées sur le jour). */
export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** "dans 7 min", "dans 1 h 12", "maintenant". */
export function formatWait(minutes: number): string {
  if (minutes <= 0) return "maintenant";
  return `dans ${formatDuration(minutes)}`;
}

export function dayLabel(dayOffset: number): string {
  return dayOffset === 0 ? "" : dayOffset === 1 ? "demain" : dayOffset === -1 ? "hier" : `J+${dayOffset}`;
}

/** "17:42", "17h", "7h05", "17 h 42" → minutes, sinon null. */
export function parseClock(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^\s*(\d{1,2})\s*(?:h|:|H)\s*(\d{2})?\s*$/.exec(s) ?? /^\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
