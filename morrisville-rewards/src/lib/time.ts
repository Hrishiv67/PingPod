// Date/time helpers. All "days" and "weeks" are Morrisville calendar days (America/New_York),
// matching the database. The server is the source of truth for timestamps; these only format.

export const VENUE_TZ = "America/New_York";

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: VENUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD for the venue's calendar day containing `date`. */
export function venueDate(date: Date = new Date()): string {
  return dayFmt.format(date);
}

/** Shift a YYYY-MM-DD string by whole days (calendar math, DST-safe). */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (YYYY-MM-DD). */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

/** Milliseconds between a server timestamp and a (server-corrected) now, never negative. */
export function elapsedMs(startIso: string, nowMs: number): number {
  return Math.max(0, nowMs - new Date(startIso).getTime());
}

export function elapsedMinutes(startIso: string, nowMs: number, cap = Infinity): number {
  return Math.min(cap, Math.floor(elapsedMs(startIso, nowMs) / 60000));
}

/** 0:07:05 style stopwatch text. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** "54 min", "1 hr", "2 hr 5 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Today", "Yesterday" or "Mon, Nov 18" for a YYYY-MM-DD venue date. */
export function relativeDay(day: string, today: string = venueDate()): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return shortDay.format(new Date(`${day}T12:00:00Z`));
}

export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T12:00:00Z`));
}

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: VENUE_TZ });

/** "7:42 PM" in Morrisville time. */
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: VENUE_TZ,
});

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** "just now", "5 min ago", "2 hr ago", or a date. */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return formatDateTime(iso);
}
