import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestUser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../test/integration.js";

/**
 * Database-level protections for billing, checked with the API's own
 * credentials (the application role): what the application can never do,
 * whatever bug it has. Some rules (frozen invoices, numbering) are triggers
 * that also bind the schema owner.
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

/** SQLSTATE: 42501 insufficient_privilege, 23514 check_violation, 23001 restrict_violation (triggers). */
async function expectCode(client: pg.Client, sql: string, params: unknown[], code: string) {
  await expect(client.query(sql, params)).rejects.toMatchObject({ code });
}

const SELLER = { officeName: "Cabinet", address: "Rabat", ice: "001234567000089", taxId: "1" };
const BUYER = { name: "Client", kind: "person", identifier: null, address: null };

/** A matter, a draft, and an invoice issued the way the application issues one. */
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
      members: { create: { userId: lawyer.id, role: "lead" } },
    },
  });
  const newDraft = async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO invoice (id, matter_id, kind, fee_vat_rate_basis_points, subtotal_centimes, vat_centimes,
         total_centimes, balance_centimes, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, 'invoice', 2000, 10000, 2000, 12000, 12000, $2, now()) RETURNING id`,
      [matter.id, lawyer.id],
    );
    const id = rows[0]?.id ?? "";
    await app.query(
      `INSERT INTO invoice_line (id, invoice_id, position, kind, description, quantity_hundredths,
         unit_price_centimes, vat_rate_basis_points, net_centimes)
       VALUES (gen_random_uuid(), $1, 0, 'fee', 'Honoraires', 100, 10000, 2000, 10000)`,
      [id],
    );
    return id;
  };
  const issue = async (id: string, number: string) => {
    await app.query(
      `INSERT INTO invoice_counter (series, year, last_value) VALUES ('F', 2026, 1)
       ON CONFLICT (series, year) DO UPDATE SET last_value = invoice_counter.last_value + 1`,
    );
    await app.query(
      `UPDATE invoice SET status = 'issued', number = $2, issued_on = '2026-03-02', due_on = '2026-04-01',
         issued_by_id = $3, seller = $4, buyer = $5 WHERE id = $1`,
      [id, number, lawyer.id, JSON.stringify(SELLER), JSON.stringify(BUYER)],
    );
  };
  const draft = await newDraft();
  const issued = await newDraft();
  await issue(issued, "F-2026-0001");
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO payment (id, invoice_id, kind, received_on, amount_centimes, method, recorded_by_id)
     VALUES (gen_random_uuid(), $1, 'payment', '2026-03-05', 5000, 'cash', $2) RETURNING id`,
    [issued, lawyer.id],
  );
  await app.query(
    "UPDATE invoice SET received_centimes = 5000, balance_centimes = 7000 WHERE id = $1",
    [issued],
  );
  return { lawyer, matter, draft, issued, payment: rows[0]?.id ?? "", newDraft, issue };
}

describe("issued invoices", () => {
  it("cannot be changed or deleted, even by the schema owner; only running totals move", async () => {
    const { issued } = await seed();
    for (const client of [app, ctx.owner]) {
      await expectCode(
        client,
        "UPDATE invoice SET total_centimes = 1, subtotal_centimes = 1, vat_centimes = 0, balance_centimes = -4999 WHERE id = $1",
        [issued],
        "23001",
      );
      await expectCode(
        client,
        "UPDATE invoice SET number = 'F-2026-0009' WHERE id = $1",
        [issued],
        "23001",
      );
      await expectCode(client, "UPDATE invoice SET buyer = '{}' WHERE id = $1", [issued], "23001");
      await expectCode(
        client,
        "UPDATE invoice SET status = 'draft' WHERE id = $1",
        [issued],
        "23001",
      );
      await expectCode(client, "DELETE FROM invoice WHERE id = $1", [issued], "23001");
    }
    await app.query(
      "UPDATE invoice SET received_centimes = 12000, balance_centimes = 0 WHERE id = $1",
      [issued],
    );
  });

  it("keep their lines", async () => {
    const { issued } = await seed();
    await expectCode(
      app,
      "UPDATE invoice_line SET unit_price_centimes = 1 WHERE invoice_id = $1",
      [issued],
      "23001",
    );
    await expectCode(app, "DELETE FROM invoice_line WHERE invoice_id = $1", [issued], "23001");
    await expectCode(
      app,
      `INSERT INTO invoice_line (id, invoice_id, position, kind, description, quantity_hundredths,
         unit_price_centimes, vat_rate_basis_points, net_centimes)
       VALUES (gen_random_uuid(), $1, 1, 'fee', 'Ajout', 100, 1, 2000, 1)`,
      [issued],
      "23001",
    );
  });

  it("always add up: balance = total - credited - received, totals = subtotal + VAT", async () => {
    const { issued, draft } = await seed();
    await expectCode(
      app,
      "UPDATE invoice SET received_centimes = 6000 WHERE id = $1",
      [issued],
      "23514",
    );
    await expectCode(app, "UPDATE invoice SET total_centimes = 1 WHERE id = $1", [draft], "23514");
    // Drafts carry no payments or credits.
    await expectCode(
      app,
      "UPDATE invoice SET received_centimes = 1, balance_centimes = 11999 WHERE id = $1",
      [draft],
      "23514",
    );
  });
});

describe("numbering", () => {
  it("creates invoices as drafts only", async () => {
    const { lawyer, matter } = await seed();
    await expectCode(
      app,
      `INSERT INTO invoice (id, matter_id, kind, status, number, fee_vat_rate_basis_points, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, 'invoice', 'issued', 'F-2026-0099', 2000, $2, now())`,
      [matter.id, lawyer.id],
      "23001",
    );
  });

  it("issues only with the counter's current number, which moves up by one", async () => {
    const { draft, lawyer } = await seed();
    const issueAs = (number: string) =>
      app.query(
        `UPDATE invoice SET status = 'issued', number = $2, issued_on = '2026-03-02', due_on = '2026-04-01',
           issued_by_id = $3, seller = $4, buyer = $5 WHERE id = $1`,
        [draft, number, lawyer.id, JSON.stringify(SELLER), JSON.stringify(BUYER)],
      );
    // The counter is at 1 and F-2026-0001 is taken: a jump is refused by the trigger,
    // a reuse by the unique number (23505).
    await expect(issueAs("F-2026-0005")).rejects.toMatchObject({ code: "23001" });
    await expect(issueAs("F-2026-0001")).rejects.toMatchObject({ code: "23505" });
    await expectCode(app, "UPDATE invoice_counter SET last_value = last_value + 5", [], "23001");
    await expectCode(app, "UPDATE invoice_counter SET last_value = 1", [], "23001");
    await expectCode(
      app,
      "INSERT INTO invoice_counter (series, year, last_value) VALUES ('AV', 2026, 7)",
      [],
      "23001",
    );
    await expectCode(app, "DELETE FROM invoice_counter", [], "42501");
    await app.query("UPDATE invoice_counter SET last_value = last_value + 1");
    await issueAs("F-2026-0002");
  });

  it("formats numbers past 9999 without cutting digits", async () => {
    const { draft, lawyer } = await seed();
    await ctx.owner.query(
      "ALTER TABLE invoice_counter DISABLE TRIGGER invoice_counter_steps_by_one",
    );
    await ctx.owner.query("UPDATE invoice_counter SET last_value = 10000");
    await ctx.owner.query(
      "ALTER TABLE invoice_counter ENABLE TRIGGER invoice_counter_steps_by_one",
    );
    await app.query(
      `UPDATE invoice SET status = 'issued', number = 'F-2026-10000', issued_on = '2026-03-02', due_on = '2026-04-01',
         issued_by_id = $2, seller = $3, buyer = $4 WHERE id = $1`,
      [draft, lawyer.id, JSON.stringify(SELLER), JSON.stringify(BUYER)],
    );
  });
});

describe("payments", () => {
  it("are recorded against issued invoices only, never edited or deleted, and voided once", async () => {
    const { draft, payment, lawyer } = await seed();
    await expectCode(
      app,
      `INSERT INTO payment (id, invoice_id, kind, received_on, amount_centimes, method, recorded_by_id)
       VALUES (gen_random_uuid(), $1, 'payment', '2026-03-05', 100, 'cash', $2)`,
      [draft, lawyer.id],
      "23001",
    );
    await expectCode(
      app,
      "UPDATE payment SET amount_centimes = 1 WHERE id = $1",
      [payment],
      "42501",
    );
    await expectCode(app, "DELETE FROM payment WHERE id = $1", [payment], "42501");
    await expectCode(ctx.owner, "DELETE FROM payment WHERE id = $1", [payment], "23001");
    await expectCode(
      app,
      "UPDATE payment SET voided_at = now(), voided_by_id = $2 WHERE id = $1",
      [payment, lawyer.id],
      "23514",
    );
    await app.query(
      "UPDATE payment SET voided_at = now(), voided_by_id = $2, void_reason = 'Saisie en double' WHERE id = $1",
      [payment, lawyer.id],
    );
    await expectCode(
      app,
      "UPDATE payment SET void_reason = 'Autre raison' WHERE id = $1",
      [payment],
      "23001",
    );
  });
});

describe("other billing tables", () => {
  it("keep one settings row, fee agreements and counters for good", async () => {
    const { matter, lawyer } = await seed();
    await expectCode(app, "INSERT INTO billing_settings (id) VALUES (2)", [], "42501");
    await expectCode(app, "DELETE FROM billing_settings", [], "42501");
    await expectCode(app, "UPDATE billing_settings SET ice = '123'", [], "23514");
    await expectCode(app, "UPDATE billing_settings SET vat_rate_basis_points = 5000", [], "23514");
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO fee_agreement (id, matter_id, kind, title, amount_centimes, created_by_id, updated_at)
       VALUES (gen_random_uuid(), $1, 'fixed', 'Forfait', 500000, $2, now()) RETURNING id`,
      [matter.id, lawyer.id],
    );
    await expectCode(app, "DELETE FROM fee_agreement WHERE id = $1", [rows[0]?.id], "42501");
    await expectCode(
      app,
      "UPDATE fee_agreement SET amount_centimes = NULL WHERE id = $1",
      [rows[0]?.id],
      "23514",
    );
    for (const table of [
      "invoice",
      "invoice_line",
      "payment",
      "fee_agreement",
      "invoice_counter",
    ]) {
      await expectCode(app, `TRUNCATE ${table}`, [], "42501");
    }
  });
});
