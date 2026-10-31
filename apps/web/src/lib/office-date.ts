/**
 * The office's calendar day (Africa/Casablanca), for date inputs and
 * defaults.
 *
 * It comes from the offset the server sends with the session, not from the
 * device's time-zone data: a browser with outdated data (for example one
 * that still puts Morocco on UTC+1 after 2026-09-20) would otherwise move to
 * "tomorrow" an hour early, and the server would refuse dates it proposed.
 * Before the session has loaded, the device's own data is the fallback.
 */

let serverOffsetMinutes: number | null = null;

export function setOfficeUtcOffset(minutes: number | null): void {
  serverOffsetMinutes = minutes;
}

/** Today's date in the office, as YYYY-MM-DD. */
export function officeToday(now: Date = new Date()): string {
  if (serverOffsetMinutes !== null) {
    return new Date(now.getTime() + serverOffsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
