import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestUser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../test/integration.js";

/**
 * Database-level protections for clients and matters, checked with the
 * API's own credentials (the application role): what the application can
 * never do, whatever bug it has, and the integrity rules PostgreSQL enforces.
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

/** SQLSTATE: 42501 insufficient_privilege, 23514 check_violation, 23505 unique_violation. */
async function expectCode(sql: string, params: unknown[], code: string): Promise<void> {
  await expect(app.query(sql, params)).rejects.toMatchObject({ code });
}

async function seed() {
  const lawyer = await createTestUser(ctx, { role: "lawyer" });
  const other = await createTestUser(ctx, { role: "lawyer" });
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
      members: { create: { userId: lawyer.id, role: "lead" } },
    },
  });
  const admin = await createTestUser(ctx, { role: "admin", mfa: true });
  const grant = await ctx.db.breakGlassGrant.create({
    data: {
      userId: admin.id,
      matterId: matter.id,
      reason: "A sufficiently long reason for testing.",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return { lawyer, other, client, matter, grant };
}

describe("application role on client and matter tables", () => {
  it("cannot delete clients, matters, counters or break-glass grants", async () => {
    const { client, matter, grant } = await seed();
    await expectCode("DELETE FROM client WHERE id = $1", [client.id], "42501");
    await expectCode("DELETE FROM matter WHERE id = $1", [matter.id], "42501");
    await expectCode("DELETE FROM matter_counter", [], "42501");
    await expectCode("DELETE FROM break_glass_grant WHERE id = $1", [grant.id], "42501");
    await expectCode("TRUNCATE matter", [], "42501");
  });

  it("can only end a break-glass grant, never rewrite its matter, holder, reason or times", async () => {
    const { other, grant } = await seed();
    await expectCode(
      "UPDATE break_glass_grant SET expires_at = expires_at + interval '1 hour' WHERE id = $1",
      [grant.id],
      "42501",
    );
    await expectCode(
      "UPDATE break_glass_grant SET user_id = $2 WHERE id = $1",
      [grant.id, other.id],
      "42501",
    );
    await expectCode(
      "UPDATE break_glass_grant SET reason = 'nothing to see here, move along' WHERE id = $1",
      [grant.id],
      "42501",
    );
    const ended = await app.query("UPDATE break_glass_grant SET ended_at = now() WHERE id = $1", [
      grant.id,
    ]);
    expect(ended.rowCount).toBe(1);
  });
});

describe("integrity rules", () => {
  it("allows exactly one lead per matter", async () => {
    const { other, matter } = await seed();
    await expectCode(
      "INSERT INTO matter_member (matter_id, user_id, role) VALUES ($1, $2, 'lead')",
      [matter.id, other.id],
      "23505",
    );
  });

  it("keeps the closing date consistent with the status", async () => {
    const { matter } = await seed();
    await expectCode("UPDATE matter SET status = 'closed' WHERE id = $1", [matter.id], "23514");
    await expectCode(
      "UPDATE matter SET closed_on = '2026-01-01', status = 'closed' WHERE id = $1",
      [matter.id],
      "23514",
    );
    await expectCode(
      "UPDATE matter SET closed_on = '2026-02-01' WHERE id = $1",
      [matter.id],
      "23514",
    );
  });

  it("refuses malformed references, blank names and over-long break-glass grants", async () => {
    const { matter, client, grant } = await seed();
    await expectCode("UPDATE matter SET reference = 'X' WHERE id = $1", [matter.id], "23514");
    await expectCode("UPDATE matter SET title = '   ' WHERE id = $1", [matter.id], "23514");
    await expectCode("UPDATE client SET search_name = ' ' WHERE id = $1", [client.id], "23514");
    await expectCode(
      "UPDATE client SET identifier = 'AB1' WHERE id = $1",
      [client.id],
      "23514", // identifier without its search key
    );
    // The owner role is used here only because the app role may not touch these columns.
    await expect(
      ctx.owner.query(
        "UPDATE break_glass_grant SET expires_at = created_at + interval '5 hours' WHERE id = $1",
        [grant.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      ctx.owner.query("UPDATE break_glass_grant SET reason = 'too short' WHERE id = $1", [
        grant.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
