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
