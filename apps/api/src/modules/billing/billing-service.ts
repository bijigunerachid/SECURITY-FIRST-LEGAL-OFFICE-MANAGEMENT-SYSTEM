import {
  LIST_PAGE_SIZE,
  REQUIRED_BILLING_FIELDS,
  buyerSnapshotSchema,
  paymentStateOf,
  sellerSnapshotSchema,
  type BillingSettings,
  type BillingSummary,
  type BuyerSnapshot,
  type FeeAgreement,
  type InvoiceDetail,
  type InvoiceSummary,
  type InvoiceView,
  type Payment,
  type SellerSnapshot,
  type createFeeAgreementRequestSchema,
  type createInvoiceRequestSchema,
  type recordPaymentRequestSchema,
  type updateBillingSettingsRequestSchema,
  type updateFeeAgreementRequestSchema,
  type updateInvoiceRequestSchema,
} from "@lexora/shared";
import { ZodError, type z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { conflict, forbidden, notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit, type AuditEventInput } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import { authorizeMatter } from "../matters/matter-access.js";
import { fromDbDate, officeToday, toDbDate } from "../matters/office-date.js";
import {
  billingMattersWhere,
  canExportInvoices,
  canManageBillingSettings,
  canOnMatter,
  type Actor,
} from "../policy/matter-policy.js";
import { toCsv, type CsvCell } from "./csv.js";
import { computeInvoice, toNumber, type LineInput } from "./money.js";

type UpdateSettings = z.output<typeof updateBillingSettingsRequestSchema>;
type CreateFeeAgreement = z.output<typeof createFeeAgreementRequestSchema>;
type UpdateFeeAgreement = z.output<typeof updateFeeAgreementRequestSchema>;
type CreateInvoice = z.output<typeof createInvoiceRequestSchema>;
type UpdateInvoice = z.output<typeof updateInvoiceRequestSchema>;
type RecordPayment = z.output<typeof recordPaymentRequestSchema>;
type Tx = Parameters<Parameters<Database["$transaction"]>[0]>[0];

function fieldError(path: string, message: string): ZodError {
  return new ZodError([{ code: "custom", path: [path], message, input: undefined }]);
}

const changedFields = (changes: object) =>
  Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);

/** Only the fields present in a partial update (absent ones are left unchanged). */
function present<T extends object>(changes: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** A calendar day `days` after `isoDate` (YYYY-MM-DD). */
function addDays(isoDate: string, days: number): string {
  const date = toDbDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return fromDbDate(date);
}

const SETTINGS_ID = 1;
const person = { select: { id: true, displayName: true } } as const;

// --- Settings ---------------------------------------------------------------------

type SettingsRow = Prisma.BillingSettingsGetPayload<object>;

function missingFields(row: SettingsRow): BillingSettings["missing"] {
  return REQUIRED_BILLING_FIELDS.filter((field) => row[field] === null);
}

function toSettings(row: SettingsRow): BillingSettings {
  return {
    officeName: row.officeName,
    address: row.address,
    phone: row.phone,
    email: row.email,
    ice: row.ice,
    taxId: row.taxId,
    professionalTaxId: row.professionalTaxId,
    barAssociation: row.barAssociation,
    bankName: row.bankName,
    rib: row.rib,
    vatRateBasisPoints: row.vatRateBasisPoints,
    paymentTermDays: row.paymentTermDays,
    invoiceNote: row.invoiceNote,
    missing: missingFields(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sellerOf(row: SettingsRow): SellerSnapshot {
  if (!row.officeName || !row.address || !row.ice || !row.taxId) {
    throw conflict("billing details incomplete");
  }
  return {
    officeName: row.officeName,
    address: row.address,
    phone: row.phone,
    email: row.email,
    ice: row.ice,
    taxId: row.taxId,
    professionalTaxId: row.professionalTaxId,
    barAssociation: row.barAssociation,
    bankName: row.bankName,
    rib: row.rib,
    invoiceNote: row.invoiceNote,
  };
}

// --- Fee agreements -----------------------------------------------------------------

const feeAgreementSelect = {
  id: true,
  matterId: true,
  kind: true,
  title: true,
  amountCentimes: true,
  hourlyRateCentimes: true,
  signedOn: true,
  terms: true,
  endedOn: true,
  createdBy: person,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FeeAgreementSelect;

type FeeAgreementRow = Prisma.FeeAgreementGetPayload<{ select: typeof feeAgreementSelect }>;

const optionalAmount = (value: bigint | null) => (value === null ? null : toNumber(value));
const toBigInt = (value: number | null | undefined) =>
  value === undefined || value === null ? null : BigInt(value);
const optionalDate = (value: Date | null) => (value === null ? null : fromDbDate(value));

function toFeeAgreement(row: FeeAgreementRow): FeeAgreement {
  return {
    id: row.id,
    matterId: row.matterId,
    kind: row.kind,
    title: row.title,
    amountCentimes: optionalAmount(row.amountCentimes),
    hourlyRateCentimes: optionalAmount(row.hourlyRateCentimes),
    signedOn: optionalDate(row.signedOn),
    terms: row.terms,
    endedOn: optionalDate(row.endedOn),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Invoices -----------------------------------------------------------------------

const summarySelect = {
  id: true,
  kind: true,
  status: true,
  number: true,
  issuedOn: true,
  dueOn: true,
  totalCentimes: true,
  receivedCentimes: true,
  balanceCentimes: true,
  buyer: true,
  createdAt: true,
  matter: {
    select: { id: true, reference: true, title: true, client: { select: { name: true } } },
  },
} satisfies Prisma.InvoiceSelect;

type SummaryRow = Prisma.InvoiceGetPayload<{ select: typeof summarySelect }>;

const detailSelect = {
  ...summarySelect,
  notes: true,
  feeVatRateBasisPoints: true,
  subtotalCentimes: true,
  vatCentimes: true,
  creditedCentimes: true,
  seller: true,
  updatedAt: true,
  creditedInvoice: { select: { id: true, number: true } },
  creditNotes: {
    select: { id: true, number: true, status: true, issuedOn: true, totalCentimes: true },
    orderBy: { createdAt: "asc" },
  },
  lines: {
    select: { kind: true, description: true, quantityHundredths: true, unitPriceCentimes: true },
    orderBy: { position: "asc" },
  },
  payments: {
    select: {
      id: true,
      kind: true,
      receivedOn: true,
      amountCentimes: true,
      method: true,
      reference: true,
      notes: true,
      recordedBy: person,
      createdAt: true,
      voidedAt: true,
      voidedBy: person,
      voidReason: true,
    },
    orderBy: [{ receivedOn: "asc" }, { createdAt: "asc" }],
  },
  createdBy: person,
  issuedBy: person,
} satisfies Prisma.InvoiceSelect;

type DetailRow = Prisma.InvoiceGetPayload<{ select: typeof detailSelect }>;
type PaymentRow = DetailRow["payments"][number];

function toSummary(row: SummaryRow, today: string): InvoiceSummary {
  const balance = toNumber(row.balanceCentimes);
  const issuedInvoice = row.kind === "invoice" && row.status === "issued";
  const buyer = row.buyer === null ? null : buyerSnapshotSchema.parse(row.buyer);
  return {
    id: row.id,
    matter: { id: row.matter.id, reference: row.matter.reference, title: row.matter.title },
    kind: row.kind,
    status: row.status,
    number: row.number,
    issuedOn: optionalDate(row.issuedOn),
    dueOn: optionalDate(row.dueOn),
    clientName: buyer?.name ?? row.matter.client.name,
    totalCentimes: toNumber(row.totalCentimes),
    balanceCentimes: issuedInvoice ? balance : 0,
    paymentState: issuedInvoice ? paymentStateOf(balance, toNumber(row.receivedCentimes)) : null,
    overdue: issuedInvoice && balance > 0 && row.dueOn !== null && fromDbDate(row.dueOn) < today,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    kind: row.kind,
    receivedOn: fromDbDate(row.receivedOn),
    amountCentimes: toNumber(row.amountCentimes),
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
  };
}

const linesOf = (rows: DetailRow["lines"]): LineInput[] =>
  rows.map((l) => ({
    kind: l.kind,
    description: l.description,
    quantityHundredths: l.quantityHundredths,
    unitPriceCentimes: toNumber(l.unitPriceCentimes),
  }));

function lineRows(invoiceId: string, computed: ReturnType<typeof computeInvoice>) {
  return computed.lines.map((line, position) => ({
    invoiceId,
    position,
    kind: line.kind,
    description: line.description,
    quantityHundredths: line.quantityHundredths,
    unitPriceCentimes: BigInt(line.unitPriceCentimes),
    vatRateBasisPoints: line.vatRateBasisPoints,
    netCentimes: line.netCentimes,
  }));
}

/** Totals of a draft or an issued document. Running totals start at zero. */
function totalsOf(computed: ReturnType<typeof computeInvoice>) {
  return {
    subtotalCentimes: computed.subtotalCentimes,
    vatCentimes: computed.vatCentimes,
    totalCentimes: computed.totalCentimes,
    balanceCentimes: computed.totalCentimes,
  };
}

interface Rights {
  draftInvoices: boolean;
  manageBilling: boolean;
}

/** Credit notes are a lawyer's decision, from the draft on. */
function canEditDraft(kind: DetailRow["kind"], rights: Rights): boolean {
  return kind === "invoice" ? rights.draftInvoices : rights.manageBilling;
}

const SERIES = { invoice: "F", credit_note: "AV" } as const;

const VIEW_WHERE: Record<InvoiceView, (today: Date) => Prisma.InvoiceWhereInput> = {
  all: () => ({}),
  draft: () => ({ status: "draft" }),
  outstanding: () => ({ kind: "invoice", status: "issued", balanceCentimes: { gt: 0 } }),
  overdue: (today) => ({
    kind: "invoice",
    status: "issued",
    balanceCentimes: { gt: 0 },
    dueOn: { lt: today },
  }),
};

/**
 * Fee agreements, invoices, credit notes and payments.
 *
 * Access follows the matter (policy module): the team reads billing and
 * prepares draft invoices; lawyers on the team issue invoices and credit
 * notes, record and void payments and manage fee agreements. Break-glass
 * access never reaches billing. Every money operation runs in one
 * transaction that first locks the invoice it changes (and, for a credit
 * note, the invoice it corrects, always locked first), so concurrent
 * requests cannot overpay, over-credit or issue the same draft twice.
 */
export class BillingService {
  constructor(private readonly db: Database) {}

  private audit(event: AuditEventInput, ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  private async rights(actor: Actor, matterId: string, ctx: RequestContext): Promise<Rights> {
    const { access, facts } = await authorizeMatter(this.db, actor, matterId, "readBilling", ctx);
    return {
      draftInvoices: canOnMatter(actor, access, "draftInvoices", facts),
      manageBilling: canOnMatter(actor, access, "manageBilling", facts),
    };
  }

  // --- Office billing details ----------------------------------------------------------

  private settingsRow(db: Database | Tx = this.db): Promise<SettingsRow> {
    return db.billingSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
  }

  async getSettings(): Promise<BillingSettings> {
    return toSettings(await this.settingsRow());
  }

  async updateSettings(
    actor: Actor,
    changes: UpdateSettings,
    ctx: RequestContext,
  ): Promise<BillingSettings> {
    if (!canManageBillingSettings(actor)) throw forbidden();
    const row = await this.db.billingSettings.update({
      where: { id: SETTINGS_ID },
      data: present(changes),
    });
    await this.audit(
      {
        action: "billing.settings.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "billing_settings",
        metadata: { fields: changedFields(changes) },
      },
      ctx,
    );
    return toSettings(row);
  }

  /** Office-wide totals per month of `year`, for administrators. Amounts only. */
  async summary(actor: Actor, year: number): Promise<BillingSummary> {
    if (!canManageBillingSettings(actor)) throw forbidden();
    const from = toDbDate(`${String(year)}-01-01`);
    const to = toDbDate(`${String(year + 1)}-01-01`);
    const today = toDbDate(officeToday());
    const [issued, received, open] = await Promise.all([
      this.db.$queryRaw<{ month: number; kind: string; count: number; total: bigint }[]>`
        SELECT extract(month FROM "issued_on")::int AS month, "kind"::text AS kind,
               count(*)::int AS count, sum("total_centimes")::bigint AS total
        FROM "invoice"
        WHERE "status" = 'issued' AND "issued_on" >= ${from} AND "issued_on" < ${to}
        GROUP BY 1, 2`,
      this.db.$queryRaw<{ month: number; total: bigint }[]>`
        SELECT extract(month FROM "received_on")::int AS month,
               sum(CASE "kind" WHEN 'payment' THEN "amount_centimes" ELSE -"amount_centimes" END)::bigint AS total
        FROM "payment"
        WHERE "voided_at" IS NULL AND "received_on" >= ${from} AND "received_on" < ${to}
        GROUP BY 1`,
      this.db.$queryRaw<{ outstanding: bigint | null; overdue: number }[]>`
        SELECT sum("balance_centimes")::bigint AS outstanding,
               count(*) FILTER (WHERE "due_on" < ${today})::int AS overdue
        FROM "invoice"
        WHERE "kind" = 'invoice' AND "status" = 'issued' AND "balance_centimes" > 0`,
    ]);
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      invoiceCount: 0,
      invoicedCentimes: 0,
      creditedCentimes: 0,
      receivedCentimes: 0,
    }));
    for (const row of issued) {
      const month = months[row.month - 1];
      if (!month) continue;
      if (row.kind === "invoice") {
        month.invoiceCount = row.count;
        month.invoicedCentimes = toNumber(row.total);
      } else {
        month.creditedCentimes = toNumber(row.total);
      }
    }
    for (const row of received) {
      const month = months[row.month - 1];
      if (month) month.receivedCentimes = toNumber(row.total);
    }
    return {
      year,
      months,
      outstandingCentimes: toNumber(open[0]?.outstanding ?? 0n),
      overdueCount: open[0]?.overdue ?? 0,
    };
  }

  // --- Fee agreements ------------------------------------------------------------------

  async listFeeAgreements(
    actor: Actor,
    matterId: string,
    ctx: RequestContext,
  ): Promise<FeeAgreement[]> {
    await authorizeMatter(this.db, actor, matterId, "readBilling", ctx);
    const rows = await this.db.feeAgreement.findMany({
      where: { matterId },
      orderBy: [{ endedOn: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      select: feeAgreementSelect,
    });
    return rows.map(toFeeAgreement);
  }

  async createFeeAgreement(
    actor: Actor,
    matterId: string,
    input: CreateFeeAgreement,
    ctx: RequestContext,
  ): Promise<FeeAgreement> {
    await authorizeMatter(this.db, actor, matterId, "manageBilling", ctx);
    const row = await this.db.feeAgreement.create({
      data: {
        matterId,
        kind: input.kind,
        title: input.title,
        amountCentimes: toBigInt(input.amountCentimes),
        hourlyRateCentimes: toBigInt(input.hourlyRateCentimes),
        signedOn: input.signedOn ? toDbDate(input.signedOn) : null,
        terms: input.terms ?? null,
        createdById: actor.id,
      },
      select: feeAgreementSelect,
    });
    await this.audit(
      {
        action: "fee_agreement.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "fee_agreement",
        targetId: row.id,
        metadata: { matterId, kind: input.kind },
      },
      ctx,
    );
    return toFeeAgreement(row);
  }

  async updateFeeAgreement(
    actor: Actor,
    matterId: string,
    agreementId: string,
    changes: UpdateFeeAgreement,
    ctx: RequestContext,
  ): Promise<FeeAgreement> {
    await authorizeMatter(this.db, actor, matterId, "manageBilling", ctx);
    const current = await this.db.feeAgreement.findFirst({
      where: { id: agreementId, matterId },
      select: { kind: true, signedOn: true, endedOn: true },
    });
    if (!current) throw notFound();
    if (current.kind === "fixed" && changes.amountCentimes === null) {
      throw fieldError("amountCentimes", "a fixed fee needs an amount");
    }
    if (current.kind === "hourly" && changes.hourlyRateCentimes === null) {
      throw fieldError("hourlyRateCentimes", "an hourly fee needs a rate");
    }
    const signedOn =
      changes.signedOn === undefined ? optionalDate(current.signedOn) : changes.signedOn;
    const endedOn = changes.endedOn === undefined ? optionalDate(current.endedOn) : changes.endedOn;
    if (signedOn && endedOn && endedOn < signedOn) {
      throw fieldError("endedOn", "before the signing date");
    }
    const amount = (value: number | null | undefined) =>
      value === undefined ? undefined : value === null ? null : BigInt(value);
    const day = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : toDbDate(value);
    const row = await this.db.feeAgreement.update({
      where: { id: agreementId },
      data: present({
        title: changes.title,
        amountCentimes: amount(changes.amountCentimes),
        hourlyRateCentimes: amount(changes.hourlyRateCentimes),
        signedOn: day(changes.signedOn),
        terms: changes.terms,
        endedOn: day(changes.endedOn),
      }),
      select: feeAgreementSelect,
    });
    const ending =
      changes.endedOn !== undefined && changes.endedOn !== null && current.endedOn === null;
    await this.audit(
      {
        action: ending ? "fee_agreement.end" : "fee_agreement.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "fee_agreement",
        targetId: agreementId,
        metadata: { matterId, fields: changedFields(changes) },
      },
      ctx,
    );
    return toFeeAgreement(row);
  }

  // --- Reading invoices ---------------------------------------------------------------

  private async detail(
    matterId: string,
    invoiceId: string,
    rights: Rights,
  ): Promise<InvoiceDetail> {
    const row = await this.db.invoice.findFirst({
      where: { id: invoiceId, matterId },
      select: detailSelect,
    });
    if (!row) throw notFound();
    const today = officeToday();
    const draft = row.status === "draft";
    // A draft invoice follows the office VAT rate until it is issued.
    const rate =
      draft && row.kind === "invoice"
        ? (await this.settingsRow()).vatRateBasisPoints
        : row.feeVatRateBasisPoints;
    const computed = computeInvoice(linesOf(row.lines), rate);
    const summary = toSummary(row, today);
    const issuedInvoice = row.kind === "invoice" && !draft;
    return {
      ...summary,
      totalCentimes: toNumber(computed.totalCentimes),
      creditedInvoice: row.creditedInvoice,
      notes: row.notes,
      feeVatRateBasisPoints: rate,
      lines: computed.lines.map((l) => ({ ...l, netCentimes: toNumber(l.netCentimes) })),
      vatBreakdown: computed.vatBreakdown.map((r) => ({
        rateBasisPoints: r.rateBasisPoints,
        netCentimes: toNumber(r.netCentimes),
        vatCentimes: toNumber(r.vatCentimes),
      })),
      subtotalCentimes: toNumber(computed.subtotalCentimes),
      vatCentimes: toNumber(computed.vatCentimes),
      creditedCentimes: toNumber(row.creditedCentimes),
      receivedCentimes: toNumber(row.receivedCentimes),
      seller: row.seller === null ? null : sellerSnapshotSchema.parse(row.seller),
      buyer: row.buyer === null ? null : buyerSnapshotSchema.parse(row.buyer),
      creditNotes: row.creditNotes.map((c) => ({
        id: c.id,
        number: c.number,
        status: c.status,
        issuedOn: optionalDate(c.issuedOn),
        totalCentimes: toNumber(c.totalCentimes),
      })),
      payments: row.payments.map(toPayment),
      createdBy: row.createdBy,
      issuedBy: row.issuedBy,
      updatedAt: row.updatedAt.toISOString(),
      permissions: {
        edit: draft && canEditDraft(row.kind, rights),
        delete: draft && canEditDraft(row.kind, rights),
        issue: draft && rights.manageBilling,
        creditNote:
          issuedInvoice && rights.manageBilling && row.creditedCentimes < row.totalCentimes,
        recordPayment: issuedInvoice && rights.manageBilling,
      },
    };
  }

  async getInvoice(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    return this.detail(matterId, invoiceId, rights);
  }

  async listMatterInvoices(
    actor: Actor,
    matterId: string,
    ctx: RequestContext,
  ): Promise<InvoiceSummary[]> {
    await authorizeMatter(this.db, actor, matterId, "readBilling", ctx);
    const rows = await this.db.invoice.findMany({
      where: { matterId },
      orderBy: [{ issuedOn: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: summarySelect,
    });
    const today = officeToday();
    return rows.map((row) => toSummary(row, today));
  }

  /** Invoices across the actor's own matters, newest first, drafts on top. */
  async listInvoices(
    actor: Actor,
    query: { view: InvoiceView; page: number },
  ): Promise<{ items: InvoiceSummary[]; page: number; hasMore: boolean }> {
    const today = officeToday();
    const rows = await this.db.invoice.findMany({
      where: { matter: billingMattersWhere(actor), ...VIEW_WHERE[query.view](toDbDate(today)) },
      orderBy: [{ issuedOn: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE + 1,
      select: summarySelect,
    });
    return {
      items: rows.slice(0, LIST_PAGE_SIZE).map((row) => toSummary(row, today)),
      page: query.page,
      hasMore: rows.length > LIST_PAGE_SIZE,
    };
  }

  // --- Drafts --------------------------------------------------------------------------

  /** Locks the invoice row for the rest of the transaction; "not found" if it is not on this matter. */
  private async lock(tx: Tx, matterId: string, invoiceId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "invoice"
      WHERE "id" = ${invoiceId}::uuid AND "matter_id" = ${matterId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    return tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        kind: true,
        status: true,
        feeVatRateBasisPoints: true,
        creditedInvoiceId: true,
        totalCentimes: true,
        creditedCentimes: true,
        receivedCentimes: true,
        balanceCentimes: true,
        issuedOn: true,
      },
    });
  }

  async createInvoice(
    actor: Actor,
    matterId: string,
    input: CreateInvoice,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.draftInvoices) throw forbidden();
    const { vatRateBasisPoints } = await this.settingsRow();
    const computed = computeInvoice(input.lines, vatRateBasisPoints);
    const id = await this.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          matterId,
          kind: "invoice",
          notes: input.notes ?? null,
          feeVatRateBasisPoints: vatRateBasisPoints,
          ...totalsOf(computed),
          createdById: actor.id,
        },
        select: { id: true },
      });
      await tx.invoiceLine.createMany({ data: lineRows(invoice.id, computed) });
      return invoice.id;
    });
    await this.audit(
      {
        action: "invoice.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        targetId: id,
        metadata: { matterId, lines: input.lines.length },
      },
      ctx,
    );
    return this.detail(matterId, id, rights);
  }

  async updateInvoice(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    changes: UpdateInvoice,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.draftInvoices) throw forbidden();
    const settings = await this.settingsRow();
    await this.db.$transaction(async (tx) => {
      const current = await this.lock(tx, matterId, invoiceId);
      if (!canEditDraft(current.kind, rights)) throw forbidden();
      if (current.status !== "draft") throw conflict("not a draft");
      const data: Prisma.InvoiceUpdateInput = {};
      if (changes.notes !== undefined) data.notes = changes.notes;
      if (changes.lines !== undefined) {
        const rate =
          current.kind === "invoice" ? settings.vatRateBasisPoints : current.feeVatRateBasisPoints;
        const computed = computeInvoice(changes.lines, rate);
        await tx.invoiceLine.deleteMany({ where: { invoiceId } });
        await tx.invoiceLine.createMany({ data: lineRows(invoiceId, computed) });
        Object.assign(data, totalsOf(computed), { feeVatRateBasisPoints: rate });
      }
      await tx.invoice.update({ where: { id: invoiceId }, data });
    });
    await this.audit(
      {
        action: "invoice.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        targetId: invoiceId,
        metadata: { matterId, fields: changedFields(changes) },
      },
      ctx,
    );
    return this.detail(matterId, invoiceId, rights);
  }

  /** Only drafts can be deleted: they have no number yet, so no gap is left. */
  async deleteInvoice(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.draftInvoices) throw forbidden();
    const kind = await this.db.$transaction(async (tx) => {
      const current = await this.lock(tx, matterId, invoiceId);
      if (!canEditDraft(current.kind, rights)) throw forbidden();
      if (current.status !== "draft") throw conflict("not a draft");
      await tx.invoice.delete({ where: { id: invoiceId } });
      return current.kind;
    });
    await this.audit(
      {
        action: "invoice.delete",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        targetId: invoiceId,
        metadata: { matterId, kind },
      },
      ctx,
    );
  }

  /** A draft credit note for an issued invoice, starting from a copy of its lines. */
  async createCreditNote(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.manageBilling) throw forbidden();
    const id = await this.db.$transaction(async (tx) => {
      const original = await this.lock(tx, matterId, invoiceId);
      if (original.kind !== "invoice" || original.status !== "issued") {
        throw conflict("only issued invoices can be credited");
      }
      if (original.creditedCentimes >= original.totalCentimes) {
        throw conflict("already fully credited");
      }
      const lines = await tx.invoiceLine.findMany({
        where: { invoiceId },
        orderBy: { position: "asc" },
        select: {
          kind: true,
          description: true,
          quantityHundredths: true,
          unitPriceCentimes: true,
        },
      });
      const computed = computeInvoice(linesOf(lines), original.feeVatRateBasisPoints);
      const note = await tx.invoice.create({
        data: {
          matterId,
          kind: "credit_note",
          creditedInvoiceId: invoiceId,
          feeVatRateBasisPoints: original.feeVatRateBasisPoints,
          ...totalsOf(computed),
          createdById: actor.id,
        },
        select: { id: true },
      });
      await tx.invoiceLine.createMany({ data: lineRows(note.id, computed) });
      return note.id;
    });
    await this.audit(
      {
        action: "credit_note.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        targetId: id,
        metadata: { matterId, creditedInvoiceId: invoiceId },
      },
      ctx,
    );
    return this.detail(matterId, id, rights);
  }

  // --- Issuing ---------------------------------------------------------------------------

  /**
   * Gives a draft its number and freezes it. The number comes from a counter
   * row updated in the same transaction, so a number is used exactly when
   * the invoice is issued: no gaps, no duplicates. The issue date is today
   * (office calendar), which keeps numbers in date order.
   */
  async issueInvoice(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.manageBilling) throw forbidden();
    const today = officeToday();
    const issued = await this.db.$transaction(async (tx) => {
      // The invoice a credit note corrects is locked first, as everywhere else.
      const peek = await tx.invoice.findFirst({
        where: { id: invoiceId, matterId },
        select: { creditedInvoiceId: true },
      });
      if (!peek) throw notFound();
      const original = peek.creditedInvoiceId
        ? await this.lock(tx, matterId, peek.creditedInvoiceId)
        : null;
      const current = await this.lock(tx, matterId, invoiceId);
      if (current.status !== "draft") throw conflict("already issued");

      const settings = await this.settingsRow(tx);
      const seller = sellerOf(settings);
      const rate =
        current.kind === "invoice" ? settings.vatRateBasisPoints : current.feeVatRateBasisPoints;
      const lines = await tx.invoiceLine.findMany({
        where: { invoiceId },
        orderBy: { position: "asc" },
        select: {
          kind: true,
          description: true,
          quantityHundredths: true,
          unitPriceCentimes: true,
        },
      });
      const computed = computeInvoice(linesOf(lines), rate);
      if (computed.totalCentimes <= 0n) throw fieldError("lines", "nothing to invoice");
      if (original) {
        const creditable = original.totalCentimes - original.creditedCentimes;
        if (computed.totalCentimes > creditable) {
          throw fieldError("lines", "more than the amount left to credit");
        }
      }

      const matter = await tx.matter.findUniqueOrThrow({
        where: { id: matterId },
        select: { client: { select: { name: true, kind: true, identifier: true, address: true } } },
      });
      const buyer: BuyerSnapshot = matter.client;
      const year = Number(today.slice(0, 4));
      const series = SERIES[current.kind];
      const [counter] = await tx.$queryRaw<{ last_value: number }[]>`
        INSERT INTO "invoice_counter" ("series", "year", "last_value") VALUES (${series}, ${year}, 1)
        ON CONFLICT ("series", "year") DO UPDATE SET "last_value" = "invoice_counter"."last_value" + 1
        RETURNING "last_value"`;
      if (!counter) throw new Error("invoice counter did not return a value");
      const number = `${series}-${String(year)}-${String(counter.last_value).padStart(4, "0")}`;

      // Lines first: they can only change while the invoice is still a draft.
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      await tx.invoiceLine.createMany({ data: lineRows(invoiceId, computed) });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: "issued",
          number,
          issuedOn: toDbDate(today),
          dueOn:
            current.kind === "invoice" ? toDbDate(addDays(today, settings.paymentTermDays)) : null,
          feeVatRateBasisPoints: rate,
          ...totalsOf(computed),
          seller,
          buyer,
          issuedById: actor.id,
        },
      });
      if (original && peek.creditedInvoiceId) {
        await tx.invoice.update({
          where: { id: peek.creditedInvoiceId },
          data: {
            creditedCentimes: { increment: computed.totalCentimes },
            balanceCentimes: { decrement: computed.totalCentimes },
          },
        });
      }
      return { number, kind: current.kind, total: computed.totalCentimes };
    });
    await this.audit(
      {
        action: issued.kind === "invoice" ? "invoice.issue" : "credit_note.issue",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        targetId: invoiceId,
        metadata: { matterId, number: issued.number, totalCentimes: toNumber(issued.total) },
      },
      ctx,
    );
    return this.detail(matterId, invoiceId, rights);
  }

  // --- Payments --------------------------------------------------------------------------

  /**
   * Records money received (or refunded). A payment cannot exceed what is
   * still due, and a refund cannot exceed what was overpaid, because the
   * balance is read under the invoice's row lock.
   */
  async recordPayment(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    input: RecordPayment,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.manageBilling) throw forbidden();
    const paymentId = await this.db.$transaction(async (tx) => {
      const current = await this.lock(tx, matterId, invoiceId);
      if (current.kind !== "invoice" || current.status !== "issued" || !current.issuedOn) {
        throw conflict("payments go to issued invoices");
      }
      if (input.receivedOn > officeToday() || input.receivedOn < fromDbDate(current.issuedOn)) {
        throw fieldError("receivedOn", "between the issue date and today");
      }
      const amount = BigInt(input.amountCentimes);
      const refund = input.kind === "refund";
      const limit = refund ? -current.balanceCentimes : current.balanceCentimes;
      if (amount > limit) {
        throw fieldError("amountCentimes", refund ? "more than was overpaid" : "more than is due");
      }
      const payment = await tx.payment.create({
        data: {
          invoiceId,
          kind: input.kind,
          receivedOn: toDbDate(input.receivedOn),
          amountCentimes: amount,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      const signed = refund ? -amount : amount;
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          receivedCentimes: { increment: signed },
          balanceCentimes: { decrement: signed },
        },
      });
      return payment.id;
    });
    await this.audit(
      {
        action: input.kind === "refund" ? "payment.refund" : "payment.record",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "payment",
        targetId: paymentId,
        metadata: {
          matterId,
          invoiceId,
          amountCentimes: input.amountCentimes,
          method: input.method,
        },
      },
      ctx,
    );
    return this.detail(matterId, invoiceId, rights);
  }

  /** Cancels a payment recorded by mistake. The record stays, marked void with a reason. */
  async voidPayment(
    actor: Actor,
    matterId: string,
    invoiceId: string,
    paymentId: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<InvoiceDetail> {
    const rights = await this.rights(actor, matterId, ctx);
    if (!rights.manageBilling) throw forbidden();
    await this.db.$transaction(async (tx) => {
      const current = await this.lock(tx, matterId, invoiceId);
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, invoiceId },
        select: { kind: true, amountCentimes: true, voidedAt: true },
      });
      if (!payment) throw notFound();
      if (payment.voidedAt) throw conflict("already voided");
      const signed = payment.kind === "refund" ? -payment.amountCentimes : payment.amountCentimes;
      // Refunds are voided before the payments they returned.
      if (current.receivedCentimes - signed < 0n) throw conflict("void the refund first");
      await tx.payment.update({
        where: { id: paymentId },
        data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          receivedCentimes: { decrement: signed },
          balanceCentimes: { increment: signed },
        },
      });
    });
    await this.audit(
      {
        action: "payment.void",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "payment",
        targetId: paymentId,
        metadata: { matterId, invoiceId },
      },
      ctx,
    );
    return this.detail(matterId, invoiceId, rights);
  }

  // --- Export ------------------------------------------------------------------------------

  /**
   * The sales journal (issued invoices and credit notes) between two issue
   * dates, for the actor's own matters, as CSV. Credit notes are negative.
   */
  async exportCsv(
    actor: Actor,
    from: string,
    to: string,
    ctx: RequestContext,
  ): Promise<{ fileName: string; body: string }> {
    if (!canExportInvoices(actor)) throw forbidden();
    const rows = await this.db.invoice.findMany({
      where: {
        matter: billingMattersWhere(actor),
        status: "issued",
        issuedOn: { gte: toDbDate(from), lte: toDbDate(to) },
      },
      // Each day: invoices, then credit notes, in number order.
      orderBy: [{ issuedOn: "asc" }, { kind: "asc" }, { number: "asc" }],
      select: {
        kind: true,
        number: true,
        issuedOn: true,
        dueOn: true,
        buyer: true,
        subtotalCentimes: true,
        vatCentimes: true,
        totalCentimes: true,
        creditedCentimes: true,
        receivedCentimes: true,
        balanceCentimes: true,
        matter: { select: { reference: true } },
        creditedInvoice: { select: { number: true } },
      },
    });
    const header = [
      "Type",
      "Numéro",
      "Date",
      "Échéance",
      "Facture d'origine",
      "Dossier",
      "Client",
      "Identifiant client",
      "HT",
      "TVA",
      "TTC",
      "Avoirs",
      "Encaissé",
      "Solde",
    ];
    const body: CsvCell[][] = rows.map((row) => {
      const buyer = buyerSnapshotSchema.parse(row.buyer);
      const invoice = row.kind === "invoice";
      const sign = invoice ? 1 : -1;
      return [
        invoice ? "Facture" : "Avoir",
        row.number,
        optionalDate(row.issuedOn),
        optionalDate(row.dueOn),
        row.creditedInvoice?.number ?? null,
        row.matter.reference,
        buyer.name,
        buyer.identifier,
        sign * toNumber(row.subtotalCentimes),
        sign * toNumber(row.vatCentimes),
        sign * toNumber(row.totalCentimes),
        invoice ? toNumber(row.creditedCentimes) : null,
        invoice ? toNumber(row.receivedCentimes) : null,
        invoice ? toNumber(row.balanceCentimes) : null,
      ];
    });
    await this.audit(
      {
        action: "invoice.export",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "invoice",
        metadata: { from, to, rows: rows.length },
      },
      ctx,
    );
    return { fileName: `factures-${from}-${to}.csv`, body: toCsv(header, body) };
  }
}
