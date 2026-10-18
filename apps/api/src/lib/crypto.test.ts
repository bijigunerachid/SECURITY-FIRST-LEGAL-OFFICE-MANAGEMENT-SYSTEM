import { describe, expect, it } from "vitest";
import { decrypt, encrypt, keyIdOf, randomToken, safeEqual, sha256 } from "./crypto.js";

const key = Buffer.alloc(32, 1);
const otherKey = Buffer.alloc(32, 2);

describe("randomToken", () => {
  it("returns 256-bit URL-safe tokens that do not repeat", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("AES-256-GCM encryption", () => {
  it("round-trips a value", () => {
    const sealed = encrypt(Buffer.from("JBSWY3DPEHPK3PXP"), key, "totp:user-1");
    expect(decrypt(sealed, [key], "totp:user-1").toString()).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV every time", () => {
    const a = encrypt(Buffer.from("same"), key, "x").ciphertext;
    const b = encrypt(Buffer.from("same"), key, "x").ciphertext;
    expect(a.equals(b)).toBe(false);
  });

  it("refuses a ciphertext moved to another user (associated data)", () => {
    const sealed = encrypt(Buffer.from("secret"), key, "totp:user-1");
    expect(() => decrypt(sealed, [key], "totp:user-2")).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = encrypt(Buffer.from("secret"), key, "totp:user-1");
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[14] = (tampered[14] ?? 0) ^ 0xff;
    expect(() => decrypt({ ...sealed, ciphertext: tampered }, [key], "totp:user-1")).toThrow();
  });

  it("decrypts with the previous key after rotation, by key id", () => {
    const sealed = encrypt(Buffer.from("old secret"), otherKey, "a");
    expect(sealed.keyId).toBe(keyIdOf(otherKey));
    expect(decrypt(sealed, [key, otherKey], "a").toString()).toBe("old secret");
    expect(() => decrypt(sealed, [key], "a")).toThrow(/No encryption key/);
  });
});

describe("sha256", () => {
  it("returns 32 bytes", () => {
    expect(sha256("x")).toHaveLength(32);
  });
});
