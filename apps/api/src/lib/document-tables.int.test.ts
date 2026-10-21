import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestUser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../test/integration.js";

/**
 * What the application's database role can never do to document records,
 * whatever bug it has, and the integrity rules PostgreSQL enforces on them.
 */

let ctx: IntegrationContext;
const app = new pg.Client({ connectionString: process.env["DATABASE_URL"] ?? "" });

beforeAll(async () => {
  ctx = await integrationContext();
  await app.connect();
});
afterAll(async () => {
  await app.end();
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

async function expectCode(sql: string, params: unknown[], code: string): Promise<void> {
  await expect(app.query(sql, params)).rejects.toMatchObject({ code });
}

async function seed() {
  const lawyer = await createTestUser(ctx, { role: "lawyer" });
  const client = await ctx.db.client.create({
    data: { kind: "person", name: "Ali", searchName: "ali", createdById: lawyer.id },
  });
  const matter = await ctx.db.matter.create({
    data: {
      reference: "2026-0001",
      title: "Dossier",
      area: "civil",
      openedOn: new Date("2026-01-10T00:00:00Z"),
      clientId: client.id,
      createdById: lawyer.id,
    },
  });
  const other = await ctx.db.matter.create({
    data: {
      reference: "2026-0002",
      title: "Autre",
      area: "civil",
      openedOn: new Date("2026-01-10T00:00:00Z"),
      clientId: client.id,
      createdById: lawyer.id,
    },
  });
  const document = await ctx.db.document.create({
    data: {
      matterId: matter.id,
      title: "contrat.pdf",
      createdById: lawyer.id,
      versions: {
        create: {
          number: 1,
          storageKey: randomUUID(),
          fileName: "contrat.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          sha256: new Uint8Array(32),
          scannedWith: "test",
          scannedAt: new Date(),
          uploadedById: lawyer.id,
        },
      },
    },
  });
  return { lawyer, document, other };
}

describe("application role on document tables", () => {
  it("cannot delete documents or versions", async () => {
    const { document } = await seed();
    await expectCode("DELETE FROM document WHERE id = $1", [document.id], "42501");
    await expectCode("DELETE FROM document_version WHERE document_id = $1", [document.id], "42501");
    await expectCode("TRUNCATE document_version", [], "42501");
  });

  it("cannot rewrite a version, or move a document to another matter", async () => {
    const { document, other } = await seed();
    await expectCode(
      "UPDATE document_version SET storage_key = gen_random_uuid() WHERE document_id = $1",
      [document.id],
      "42501",
    );
    await expectCode(
      "UPDATE document_version SET sha256 = $2 WHERE document_id = $1",
      [document.id, Buffer.alloc(32, 1)],
      "42501",
    );
    await expectCode(
      "UPDATE document SET matter_id = $2 WHERE id = $1",
      [document.id, other.id],
      "42501",
    );
    await expectCode(
      "UPDATE document SET created_by_id = NULL WHERE id = $1",
      [document.id],
      "42501",
    );
  });

  it("can rename and hide a document", async () => {
    const { document, lawyer } = await seed();
    const renamed = await app.query("UPDATE document SET title = 'bail.pdf' WHERE id = $1", [
      document.id,
    ]);
    expect(renamed.rowCount).toBe(1);
    const hidden = await app.query(
      "UPDATE document SET deleted_at = now(), deleted_by_id = $2 WHERE id = $1",
      [document.id, lawyer.id],
    );
    expect(hidden.rowCount).toBe(1);
  });
});

describe("integrity rules", () => {
  it("refuses types outside the allowlist, bad hashes, sizes and half-hidden documents", async () => {
    const { document, lawyer } = await seed();
    const insert = (overrides: Record<string, unknown>) => {
      const row = {
        number: 2,
        storageKey: randomUUID(),
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: Buffer.alloc(32),
        ...overrides,
      };
      return app.query(
        `INSERT INTO document_version (id, document_id, number, storage_key, file_name, mime_type, size_bytes, sha256, scanned_with, scanned_at, uploaded_by_id)
         VALUES (gen_random_uuid(), $1, $2, $3, 'x.pdf', $4, $5, $6, 'test', now(), $7)`,
        [
          document.id,
          row.number,
          row.storageKey,
          row.mimeType,
          row.sizeBytes,
          row.sha256,
          lawyer.id,
        ],
      );
    };
    await expect(insert({ mimeType: "text/html" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ mimeType: "image/svg+xml" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ sha256: Buffer.alloc(16) })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ sizeBytes: 0 })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ number: 1 })).rejects.toMatchObject({ code: "23505" });
    await expectCode(
      "UPDATE document SET deleted_at = now() WHERE id = $1",
      [document.id],
      "23514",
    );
  });
});
