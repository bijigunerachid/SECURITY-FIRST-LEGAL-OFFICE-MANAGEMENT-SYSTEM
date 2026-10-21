/**
 * The time-zone database built into Node.js decides how office times
 * (Africa/Casablanca) become instants. Morocco moved to permanent UTC+0 on
 * 2026-09-20; only tzdata 2026c (released 2026-07-08) or later knows this. With
 * older data every hearing after that date would be off by one hour, so the
 * API and the worker refuse to start in production on an outdated runtime
 * (and warn in development and tests).
 */
export const REQUIRED_TZDATA = "2026c";

/** The tzdata version built into this Node.js runtime, for example "2026c". */
export function runtimeTzdata(): string | undefined {
  return process.versions["tz"];
}

/**
 * tzdata versions are a year and a letter ("2024b"), so they compare as
 * strings. The version is always passed explicitly (no default), so an
 * unknown version is never silently replaced by the runtime's own.
 */
export function tzdataIsCurrent(version: string | undefined): boolean {
  return version !== undefined && /^\d{4}[a-z]$/.test(version) && version >= REQUIRED_TZDATA;
}

/**
 * The startup decision: "ok", "warn" (outside production) or "refuse"
 * (production). Never throws, so callers decide how to report it.
 */
export function tzdataCheck(
  isProduction: boolean,
  version: string | undefined,
): "ok" | "warn" | "refuse" {
  if (tzdataIsCurrent(version)) return "ok";
  return isProduction ? "refuse" : "warn";
}
