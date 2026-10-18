import { describe, expect, it } from "vitest";
import { checkPassword, hashPassword, needsRehash, verifyPassword } from "./passwords.js";

const settings = { memoryKib: 19_456, iterations: 2 };

describe("checkPassword (NIST SP 800-63B-4 style policy)", () => {
  it("accepts a long passphrase with no special characters", () => {
    expect(checkPassword("olive tree beside the old harbour")).toBeNull();
  });

  it("does not require digits, capitals or symbols", () => {
    expect(checkPassword("quietmorningtrainride")).toBeNull();
  });

  it.each([
    ["fourteen chars", "too_short"],
    ["x".repeat(129), "too_long"],
  ])("rejects %j as %s", (password, problem) => {
    expect(checkPassword(password)).toBe(problem);
  });

  it("counts characters, not bytes (Arabic passphrases are not penalised)", () => {
    // 15 Arabic letters and spaces: 15 characters, ~27 bytes.
    expect(checkPassword("سر طويل جدا هنا")).toBeNull();
  });

  it.each(["passwordpassword", "PasswordPassword", "qwertyuiopasdfghjkl", "123456789012345"])(
    "rejects the breached password %j regardless of case",
    (password) => {
      expect(checkPassword(password)).toBe("common");
    },
  );

  it("rejects passwords containing the user's own name or e-mail", () => {
    const context = { email: "fatima.elamrani@cabinet.ma", displayName: "Fatima El Amrani" };
    expect(checkPassword("fatima.elamrani is me 2026", context)).toBe("contains_personal_info");
    expect(checkPassword("my name is Amrani and that is it", context)).toBe(
      "contains_personal_info",
    );
    expect(checkPassword("my lexora office password!", context)).toBe("contains_personal_info");
  });

  it("rejects trivially repetitive strings", () => {
    expect(checkPassword("qjvqjvqjvqjvqjvqjv")).toBe("repetitive");
    expect(checkPassword("wkwkwkwk wkwkwkwk")).toBe("repetitive");
  });
});

describe("Argon2id hashing", () => {
  it("produces an Argon2id PHC string and verifies only the right password", async () => {
    const hash = await hashPassword("olive tree beside the old harbour", settings);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "olive tree beside the old harbour", settings)).toBe(true);
    expect(await verifyPassword(hash, "olive tree beside the old harbor", settings)).toBe(false);
  });

  it("salts every hash", async () => {
    const a = await hashPassword("same password for both", settings);
    const b = await hashPassword("same password for both", settings);
    expect(a).not.toBe(b);
  });

  it("treats Unicode-equivalent input as the same password (NFC)", async () => {
    const composed = "café au lait le matin";
    const decomposed = composed.normalize("NFD");
    const hash = await hashPassword(composed, settings);
    expect(await verifyPassword(hash, decomposed, settings)).toBe(true);
  });

  it("returns false (never throws) for a missing or corrupt hash", async () => {
    expect(await verifyPassword(null, "anything at all here", settings)).toBe(false);
    expect(await verifyPassword("not-a-hash", "anything at all here", settings)).toBe(false);
  });

  it("spends comparable time on a missing account as on a real one", async () => {
    const hash = await hashPassword("olive tree beside the old harbour", settings);
    await verifyPassword(null, "warm-up", settings);
    const time = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      for (let i = 0; i < 5; i++) await fn();
      return performance.now() - start;
    };
    const real = await time(() => verifyPassword(hash, "wrong password guess", settings));
    const missing = await time(() => verifyPassword(null, "wrong password guess", settings));
    expect(missing).toBeGreaterThan(real * 0.5);
  });

  it("flags hashes made with weaker parameters for re-hashing", async () => {
    const hash = await hashPassword("olive tree beside the old harbour", settings);
    expect(needsRehash(hash, settings)).toBe(false);
    expect(needsRehash(hash, { memoryKib: 65_536, iterations: 3 })).toBe(true);
  });
});
