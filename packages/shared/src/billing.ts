import { z } from "zod";
import { calendarDateSchema, multiLine, optional, personRefSchema, singleLine } from "./matters.js";

/**
 * Fee agreements, invoices, credit notes and payments.
 *
 * Amounts are whole centimes of Moroccan dirhams (MAD) and quantities are
 * hundredths (1.5 hours = 150), so no amount is ever a floating-point
 * number. Totals are computed by the server; the client never sends them.
 */

export const CURRENCY = "MAD";

/** 10 000 000,00 MAD per unit, 10 000 units per line, 50 lines per invoice. */
export const MAX_UNIT_PRICE_CENTIMES = 1_000_000_000;
export const MAX_QUANTITY_HUNDREDTHS = 1_000_000;
export const MAX_INVOICE_LINES = 50;
/** Upper bound for a single payment or agreed amount: 1 000 000 000,00 MAD. */
export const MAX_AMOUNT_CENTIMES = 100_000_000_000;
/** VAT rates are basis points: 2000 = 20 %. */
export const MAX_VAT_RATE_BASIS_POINTS = 3000;
export const DEFAULT_VAT_RATE_BASIS_POINTS = 2000;
export const EXPORT_MAX_DAYS = 366;

export const invoiceKinds = ["invoice", "credit_note"] as const;
export const invoiceKindSchema = z.enum(invoiceKinds);
export type InvoiceKind = z.infer<typeof invoiceKindSchema>;

export const invoiceStatuses = ["draft", "issued"] as const;
export const invoiceStatusSchema = z.enum(invoiceStatuses);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Fees carry the office VAT rate; disbursements (court fees, stamps…) are re-billed at cost, without VAT. */
export const lineKinds = ["fee", "disbursement"] as const;
export const lineKindSchema = z.enum(lineKinds);
export type LineKind = z.infer<typeof lineKindSchema>;

export const paymentMethods = ["cash", "cheque", "transfer", "card", "other"] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** A refund returns money the client overpaid (for example after a credit note). */
export const paymentKinds = ["payment", "refund"] as const;
export const paymentKindSchema = z.enum(paymentKinds);
export type PaymentKind = z.infer<typeof paymentKindSchema>;

/** Derived from the balance of an issued invoice. */
export const paymentStates = ["unpaid", "partial", "paid", "overpaid"] as const;
export const paymentStateSchema = z.enum(paymentStates);
export type PaymentState = z.infer<typeof paymentStateSchema>;

export const feeAgreementKinds = ["fixed", "hourly", "other"] as const;
export const feeAgreementKindSchema = z.enum(feeAgreementKinds);
export type FeeAgreementKind = z.infer<typeof feeAgreementKindSchema>;

const uuid = z.uuid();
const centimes = (max: number) => z.number().int().min(0).max(max);
const positiveCentimes = (max: number) => z.number().int().min(1).max(max);
const matterRefSchema = z.strictObject({ id: uuid, reference: z.string(), title: z.string() });

/** Digits only once spaces are removed, with an exact or maximum length. */
const digits = (pattern: RegExp) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().regex(pattern));
const optionalDigits = (pattern: RegExp) =>
  z
    .union([digits(/^$/), digits(pattern), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

// --- Office billing details ---------------------------------------------------------

export const billingSettingsFields = [
  "officeName",
  "address",
  "phone",
  "email",
  "ice",
  "taxId",
  "professionalTaxId",
  "barAssociation",
  "bankName",
  "rib",
  "invoiceNote",
] as const;

/** Details an invoice cannot be issued without. */
export const REQUIRED_BILLING_FIELDS = ["officeName", "address", "ice", "taxId"] as const;

export const updateBillingSettingsRequestSchema = z
  .strictObject({
    officeName: optional(singleLine(200)),
    address: optional(multiLine(500)),
    phone: optional(singleLine(32).regex(/^(?:[+0-9 ().-]{6,32})?$/)),
    email: z
      .union([z.literal(""), z.string().trim().toLowerCase().max(254).pipe(z.email()), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
    /** Identifiant commun de l'entreprise: 15 digits. */
    ice: optionalDigits(/^\d{15}$/),
    /** Identifiant fiscal. */
    taxId: optionalDigits(/^\d{1,10}$/),
    /** Taxe professionnelle (patente). */
    professionalTaxId: optionalDigits(/^\d{1,12}$/),
    barAssociation: optional(singleLine(120)),
    bankName: optional(singleLine(120)),
    /** Relevé d'identité bancaire: 24 digits. */
    rib: optionalDigits(/^\d{24}$/),
    vatRateBasisPoints: z.number().int().min(0).max(MAX_VAT_RATE_BASIS_POINTS).optional(),
    paymentTermDays: z.number().int().min(0).max(365).optional(),
    invoiceNote: optional(multiLine(1000)),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateBillingSettingsRequest = z.input<typeof updateBillingSettingsRequestSchema>;

export const billingSettingsSchema = z.strictObject({
  officeName: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  ice: z.string().nullable(),
  taxId: z.string().nullable(),
  professionalTaxId: z.string().nullable(),
  barAssociation: z.string().nullable(),
  bankName: z.string().nullable(),
  rib: z.string().nullable(),
  vatRateBasisPoints: z.number().int(),
  paymentTermDays: z.number().int(),
  invoiceNote: z.string().nullable(),
  /** Required details still missing; invoices cannot be issued until this is empty. */
  missing: z.array(z.enum(REQUIRED_BILLING_FIELDS)),
  updatedAt: z.iso.datetime(),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
export const billingSettingsResponseSchema = z.strictObject({ settings: billingSettingsSchema });

/** The office as printed on an issued invoice, frozen at issue. */
export const sellerSnapshotSchema = z.strictObject({
  officeName: z.string(),
  address: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  ice: z.string(),
  taxId: z.string(),
  professionalTaxId: z.string().nullable(),
  barAssociation: z.string().nullable(),
  bankName: z.string().nullable(),
  rib: z.string().nullable(),
  invoiceNote: z.string().nullable(),
});
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;

/** The client as printed on an issued invoice, frozen at issue. */
export const buyerSnapshotSchema = z.strictObject({
  name: z.string(),
  kind: z.enum(["person", "company"]),
  identifier: z.string().nullable(),
  address: z.string().nullable(),
});
export type BuyerSnapshot = z.infer<typeof buyerSnapshotSchema>;

export const billingSummaryQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(9999),
});

/** Office-wide totals for administrators: amounts only, no client or matter details. */
export const billingSummarySchema = z.strictObject({
  year: z.number().int(),
  months: z.array(
    z.strictObject({
      month: z.number().int().min(1).max(12),
      invoiceCount: z.number().int(),
      invoicedCentimes: z.number().int(),
      creditedCentimes: z.number().int(),
      receivedCentimes: z.number().int(),
    }),
  ),
  /** Unpaid balance of every issued invoice today, whatever its year. */
  outstandingCentimes: z.number().int(),
  overdueCount: z.number().int(),
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;
export const billingSummaryResponseSchema = z.strictObject({ summary: billingSummarySchema });

// --- Fee agreements -----------------------------------------------------------------

const feeAgreementFields = {
  title: singleLine(200).pipe(z.string().min(1)),
  amountCentimes: centimes(MAX_AMOUNT_CENTIMES).nullable().optional(),
  hourlyRateCentimes: centimes(MAX_UNIT_PRICE_CENTIMES).nullable().optional(),
  signedOn: calendarDateSchema.nullable().optional(),
  terms: optional(multiLine(4000)),
};

export const createFeeAgreementRequestSchema = z
  .strictObject({ kind: feeAgreementKindSchema, ...feeAgreementFields })
  .refine((b) => b.kind !== "fixed" || (b.amountCentimes ?? null) !== null, {
    message: "a fixed fee needs an amount",
    path: ["amountCentimes"],
  })
  .refine((b) => b.kind !== "hourly" || (b.hourlyRateCentimes ?? null) !== null, {
    message: "an hourly fee needs a rate",
    path: ["hourlyRateCentimes"],
  });
export type CreateFeeAgreementRequest = z.input<typeof createFeeAgreementRequestSchema>;

export const updateFeeAgreementRequestSchema = z
  .strictObject({
    ...feeAgreementFields,
    title: feeAgreementFields.title.optional(),
    /** Set to end the agreement; null re-opens it. */
    endedOn: calendarDateSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateFeeAgreementRequest = z.input<typeof updateFeeAgreementRequestSchema>;

export const feeAgreementSchema = z.strictObject({
  id: uuid,
  matterId: uuid,
  kind: feeAgreementKindSchema,
  title: z.string(),
  amountCentimes: z.number().int().nullable(),
  hourlyRateCentimes: z.number().int().nullable(),
  signedOn: calendarDateSchema.nullable(),
  terms: z.string().nullable(),
  endedOn: calendarDateSchema.nullable(),
  createdBy: personRefSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FeeAgreement = z.infer<typeof feeAgreementSchema>;
export const feeAgreementListResponseSchema = z.strictObject({
  feeAgreements: z.array(feeAgreementSchema),
});
export const feeAgreementResponseSchema = z.strictObject({ feeAgreement: feeAgreementSchema });

// --- Invoices and credit notes ------------------------------------------------------

export const invoiceLineRequestSchema = z.strictObject({
  kind: lineKindSchema,
  description: singleLine(500).pipe(z.string().min(1)),
  quantityHundredths: positiveCentimes(MAX_QUANTITY_HUNDREDTHS),
  unitPriceCentimes: centimes(MAX_UNIT_PRICE_CENTIMES),
});
export type InvoiceLineRequest = z.input<typeof invoiceLineRequestSchema>;

const linesSchema = z.array(invoiceLineRequestSchema).max(MAX_INVOICE_LINES);

/** A new draft invoice. Credit notes are created from an issued invoice instead. */
export const createInvoiceRequestSchema = z.strictObject({
  notes: optional(multiLine(2000)),
  lines: linesSchema.default([]),
});
export type CreateInvoiceRequest = z.input<typeof createInvoiceRequestSchema>;

/** Changes to a draft. `lines` replaces every line. */
export const updateInvoiceRequestSchema = z
  .strictObject({ notes: optional(multiLine(2000)), lines: linesSchema.optional() })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateInvoiceRequest = z.input<typeof updateInvoiceRequestSchema>;

export const invoiceLineSchema = z.strictObject({
  kind: lineKindSchema,
  description: z.string(),
  quantityHundredths: z.number().int(),
  unitPriceCentimes: z.number().int(),
  vatRateBasisPoints: z.number().int(),
  /** Quantity × unit price, rounded to the centime. */
  netCentimes: z.number().int(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const vatBreakdownSchema = z.strictObject({
  rateBasisPoints: z.number().int(),
  netCentimes: z.number().int(),
  vatCentimes: z.number().int(),
});

export const paymentSchema = z.strictObject({
  id: uuid,
  kind: paymentKindSchema,
  receivedOn: calendarDateSchema,
  amountCentimes: z.number().int(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  recordedBy: personRefSchema,
  createdAt: z.iso.datetime(),
  voidedAt: z.iso.datetime().nullable(),
  voidedBy: personRefSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;

const invoiceRefSchema = z.strictObject({ id: uuid, number: z.string().nullable() });

export const invoiceSummarySchema = z.strictObject({
  id: uuid,
  matter: matterRefSchema,
  kind: invoiceKindSchema,
  status: invoiceStatusSchema,
  /** Null while a draft: numbers are given, without gaps, only when issued. */
  number: z.string().nullable(),
  issuedOn: calendarDateSchema.nullable(),
  dueOn: calendarDateSchema.nullable(),
  clientName: z.string(),
  totalCentimes: z.number().int(),
  /** Total minus credit notes minus money received (net of refunds). Negative when overpaid. */
  balanceCentimes: z.number().int(),
  /** Only for issued invoices (not drafts or credit notes). */
  paymentState: paymentStateSchema.nullable(),
  overdue: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceDetailSchema = z.strictObject({
  ...invoiceSummarySchema.shape,
  /** For a credit note: the invoice it corrects. */
  creditedInvoice: invoiceRefSchema.nullable(),
  notes: z.string().nullable(),
  /** VAT rate on fees: the office rate for drafts, frozen once issued. */
  feeVatRateBasisPoints: z.number().int(),
  lines: z.array(invoiceLineSchema),
  vatBreakdown: z.array(vatBreakdownSchema),
  subtotalCentimes: z.number().int(),
  vatCentimes: z.number().int(),
  creditedCentimes: z.number().int(),
  receivedCentimes: z.number().int(),
  seller: sellerSnapshotSchema.nullable(),
  buyer: buyerSnapshotSchema.nullable(),
  creditNotes: z.array(
    z.strictObject({
      id: uuid,
      number: z.string().nullable(),
      status: invoiceStatusSchema,
      issuedOn: calendarDateSchema.nullable(),
      totalCentimes: z.number().int(),
    }),
  ),
  payments: z.array(paymentSchema),
  createdBy: personRefSchema,
  issuedBy: personRefSchema.nullable(),
  updatedAt: z.iso.datetime(),
  permissions: z.strictObject({
    edit: z.boolean(),
    delete: z.boolean(),
    issue: z.boolean(),
    creditNote: z.boolean(),
    recordPayment: z.boolean(),
  }),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const invoiceResponseSchema = z.strictObject({ invoice: invoiceDetailSchema });
export const matterInvoiceListResponseSchema = z.strictObject({
  invoices: z.array(invoiceSummarySchema),
});

export const invoiceViews = ["all", "draft", "outstanding", "overdue"] as const;
export const invoiceViewSchema = z.enum(invoiceViews);
export type InvoiceView = z.infer<typeof invoiceViewSchema>;

export const invoiceListQuerySchema = z.strictObject({
  view: invoiceViewSchema.default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export const invoiceListResponseSchema = z.strictObject({
  invoices: z.array(invoiceSummarySchema),
  page: z.number().int(),
  hasMore: z.boolean(),
});

export const recordPaymentRequestSchema = z.strictObject({
  kind: paymentKindSchema.default("payment"),
  receivedOn: calendarDateSchema,
  amountCentimes: positiveCentimes(MAX_AMOUNT_CENTIMES),
  method: paymentMethodSchema,
  /** Cheque number, transfer reference… */
  reference: optional(singleLine(100)),
  notes: optional(multiLine(500)),
});
export type RecordPaymentRequest = z.input<typeof recordPaymentRequestSchema>;

export const voidPaymentRequestSchema = z.strictObject({
  reason: singleLine(300).pipe(z.string().min(5)),
});

export const exportQuerySchema = z
  .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
  .refine((q) => q.from <= q.to, { message: "from after to", path: ["to"] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < EXPORT_MAX_DAYS, {
    message: "range too long",
    path: ["to"],
  });

/**
 * Balance of an issued invoice as a state. An invoice fully cancelled by
 * credit notes is settled ("paid") although nothing was received.
 */
export function paymentStateOf(balanceCentimes: number, receivedCentimes: number): PaymentState {
  if (balanceCentimes < 0) return "overpaid";
  if (balanceCentimes === 0) return "paid";
  return receivedCentimes > 0 ? "partial" : "unpaid";
}
