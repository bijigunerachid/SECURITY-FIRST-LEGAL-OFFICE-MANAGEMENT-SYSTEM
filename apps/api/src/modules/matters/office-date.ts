/**
 * Calendar dates as the office sees them. Matter references and opening and
 * closing dates follow the office's local calendar (Morocco), not UTC: a
 * matter opened at 00:30 local time on 1 January belongs to the new year.
 */

export const OFFICE_TIME_ZONE = "Africa/Casablanca";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OFFICE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in the office, as YYYY-MM-DD. */
export function officeToday(now: Date = new Date()): string {
  return formatter.format(now);
}

/** A YYYY-MM-DD date as stored in a PostgreSQL DATE column (UTC midnight). */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: OFFICE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function officeParts(date: Date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
  };
}

/**
 * The office's offset from UTC at this instant, in milliseconds, from the
 * runtime's time-zone database (Morocco: UTC+1 with UTC+0 during Ramadan
 * until 2026-09-20, permanent UTC+0 since; needs tzdata 2026c, see lib/tzdata.ts).
 */
function officeOffsetMs(date: Date): number {
  const p = officeParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The office's current offset from UTC in whole minutes (sent to the browser). */
export function officeUtcOffsetMinutes(now: Date = new Date()): number {
  return Math.round(officeOffsetMs(now) / 60_000);
}

/** "YYYY-MM-DDTHH:mm" in office time, for date-time inputs. */
export function toOfficeLocal(date: Date): string {
  const p = officeParts(date);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${String(p.year)}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/**
 * The instant for an office wall-clock time ("YYYY-MM-DDTHH:mm"). The offset
 * is looked up at the result and corrected once, which also handles the
 * days the office's offset changes.
 */
export function fromOfficeLocal(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) throw new Error("expected YYYY-MM-DDTHH:mm");
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall - officeOffsetMs(new Date(wall));
  instant = wall - officeOffsetMs(new Date(instant));
  return new Date(instant);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}
