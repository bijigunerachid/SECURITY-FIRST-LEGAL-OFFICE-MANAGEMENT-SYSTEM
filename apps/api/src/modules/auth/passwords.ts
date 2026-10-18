import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { hash, verify, type Algorithm } from "@node-rs/argon2";

/** `Algorithm.Argon2id`. The enum is a const enum, whose values cannot be imported under verbatimModuleSyntax. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- 2 is Argon2id in the library's enum; a unit test asserts every hash starts with $argon2id$.
const ARGON2ID = 2 as Algorithm;

/** NIST SP 800-63B-4 for passwords used as a single factor. */
export const PASSWORD_MIN_LENGTH = 15;
/** Long enough for passphrases; bounded so hashing cost cannot be abused. */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem =
  "too_short" | "too_long" | "common" | "contains_personal_info" | "repetitive";

let blocklist: Set<string> | undefined;

/** Loaded once, on first use (about 120,000 entries; see data/README.md). */
function commonPasswords(): Set<string> {
  if (!blocklist) {
    const file = new URL("../../../data/common-passwords-15plus.txt.gz", import.meta.url);
    const text = gunzipSync(readFileSync(file)).toString("utf8");
    blocklist = new Set(text.split("\n").filter((line) => line !== ""));
  }
  return blocklist;
}

/** Length in characters as people count them (emoji or accented letters count once). */
function characterLength(password: string): number {
  // NIST counts each Unicode code point as one character (Array.from splits by code point).
  return Array.from(password.normalize("NFC")).length;
}

/**
 * Checks a new password. No composition rules (no "one digit, one symbol"),
 * as NIST recommends; instead: length, a list of known breached passwords,
 * the user's own details, and trivially repetitive strings.
 */
export function checkPassword(
  password: string,
  context: { email?: string; displayName?: string } = {},
): PasswordProblem | null {
  const length = characterLength(password);
  if (length < PASSWORD_MIN_LENGTH) return "too_short";
  if (length > PASSWORD_MAX_LENGTH) return "too_long";

  const lowered = password.normalize("NFC").toLowerCase();
  if (commonPasswords().has(lowered)) return "common";

  const compact = lowered.replace(/[\s._-]/g, "");
  const personal = [
    "lexora",
    context.email?.toLowerCase().split("@")[0],
    ...(context.displayName?.toLowerCase().split(/\s+/) ?? []),
  ].filter((part): part is string => part !== undefined && part.length >= 4);
  if (personal.some((part) => compact.includes(part.replace(/[\s._-]/g, "")))) {
    return "contains_personal_info";
  }

  if (new Set(compact).size <= 3) return "repetitive";
  return null;
}

export interface Argon2Settings {
  memoryKib: number;
  iterations: number;
}

/** Argon2id; parameters are stored inside the hash, so they can be raised later. */
export function hashPassword(password: string, settings: Argon2Settings): Promise<string> {
  return hash(password.normalize("NFC"), {
    algorithm: ARGON2ID,
    memoryCost: settings.memoryKib,
    timeCost: settings.iterations,
    parallelism: 1,
  });
}

/**
 * Used when the account does not exist (or has no password yet), so the
 * response takes as long as a real check and does not reveal which accounts
 * exist. Computed once per process.
 */
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(
  storedHash: string | null,
  password: string,
  settings: Argon2Settings,
): Promise<boolean> {
  if (storedHash === null) {
    dummyHash ??= hashPassword("lexora-dummy-password-for-timing", settings);
    await verify(await dummyHash, password.normalize("NFC")).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password.normalize("NFC"));
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current settings. */
export function needsRehash(storedHash: string, settings: Argon2Settings): boolean {
  const match = /\$m=(\d+),t=(\d+),p=\d+\$/.exec(storedHash);
  if (!match) return true;
  return Number(match[1]) < settings.memoryKib || Number(match[2]) < settings.iterations;
}
