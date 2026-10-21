import { Secret, TOTP } from "otpauth";
import { decrypt, encrypt, type EncryptedValue } from "../../lib/crypto.js";

/**
 * Time-based one-time passwords (RFC 6238) with the settings every common
 * authenticator app supports: SHA-1, 6 digits, 30-second period.
 */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next code too, for clock drift (±30 s). */
const WINDOW = 1;
const ISSUER = "Lexora";

/** The associated data binds a ciphertext to its user: it cannot be moved to another account. */
const aad = (userId: string) => `totp:${userId}`;

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function encryptTotpSecret(
  secretBase32: string,
  userId: string,
  key: Buffer,
): EncryptedValue {
  return encrypt(Buffer.from(secretBase32, "utf8"), key, aad(userId));
}

export function decryptTotpSecret(value: EncryptedValue, userId: string, keys: Buffer[]): string {
  return decrypt(value, keys, aad(userId)).toString("utf8");
}

function totpFor(secretBase32: string, accountLabel: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** The otpauth:// URI shown as a QR code during enrolment. */
export function totpUri(secretBase32: string, accountLabel: string): string {
  return totpFor(secretBase32, accountLabel).toString();
}

/**
 * Checks a code. Returns the 30-second time step it belongs to, or null.
 * The caller must reject a step that is not greater than the last accepted
 * one, so a code cannot be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totpFor(secretBase32, "check").validate({
    token: code,
    timestamp: now,
    window: WINDOW,
  });
  if (delta === null) return null;
  return BigInt(Math.floor(now / 1000 / PERIOD_SECONDS) + delta);
}

/** For tests and the enrolment check: the code an authenticator would show now. */
export function currentTotp(secretBase32: string, now = Date.now()): string {
  return totpFor(secretBase32, "check").generate({ timestamp: now });
}
