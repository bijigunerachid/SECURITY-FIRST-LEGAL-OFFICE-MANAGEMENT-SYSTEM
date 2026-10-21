import { describe, expect, it } from "vitest";
import {
  hashRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./recovery-codes.js";
import {
  currentTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  newTotpSecret,
  totpUri,
  verifyTotp,
} from "./totp.js";

const key = Buffer.alloc(32, 9);
const NOW = Date.UTC(2026, 9, 18, 12, 0, 15);

describe("TOTP", () => {
  const secret = newTotpSecret();

  it("generates a 160-bit base32 secret", () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = totpUri(secret, "fatima@cabinet.ma");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Lexora:fatima%40cabinet\.ma\?/);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("accepts the current code and returns its time step", () => {
    const step = verifyTotp(secret, currentTotp(secret, NOW), NOW);
    expect(step).toBe(BigInt(Math.floor(NOW / 30_000)));
  });

  it("accepts the previous and next code (±30 s clock drift) but not older ones", () => {
    expect(verifyTotp(secret, currentTotp(secret, NOW - 30_000), NOW)).not.toBeNull();
    expect(verifyTotp(secret, currentTotp(secret, NOW + 30_000), NOW)).not.toBeNull();
    expect(verifyTotp(secret, currentTotp(secret, NOW - 90_000), NOW)).toBeNull();
  });

  it("rejects malformed codes without computing anything", () => {
    for (const code of ["", "12345", "1234567", "12a456", " 123456"]) {
      expect(verifyTotp(secret, code, NOW)).toBeNull();
    }
  });

  it("stores secrets encrypted and bound to their user", () => {
    const sealed = encryptTotpSecret(secret, "user-1", key);
    expect(sealed.ciphertext.toString("utf8")).not.toContain(secret);
    expect(decryptTotpSecret(sealed, "user-1", [key])).toBe(secret);
    expect(() => decryptTotpSecret(sealed, "user-2", [key])).toThrow();
  });
});

describe("recovery codes", () => {
  it("are three groups of five unambiguous characters", () => {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    }
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("accept any case, spaces and dashes when typed", () => {
    const code = newRecoveryCode();
    const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;
    expect(normalizeRecoveryCode(typed)).toBe(code.replace(/-/g, ""));
    expect(hashRecoveryCode(typed).equals(hashRecoveryCode(code))).toBe(true);
  });

  it("reject wrong lengths and characters outside the alphabet", () => {
    expect(normalizeRecoveryCode("ABCDE-FGHJK")).toBeNull();
    expect(normalizeRecoveryCode("ABCDE-FGHJK-LMNO0")).toBeNull();
  });
});
