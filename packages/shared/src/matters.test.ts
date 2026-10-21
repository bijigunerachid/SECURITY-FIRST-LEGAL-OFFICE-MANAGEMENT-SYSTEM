import { describe, expect, it } from "vitest";
import {
  breakGlassRequestSchema,
  conflictQuerySchema,
  createClientRequestSchema,
  createMatterRequestSchema,
  updateClientRequestSchema,
  updateMatterRequestSchema,
} from "./index.js";

describe("client requests", () => {
  it("trims text, lowercases e-mail and turns empty optional fields into null", () => {
    expect(
      createClientRequestSchema.parse({
        kind: "person",
        name: "  Nadia Alami ",
        email: " Nadia@Example.TEST ",
        phone: "",
        notes: "  ",
      }),
    ).toEqual({
      kind: "person",
      name: "Nadia Alami",
      email: "nadia@example.test",
      phone: null,
      notes: null,
    });
  });

  it("accepts Arabic names and mixed scripts", () => {
    expect(
      createClientRequestSchema.safeParse({ kind: "person", name: "نادية العلمي" }).success,
    ).toBe(true);
    expect(
      createClientRequestSchema.safeParse({ kind: "company", name: "شركة Atlas SARL" }).success,
    ).toBe(true);
  });

  it.each([
    ["right-to-left override", "Ali\u202eabc"],
    ["left-to-right isolate", "Ali\u2066abc"],
    ["null byte", "Ali\u0000"],
    ["line break in a single-line field", "Ali\nBaba"],
    ["no letter or digit", "--"],
  ])("refuses names with a %s", (_label, name) => {
    expect(createClientRequestSchema.safeParse({ kind: "person", name }).success).toBe(false);
  });

  it("keeps line breaks in addresses and notes", () => {
    const parsed = createClientRequestSchema.parse({
      kind: "person",
      name: "Ali",
      address: "Rue 1\nRabat",
    });
    expect(parsed.address).toBe("Rue 1\nRabat");
  });

  it("refuses unknown fields and empty updates", () => {
    expect(
      createClientRequestSchema.safeParse({ kind: "person", name: "Ali", createdById: "x" })
        .success,
    ).toBe(false);
    expect(updateClientRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("matter requests", () => {
  const base = {
    clientId: "6f1c1d8e-6d1e-4c39-8f5e-6a3e2b1d9c10",
    title: "Dossier",
    area: "civil",
  };

  it("defaults to an unrestricted matter and accepts calendar dates only", () => {
    expect(createMatterRequestSchema.parse(base).restricted).toBe(false);
    expect(createMatterRequestSchema.safeParse({ ...base, openedOn: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      createMatterRequestSchema.safeParse({ ...base, openedOn: "2026-02-03T10:00:00Z" }).success,
    ).toBe(false);
  });

  it("does not let the client choose the reference, status or team", () => {
    for (const extra of [{ reference: "2026-0001" }, { status: "closed" }, { members: [] }]) {
      expect(createMatterRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(updateMatterRequestSchema.safeParse({ clientId: base.clientId }).success).toBe(false);
  });
});

describe("conflict and break-glass requests", () => {
  it("needs at least three characters to search", () => {
    expect(conflictQuerySchema.safeParse({ q: "ab" }).success).toBe(false);
    expect(conflictQuerySchema.safeParse({ q: "abc" }).success).toBe(true);
  });

  it("needs a reference and a written reason of at least 20 characters", () => {
    expect(
      breakGlassRequestSchema.safeParse({ reference: "2026-0001", reason: "short" }).success,
    ).toBe(false);
    expect(
      breakGlassRequestSchema.safeParse({
        reference: "2026-0001",
        reason: "Lead lawyer unreachable before the hearing.",
      }).success,
    ).toBe(true);
    expect(
      breakGlassRequestSchema.safeParse({ reference: "2026-1", reason: "x".repeat(30) }).success,
    ).toBe(false);
  });
});
