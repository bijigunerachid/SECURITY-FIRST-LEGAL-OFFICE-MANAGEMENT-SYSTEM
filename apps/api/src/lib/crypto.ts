import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Small wrappers around Node's `crypto` module. No custom cryptography:
 * random tokens from the OS generator, SHA-256 for hashing high-entropy
 * tokens, AES-256-GCM for encrypting the few secrets that must be readable.
 */

/** URL-safe random token with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 is appropriate for tokens and recovery codes because they are long
 * random values (no dictionary to attack). Passwords use Argon2id instead.
 */
export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time string comparison (lengths are not secret). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Short identifier of a key, stored with ciphertext so rotation is possible. */
export function keyIdOf(key: Buffer): string {
  return sha256(key).subarray(0, 8).toString("hex");
}

export interface EncryptedValue {
  ciphertext: Buffer;
  keyId: string;
}

/** AES-256-GCM. Output: IV (12 bytes) ‖ ciphertext ‖ tag (16 bytes). */
export function encrypt(plaintext: Buffer, key: Buffer, associatedData: string): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(associatedData));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, body, cipher.getAuthTag()]), keyId: keyIdOf(key) };
}

/**
 * Decrypts with whichever of `keys` matches `keyId`. Throws if no key
 * matches or if the data or associated data were altered.
 */
export function decrypt(value: EncryptedValue, keys: Buffer[], associatedData: string): Buffer {
  const key = keys.find((candidate) => keyIdOf(candidate) === value.keyId);
  if (!key) {
    throw new Error("No encryption key matches the stored key id");
  }
  const iv = value.ciphertext.subarray(0, IV_BYTES);
  const tag = value.ciphertext.subarray(value.ciphertext.length - TAG_BYTES);
  const body = value.ciphertext.subarray(IV_BYTES, value.ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
