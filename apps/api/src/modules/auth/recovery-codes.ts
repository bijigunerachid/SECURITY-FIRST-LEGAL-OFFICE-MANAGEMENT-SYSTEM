import { randomInt } from "node:crypto";
import { sha256 } from "../../lib/crypto.js";

export const RECOVERY_CODE_COUNT = 10;

/** No 0/O or 1/I/L, so codes can be read off paper without mistakes. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUPS = 3;
const GROUP_LENGTH = 5;
const VALID_CODE = new RegExp(`^[${ALPHABET}]+$`);

/** Example: "7K3QF-M9XRT-2HCWA" — about 74 bits of entropy. */
export function newRecoveryCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return groups.join("-");
}

/** Accepts the code with any case, spaces or dashes, as people type it. */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (compact.length !== GROUPS * GROUP_LENGTH) return null;
  if (!VALID_CODE.test(compact)) return null;
  return compact;
}

export function hashRecoveryCode(code: string): Buffer {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) {
    throw new Error("Invalid recovery code format");
  }
  return sha256(`recovery:${normalized}`);
}
