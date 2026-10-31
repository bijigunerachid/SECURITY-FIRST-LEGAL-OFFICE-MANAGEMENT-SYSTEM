import {
  billingSettingsResponseSchema,
  billingSummaryResponseSchema,
  feeAgreementResponseSchema,
  invoiceListResponseSchema,
  invoiceResponseSchema,
  matterInvoiceListResponseSchema,
  type InvoiceDetail,
} from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { officeToday } from "../../modules/matters/office-date.js";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addMember,
  auditActions,
  createClient,
  createMatter,
  person,
  type Person,
} from "../../test/matters.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await integrationContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

const today = () => officeToday();
const year = () => today().slice(0, 4);
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The details an invoice needs, written directly (the API path is tested on its own). */
async function completeSettings(extra = "") {
  await ctx.owner.query(
    `UPDATE billing_settings SET office_name = 'Cabinet Test', address = '1 rue de la Paix, Rabat',
       ice = '001234567000089', tax_id = '12345678' ${extra}`,
  );
}

const FEE = {
  kind: "fee",
  description: "Honoraires",
  quantityHundredths: 100,
  unitPriceCentimes: 1_000_000,
};
const STAMPS = {
  kind: "disbursement",
  description: "Timbres fiscaux",
  quantityHundredths: 100,
  unitPriceCentimes: 35_000,
};
/** FEE + STAMPS at 20 %: 10 000,00 + 2 000,00 VAT + 350,00 = 12 350,00. */
const TOTAL = 1_235_000;

async function team() {
  const lead = await person(ctx, "lawyer");
  const assistant = await person(ctx, "assistant");
  const client = await createClient(lead, {
    name: "Atlas Immobilier SARL",
    kind: "company",
    identifier: "002233445000067",
    address: "Bd Zerktouni, Casablanca",
  });
  const matter = await createMatter(lead, client.id);
  await addMember(lead, matter.id, assistant);
  return { lead, assistant, client, matter, base: `/api/matters/${matter.id}` };
}

async function draft(who: Person, base: string, lines: object[] = [FEE, STAMPS]) {
  const res = await who.browser.send("post", `${base}/invoices`, { lines });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return invoiceResponseSchema.parse(res.body).invoice;
}

async function issue(who: Person, base: string, id: string): Promise<InvoiceDetail> {
  const res = await who.browser.send("post", `${base}/invoices/${id}/issue`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return invoiceResponseSchema.parse(res.body).invoice;
}

async function issued(who: Person, base: string, lines?: object[]) {
  return issue(who, base, (await draft(who, base, lines)).id);
}

async function pay(who: Person, base: string, id: string, body: Record<string, unknown>) {
  return who.browser.send("post", `${base}/invoices/${id}/payments`, {
    receivedOn: today(),
    method: "transfer",
    ...body,
  });
}

describe("office billing details", () => {
  it("are read by everyone and list what is still missing before invoices can be issued", async () => {
    const assistant = await person(ctx, "assistant");
    const res = await assistant.browser.send("get", "/api/billing/settings");
    expect(res.status).toBe(200);
    const { settings } = billingSettingsResponseSchema.parse(res.body);
    expect(settings.missing).toEqual(["officeName", "address", "ice", "taxId"]);
    expect(settings.vatRateBasisPoints).toBe(2000);
  });

  it("are changed only by an administrator who re-entered the password, and validated", async () => {
    const lawyer = await person(ctx, "lawyer");
    expect(
      (await lawyer.browser.send("patch", "/api/billing/settings", { officeName: "X" })).status,
    ).toBe(404);
    const admin = await person(ctx, "admin");
    const stale = await admin.browser.send("patch", "/api/billing/settings", { officeName: "X" });
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe("reauthentication_required");

    expect((await admin.browser.reauth(admin.user)).status).toBe(204);
    for (const body of [
      { ice: "00123456700008" },
      { rib: "12345" },
      { taxId: "12a" },
      { vatRateBasisPoints: 3500 },
      { paymentTermDays: -1 },
      { officeName: "X", unknown: 1 },
    ]) {
      expect((await admin.browser.send("patch", "/api/billing/settings", body)).status).toBe(400);
    }
    const res = await admin.browser.send("patch", "/api/billing/settings", {
      officeName: "Cabinet Alami",
      address: "12 avenue Hassan II, Rabat",
      ice: "001 234 567 000 089",
      taxId: "12345678",
      rib: "011 780 0000 1234 5678 9012 34",
      vatRateBasisPoints: 1000,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { settings } = billingSettingsResponseSchema.parse(res.body);
    expect(settings).toMatchObject({
      ice: "001234567000089",
      rib: "011780000012345678901234",
      vatRateBasisPoints: 1000,
      missing: [],
    });
    expect(
      (await auditActions(ctx)).find((e) => e.action === "billing.settings.update"),
    ).toMatchObject({
      outcome: "success",
      metadata: { fields: ["officeName", "address", "ice", "taxId", "rib", "vatRateBasisPoints"] },
    });
  });
});

describe("draft invoices", () => {
  it("are prepared by the team, with totals computed by the server only", async () => {
    const { assistant, base } = await team();
    const created = await draft(assistant, base);
    expect(created).toMatchObject({
      status: "draft",
      number: null,
      clientName: "Atlas Immobilier SARL",
      subtotalCentimes: 1_035_000,
      vatCentimes: 200_000,
      totalCentimes: TOTAL,
      paymentState: null,
      vatBreakdown: [
        { rateBasisPoints: 2000, netCentimes: 1_000_000, vatCentimes: 200_000 },
        { rateBasisPoints: 0, netCentimes: 35_000, vatCentimes: 0 },
      ],
      permissions: { edit: true, delete: true, issue: false, recordPayment: false },
    });
    // Totals, rates and numbers are never taken from the client.
    for (const body of [
      { lines: [FEE], totalCentimes: 1 },
      { lines: [{ ...FEE, vatRateBasisPoints: 0 }] },
      { lines: [{ ...FEE, netCentimes: 1 }] },
      { lines: [], number: "F-2026-0001" },
      { lines: [{ ...FEE, quantityHundredths: 0 }] },
      { lines: [{ ...FEE, unitPriceCentimes: 10.5 }] },
      { lines: [{ ...FEE, unitPriceCentimes: -1 }] },
      { lines: [{ ...FEE, description: " " }] },
      { lines: Array.from({ length: 51 }, () => FEE) },
    ]) {
      expect((await assistant.browser.send("post", `${base}/invoices`, body)).status).toBe(400);
    }
  });

  it("follow the office VAT rate until issued, and can be edited and deleted", async () => {
    const { assistant, base } = await team();
    const created = await draft(assistant, base);
    await ctx.owner.query("UPDATE billing_settings SET vat_rate_basis_points = 1000");
    const reread = await assistant.browser.send("get", `${base}/invoices/${created.id}`);
    expect(invoiceResponseSchema.parse(reread.body).invoice).toMatchObject({
      feeVatRateBasisPoints: 1000,
      vatCentimes: 100_000,
    });
    const edited = await assistant.browser.send("patch", `${base}/invoices/${created.id}`, {
      notes: "Provision sur honoraires",
      lines: [FEE],
    });
    expect(invoiceResponseSchema.parse(edited.body).invoice).toMatchObject({
      notes: "Provision sur honoraires",
      lines: [{ kind: "fee", vatRateBasisPoints: 1000, netCentimes: 1_000_000 }],
      totalCentimes: 1_100_000,
    });
    expect((await assistant.browser.send("delete", `${base}/invoices/${created.id}`)).status).toBe(
      204,
    );
    expect((await assistant.browser.send("get", `${base}/invoices/${created.id}`)).status).toBe(
      404,
    );
    expect((await auditActions(ctx)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["invoice.create", "invoice.update", "invoice.delete"]),
    );
  });
});

describe("issuing", () => {
  it("is for lawyers on the team, needs the office details, and refuses empty invoices", async () => {
    const { lead, assistant, base } = await team();
    const created = await draft(assistant, base);
    expect(
      (await assistant.browser.send("post", `${base}/invoices/${created.id}/issue`)).status,
    ).toBe(403);
    const incomplete = await lead.browser.send("post", `${base}/invoices/${created.id}/issue`);
    expect(incomplete.status).toBe(409);
    await completeSettings();
    const empty = await draft(lead, base, []);
    const refused = await lead.browser.send("post", `${base}/invoices/${empty.id}/issue`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields).toEqual([{ path: "lines", issue: "custom" }]);
    // Nothing was numbered by the refused attempts.
    const done = await issue(lead, base, created.id);
    expect(done.number).toBe(`F-${year()}-0001`);
  });

  it("numbers, dates and freezes the invoice with the office and client details of the day", async () => {
    const { lead, client, base } = await team();
    await completeSettings(", payment_term_days = 15");
    const invoice = await issued(lead, base);
    expect(invoice).toMatchObject({
      status: "issued",
      number: `F-${year()}-0001`,
      issuedOn: today(),
      dueOn: plusDays(today(), 15),
      totalCentimes: TOTAL,
      balanceCentimes: TOTAL,
      paymentState: "unpaid",
      seller: { officeName: "Cabinet Test", ice: "001234567000089", taxId: "12345678" },
      buyer: { name: "Atlas Immobilier SARL", identifier: "002233445000067", kind: "company" },
      permissions: {
        edit: false,
        delete: false,
        issue: false,
        creditNote: true,
        recordPayment: true,
      },
    });
    const path = `${base}/invoices/${invoice.id}`;
    expect((await lead.browser.send("patch", path, { notes: "x" })).status).toBe(409);
    expect((await lead.browser.send("delete", path)).status).toBe(409);
    expect((await lead.browser.send("post", `${path}/issue`)).status).toBe(409);

    // Later changes to the client or the office do not rewrite an issued invoice.
    expect(
      (await lead.browser.send("patch", `/api/clients/${client.id}`, { name: "Autre nom" })).status,
    ).toBe(204);
    await ctx.owner.query(
      "UPDATE billing_settings SET office_name = 'Nouveau nom', vat_rate_basis_points = 1000",
    );
    const reread = invoiceResponseSchema.parse((await lead.browser.send("get", path)).body).invoice;
    expect(reread.buyer?.name).toBe("Atlas Immobilier SARL");
    expect(reread.clientName).toBe("Atlas Immobilier SARL");
    const listed = invoiceListResponseSchema.parse(
      (await lead.browser.send("get", "/api/invoices")).body,
    );
    expect(listed.invoices[0]?.clientName).toBe("Atlas Immobilier SARL");
    expect(reread.seller?.officeName).toBe("Cabinet Test");
    expect(reread.vatCentimes).toBe(200_000);
    expect((await auditActions(ctx)).find((e) => e.action === "invoice.issue")?.metadata).toEqual({
      matterId: expect.any(String),
      number: `F-${year()}-0001`,
      totalCentimes: TOTAL,
    });
  });

  it("gives gap-free numbers: deleted drafts use none, and parallel issues never collide", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const abandoned = await draft(lead, base);
    expect((await lead.browser.send("delete", `${base}/invoices/${abandoned.id}`)).status).toBe(
      204,
    );
    const drafts = await Promise.all(Array.from({ length: 6 }, () => draft(lead, base)));
    const results = await Promise.all(
      drafts.map((d) => lead.browser.send("post", `${base}/invoices/${d.id}/issue`)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const numbers = results.map((r) => invoiceResponseSchema.parse(r.body).invoice.number).sort();
    expect(numbers).toEqual(
      ["0001", "0002", "0003", "0004", "0005", "0006"].map((n) => `F-${year()}-${n}`),
    );
  });

  it("issues a draft once even when asked twice at the same time", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const created = await draft(lead, base);
    const results = await Promise.all([
      lead.browser.send("post", `${base}/invoices/${created.id}/issue`),
      lead.browser.send("post", `${base}/invoices/${created.id}/issue`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await ctx.owner.query<{ last_value: number }>(
      "SELECT last_value FROM invoice_counter",
    );
    expect(rows).toEqual([{ last_value: 1 }]);
  });
});

describe("credit notes", () => {
  it("correct an issued invoice, in their own series, never beyond its total", async () => {
    const { lead, assistant, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    const path = `${base}/invoices/${invoice.id}`;
    expect((await assistant.browser.send("post", `${path}/credit-note`)).status).toBe(403);
    const pending = await draft(lead, base);
    expect(
      (await lead.browser.send("post", `${base}/invoices/${pending.id}/credit-note`)).status,
    ).toBe(409);

    const res = await lead.browser.send("post", `${path}/credit-note`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = invoiceResponseSchema.parse(res.body).invoice;
    expect(note).toMatchObject({
      kind: "credit_note",
      status: "draft",
      creditedInvoice: { id: invoice.id, number: invoice.number },
      totalCentimes: TOTAL,
      permissions: { edit: true, issue: true },
    });
    // An assistant cannot change a credit note, even as a draft.
    expect(
      (await assistant.browser.send("patch", `${base}/invoices/${note.id}`, { lines: [] })).status,
    ).toBe(403);
    // Partial credit: only the disbursement.
    await lead.browser.send("patch", `${base}/invoices/${note.id}`, { lines: [STAMPS] });
    const done = await issue(lead, base, note.id);
    expect(done).toMatchObject({ number: `AV-${year()}-0001`, totalCentimes: 35_000, dueOn: null });

    const original = invoiceResponseSchema.parse(
      (await lead.browser.send("get", path)).body,
    ).invoice;
    expect(original).toMatchObject({
      creditedCentimes: 35_000,
      balanceCentimes: TOTAL - 35_000,
      creditNotes: [{ id: note.id, number: `AV-${year()}-0001`, status: "issued" }],
    });
    // A full second credit note would credit more than the invoice.
    const second = invoiceResponseSchema.parse(
      (await lead.browser.send("post", `${path}/credit-note`)).body,
    ).invoice;
    const tooMuch = await lead.browser.send("post", `${base}/invoices/${second.id}/issue`);
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.fields).toEqual([{ path: "lines", issue: "custom" }]);
  });

  it("keep the VAT rate of the invoice they correct", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base, [FEE]);
    await ctx.owner.query("UPDATE billing_settings SET vat_rate_basis_points = 1000");
    const note = invoiceResponseSchema.parse(
      (await lead.browser.send("post", `${base}/invoices/${invoice.id}/credit-note`)).body,
    ).invoice;
    const done = await issue(lead, base, note.id);
    expect(done).toMatchObject({ feeVatRateBasisPoints: 2000, totalCentimes: 1_200_000 });
  });
});

describe("payments", () => {
  it("move the invoice from unpaid to partial to paid, and never beyond what is due", async () => {
    const { lead, assistant, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    expect((await pay(assistant, base, invoice.id, { amountCentimes: 100 })).status).toBe(403);

    const first = await pay(lead, base, invoice.id, {
      amountCentimes: 500_000,
      method: "cheque",
      reference: "CHQ 0042",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(invoiceResponseSchema.parse(first.body).invoice).toMatchObject({
      paymentState: "partial",
      receivedCentimes: 500_000,
      balanceCentimes: TOTAL - 500_000,
    });
    const over = await pay(lead, base, invoice.id, { amountCentimes: TOTAL });
    expect(over.status).toBe(400);
    expect(over.body.error.fields).toEqual([{ path: "amountCentimes", issue: "custom" }]);
    const rest = await pay(lead, base, invoice.id, {
      amountCentimes: TOTAL - 500_000,
      method: "cash",
    });
    expect(invoiceResponseSchema.parse(rest.body).invoice).toMatchObject({
      paymentState: "paid",
      balanceCentimes: 0,
      payments: [
        { kind: "payment", method: "cheque", reference: "CHQ 0042", amountCentimes: 500_000 },
        { kind: "payment", method: "cash" },
      ],
    });
  });

  it("refuse dates in the future or before the invoice, drafts and credit notes", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    for (const receivedOn of [plusDays(today(), 1), plusDays(today(), -1)]) {
      const res = await pay(lead, base, invoice.id, { amountCentimes: 100, receivedOn });
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toEqual([{ path: "receivedOn", issue: "custom" }]);
    }
    const pending = await draft(lead, base);
    expect((await pay(lead, base, pending.id, { amountCentimes: 100 })).status).toBe(409);
    const note = invoiceResponseSchema.parse(
      (await lead.browser.send("post", `${base}/invoices/${invoice.id}/credit-note`)).body,
    ).invoice;
    await issue(lead, base, note.id);
    expect((await pay(lead, base, note.id, { amountCentimes: 100 })).status).toBe(409);
  });

  it("cannot overpay when two payments of the full balance arrive at once", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => pay(lead, base, invoice.id, { amountCentimes: TOTAL })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400, 400]);
    const { rows } = await ctx.owner.query<{ received: string; balance: string }>(
      "SELECT received_centimes AS received, balance_centimes AS balance FROM invoice WHERE id = $1",
      [invoice.id],
    );
    expect(rows).toEqual([{ received: String(TOTAL), balance: "0" }]);
  });

  it("refund only what was overpaid, and void mistakes with a reason, refunds first", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    const paid = invoiceResponseSchema.parse(
      (await pay(lead, base, invoice.id, { amountCentimes: TOTAL })).body,
    ).invoice;
    expect((await pay(lead, base, invoice.id, { kind: "refund", amountCentimes: 1 })).status).toBe(
      400,
    );

    // A credit note on a paid invoice leaves money to give back.
    const note = invoiceResponseSchema.parse(
      (await lead.browser.send("post", `${base}/invoices/${invoice.id}/credit-note`)).body,
    ).invoice;
    await lead.browser.send("patch", `${base}/invoices/${note.id}`, { lines: [STAMPS] });
    await issue(lead, base, note.id);
    const path = `${base}/invoices/${invoice.id}`;
    const overpaid = invoiceResponseSchema.parse(
      (await lead.browser.send("get", path)).body,
    ).invoice;
    expect(overpaid).toMatchObject({ paymentState: "overpaid", balanceCentimes: -35_000 });
    expect(
      (await pay(lead, base, invoice.id, { kind: "refund", amountCentimes: 35_001 })).status,
    ).toBe(400);
    const refunded = invoiceResponseSchema.parse(
      (await pay(lead, base, invoice.id, { kind: "refund", amountCentimes: 35_000 })).body,
    ).invoice;
    expect(refunded).toMatchObject({
      paymentState: "paid",
      balanceCentimes: 0,
      receivedCentimes: TOTAL - 35_000,
    });

    const paymentId = paid.payments[0]?.id ?? "";
    const refundId = refunded.payments[1]?.id ?? "";
    expect(
      (await lead.browser.send("post", `${path}/payments/${paymentId}/void`, { reason: "x" }))
        .status,
    ).toBe(400);
    const early = await lead.browser.send("post", `${path}/payments/${paymentId}/void`, {
      reason: "Chèque rejeté par la banque",
    });
    expect(early.status).toBe(409);
    expect(
      (
        await lead.browser.send("post", `${path}/payments/${refundId}/void`, {
          reason: "Saisie en double",
        })
      ).status,
    ).toBe(200);
    const voided = await lead.browser.send("post", `${path}/payments/${paymentId}/void`, {
      reason: "Chèque rejeté par la banque",
    });
    expect(voided.status).toBe(200);
    expect(invoiceResponseSchema.parse(voided.body).invoice).toMatchObject({
      receivedCentimes: 0,
      balanceCentimes: TOTAL - 35_000,
      paymentState: "unpaid",
      payments: [
        { id: paymentId, voidReason: "Chèque rejeté par la banque", voidedAt: expect.any(String) },
        { id: refundId, voidReason: "Saisie en double" },
      ],
    });
    expect(
      (
        await lead.browser.send("post", `${path}/payments/${paymentId}/void`, {
          reason: "encore une fois",
        })
      ).status,
    ).toBe(409);
    expect((await auditActions(ctx)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["payment.record", "payment.refund", "payment.void"]),
    );
  });
});

describe("fee agreements", () => {
  it("are written by lawyers on the team, read by the team, and ended rather than deleted", async () => {
    const { lead, assistant, base } = await team();
    const path = `${base}/fee-agreements`;
    expect(
      (await lead.browser.send("post", path, { kind: "fixed", title: "Forfait" })).status,
    ).toBe(400);
    expect(
      (await assistant.browser.send("post", path, { kind: "other", title: "Accord" })).status,
    ).toBe(403);
    const res = await lead.browser.send("post", path, {
      kind: "hourly",
      title: "Convention d'honoraires",
      hourlyRateCentimes: 80_000,
      signedOn: "2026-01-15",
      terms: "Facturation mensuelle",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const agreement = feeAgreementResponseSchema.parse(res.body).feeAgreement;
    expect(agreement).toMatchObject({ hourlyRateCentimes: 80_000, endedOn: null });

    const list = await assistant.browser.send("get", path);
    expect(list.body.feeAgreements).toHaveLength(1);
    const early = await lead.browser.send("patch", `${path}/${agreement.id}`, {
      endedOn: "2026-01-01",
    });
    expect(early.status).toBe(400);
    expect(
      (await lead.browser.send("patch", `${path}/${agreement.id}`, { hourlyRateCentimes: null }))
        .status,
    ).toBe(400);
    const ended = await lead.browser.send("patch", `${path}/${agreement.id}`, {
      endedOn: "2026-06-30",
    });
    expect(feeAgreementResponseSchema.parse(ended.body).feeAgreement.endedOn).toBe("2026-06-30");
    expect((await auditActions(ctx)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["fee_agreement.create", "fee_agreement.end"]),
    );
  });
});

describe("access", () => {
  async function scene() {
    const t = await team();
    await completeSettings();
    const invoice = await issued(t.lead, t.base);
    const pending = await draft(t.lead, t.base);
    const doomed = await draft(t.lead, t.base);
    const payment = invoiceResponseSchema.parse(
      (await pay(t.lead, t.base, invoice.id, { amountCentimes: 100 })).body,
    ).invoice.payments[0];
    const agreement = feeAgreementResponseSchema.parse(
      (
        await t.lead.browser.send("post", `${t.base}/fee-agreements`, {
          kind: "other",
          title: "Accord",
        })
      ).body,
    ).feeAgreement;
    const i = `${t.base}/invoices/${invoice.id}`;
    const d = `${t.base}/invoices/${pending.id}`;
    const requests: [string, "get" | "post" | "patch" | "delete", string, object?][] = [
      ["list invoices", "get", `${t.base}/invoices`],
      ["create draft", "post", `${t.base}/invoices`, { lines: [FEE] }],
      ["read invoice", "get", i],
      ["edit draft", "patch", d, { notes: "x" }],
      ["issue", "post", `${d}/issue`],
      ["credit note", "post", `${i}/credit-note`],
      [
        "record payment",
        "post",
        `${i}/payments`,
        { receivedOn: today(), amountCentimes: 1, method: "cash" },
      ],
      [
        "void payment",
        "post",
        `${i}/payments/${payment?.id ?? ""}/void`,
        { reason: "erreur de saisie" },
      ],
      ["list agreements", "get", `${t.base}/fee-agreements`],
      ["create agreement", "post", `${t.base}/fee-agreements`, { kind: "other", title: "B" }],
      ["edit agreement", "patch", `${t.base}/fee-agreements/${agreement.id}`, { title: "C" }],
      ["delete draft", "delete", `${t.base}/invoices/${doomed.id}`],
    ];
    return { ...t, requests };
  }

  it("outsiders get 404 everywhere; administrators with break-glass access get no billing", async () => {
    const { matter, requests } = await scene();
    const outsider = await person(ctx, "lawyer");
    const outsiderAssistant = await person(ctx, "assistant");
    const admin = await person(ctx, "admin", { reauth: true });
    expect(
      (
        await admin.browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: "Audit urgent demandé par le bâtonnier",
        })
      ).status,
    ).toBe(201);
    for (const [name, method, path, body] of requests) {
      expect((await outsider.browser.send(method, path, body)).status, `outsider: ${name}`).toBe(
        404,
      );
      expect(
        (await outsiderAssistant.browser.send(method, path, body)).status,
        `outsider assistant: ${name}`,
      ).toBe(404);
      expect((await admin.browser.send(method, path, body)).status, `break-glass: ${name}`).toBe(
        403,
      );
    }
  });

  it("assistants on the team read and prepare drafts; lawyers on the team do everything", async () => {
    const { assistant, requests } = await scene();
    const assistantAllowed = new Set([
      "list invoices",
      "create draft",
      "read invoice",
      "edit draft",
      "delete draft",
      "list agreements",
    ]);
    for (const [name, method, path, body] of requests) {
      const status = (await assistant.browser.send(method, path, body)).status;
      if (assistantAllowed.has(name)) expect(status, `assistant: ${name}`).toBeLessThan(300);
      else expect(status, `assistant: ${name}`).toBe(403);
    }
    const { lead, requests: leadRequests } = await scene();
    for (const [name, method, path, body] of leadRequests) {
      expect((await lead.browser.send(method, path, body)).status, `lead: ${name}`).toBeLessThan(
        300,
      );
    }
  });

  it("refuses an invoice or payment of another matter, and anonymous callers", async () => {
    const one = await scene();
    const other = await createMatter(one.lead, (await createClient(one.lead)).id);
    const invoiceId = matterInvoiceListResponseSchema.parse(
      (await one.lead.browser.send("get", `${one.base}/invoices`)).body,
    ).invoices[0]?.id;
    expect(
      (await one.lead.browser.send("get", `/api/matters/${other.id}/invoices/${invoiceId ?? ""}`))
        .status,
    ).toBe(404);
    expect((await one.lead.browser.send("get", `${one.base}/invoices/not-a-uuid`)).status).toBe(
      404,
    );
    const anonymous = new Browser(ctx);
    expect((await anonymous.send("get", `${one.base}/invoices`)).status).toBe(401);
    expect((await anonymous.send("get", "/api/billing/settings")).status).toBe(401);
  });

  it("lists and exports only the person's own matters", async () => {
    const mine = await team();
    const theirs = await team();
    await completeSettings();
    await issued(mine.lead, mine.base);
    await issued(theirs.lead, theirs.base);
    const list = invoiceListResponseSchema.parse(
      (await mine.assistant.browser.send("get", "/api/invoices")).body,
    );
    expect(list.invoices.map((i) => i.matter.id)).toEqual([mine.matter.id]);
    const admin = await person(ctx, "admin");
    expect((await admin.browser.send("get", "/api/invoices")).status).toBe(404);
    const range = `from=${year()}-01-01&to=${year()}-12-31`;
    expect((await mine.assistant.browser.send("get", `/api/invoices/export?${range}`)).status).toBe(
      404,
    );
    const csv = await mine.lead.browser.send("get", `/api/invoices/export?${range}`);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n").filter(Boolean)).toHaveLength(2);
  });
});

describe("invoice list", () => {
  it("filters drafts, outstanding and overdue invoices", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const pending = await draft(lead, base);
    const unpaid = await issued(lead, base);
    const settled = await issued(lead, base);
    await pay(lead, base, settled.id, { amountCentimes: TOTAL });
    const late = await issued(lead, base);
    // Move one due date into the past (the owner lifts the freeze for this test only).
    await ctx.owner.query("ALTER TABLE invoice DISABLE TRIGGER invoice_frozen_once_issued");
    await ctx.owner.query(
      "UPDATE invoice SET issued_on = issued_on - 40, due_on = due_on - 40 WHERE id = $1",
      [late.id],
    );
    await ctx.owner.query("ALTER TABLE invoice ENABLE TRIGGER invoice_frozen_once_issued");

    const view = async (name: string) =>
      invoiceListResponseSchema
        .parse((await lead.browser.send("get", `/api/invoices?view=${name}`)).body)
        .invoices.map((i) => i.id)
        .sort();
    expect(await view("all")).toEqual([pending.id, unpaid.id, settled.id, late.id].sort());
    expect(await view("draft")).toEqual([pending.id]);
    expect(await view("outstanding")).toEqual([unpaid.id, late.id].sort());
    expect(await view("overdue")).toEqual([late.id]);
    expect((await lead.browser.send("get", "/api/invoices?view=unknown")).status).toBe(400);
  });
});

describe("export", () => {
  it("writes the sales journal as CSV, credit notes negative, formulas neutralised, and audits it", async () => {
    const lead = await person(ctx, "lawyer");
    const client = await createClient(lead, { name: '=HYPERLINK("http://evil.test";"x")' });
    const matter = await createMatter(lead, client.id);
    const base = `/api/matters/${matter.id}`;
    await completeSettings();
    const invoice = await issued(lead, base);
    const note = invoiceResponseSchema.parse(
      (await lead.browser.send("post", `${base}/invoices/${invoice.id}/credit-note`)).body,
    ).invoice;
    await lead.browser.send("patch", `${base}/invoices/${note.id}`, { lines: [STAMPS] });
    await issue(lead, base, note.id);

    const range = { from: `${year()}-01-01`, to: `${year()}-12-31` };
    const res = await lead.browser.send(
      "get",
      `/api/invoices/export?from=${range.from}&to=${range.to}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="factures-${range.from}-${range.to}.csv"`,
    );
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Type;Numéro;Date;Échéance;Facture d'origine;Dossier;Client;Identifiant client;HT;TVA;TTC;Avoirs;Encaissé;Solde",
    );
    const formula = '"\'=HYPERLINK(""http://evil.test"";""x"")"';
    expect(lines[1]).toBe(
      `Facture;F-${year()}-0001;${today()};${invoice.dueOn ?? ""};;${matter.reference};${formula};;10350,00;2000,00;12350,00;350,00;0,00;12000,00`,
    );
    expect(lines[2]).toBe(
      `Avoir;AV-${year()}-0001;${today()};;F-${year()}-0001;${matter.reference};${formula};;-350,00;0,00;-350,00;;;`,
    );
    expect((await auditActions(ctx)).find((e) => e.action === "invoice.export")?.metadata).toEqual({
      ...range,
      rows: 2,
    });
    for (const query of [
      "from=2026-02-01&to=2026-01-01",
      "from=2025-01-01&to=2026-12-31",
      "from=x&to=y",
    ]) {
      expect((await lead.browser.send("get", `/api/invoices/export?${query}`)).status).toBe(400);
    }
  });
});

describe("office summary", () => {
  it("gives administrators monthly amounts without names; nobody else", async () => {
    const { lead, base } = await team();
    await completeSettings();
    const invoice = await issued(lead, base);
    await pay(lead, base, invoice.id, { amountCentimes: 200_000 });
    const admin = await person(ctx, "admin");
    expect((await lead.browser.send("get", `/api/billing/summary?year=${year()}`)).status).toBe(
      404,
    );
    const res = await admin.browser.send("get", `/api/billing/summary?year=${year()}`);
    expect(res.status).toBe(200);
    const { summary } = billingSummaryResponseSchema.parse(res.body);
    const month = Number(today().slice(5, 7));
    expect(summary.months[month - 1]).toEqual({
      month,
      invoiceCount: 1,
      invoicedCentimes: TOTAL,
      creditedCentimes: 0,
      receivedCentimes: 200_000,
    });
    expect(summary.outstandingCentimes).toBe(TOTAL - 200_000);
    expect(JSON.stringify(res.body)).not.toContain("Atlas");
  });
});
