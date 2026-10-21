/**
 * The time-zone database built into Node.js decides how office times
 * (Africa/Casablanca) become instants. Morocco moved to permanent UTC+0 on
 * 2026-09-20; only tzdata 2026c (released 2026-07-08) or later knows this. With
 * older data every hearing after that date would be off by one hour, so the
 * API and the worker refuse to start in production on an outdated runtime
 * (and warn in development and tests).
 */
export const REQUIRED_TZDATA = "2026c";

/** tzdata versions are a year and a letter ("2024b"), so they compare as strings. */
export function tzdataIsCurrent(version: string | undefined = process.versions["tz"]): boolean {
  return version !== undefined && /^\d{4}[a-z]$/.test(version) && version >= REQUIRED_TZDATA;
}

/**
 * The startup decision: "ok", "warn" (outside production) or "refuse"
 * (production). Never throws, so callers decide how to report it.
 */
export function tzdataCheck(
  isProduction: boolean,
  version: string | undefined = process.versions["tz"],
): "ok" | "warn" | "refuse" {
  if (tzdataIsCurrent(version)) return "ok";
  return isProduction ? "refuse" : "warn";
}
