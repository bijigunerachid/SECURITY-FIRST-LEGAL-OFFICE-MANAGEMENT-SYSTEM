import {
  billingSummaryQuerySchema,
  createFeeAgreementRequestSchema,
  createInvoiceRequestSchema,
  exportQuerySchema,
  invoiceListQuerySchema,
  recordPaymentRequestSchema,
  updateBillingSettingsRequestSchema,
  updateFeeAgreementRequestSchema,
  updateInvoiceRequestSchema,
  voidPaymentRequestSchema,
} from "@lexora/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { BillingService } from "../../modules/billing/billing-service.js";
import type { Actor } from "../../modules/policy/matter-policy.js";
import { notFound } from "../errors.js";
import { requireRecentReauth, requireRole, sessionOf } from "../middleware/auth.js";
import { requestContext } from "./auth.js";

const idSchema = z.uuid();

function validateIds(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(idSchema.safeParse(value).success ? undefined : notFound());
    });
  }
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function actorOf(req: Request): Actor {
  const { user } = sessionOf(req);
  return { id: user.id, role: user.role };
}

/**
 * /api/billing: the office's billing details (read by everyone signed in,
 * changed by administrators after re-entering their password) and the
 * office-wide totals for administrators.
 */
export function billingRouter(billing: BillingService): Router {
  const router = Router();

  router.get("/settings", async (_req, res) => {
    res.json({ settings: await billing.getSettings() });
  });

  router.patch("/settings", requireRole("admin"), requireRecentReauth, async (req, res) => {
    const changes = updateBillingSettingsRequestSchema.parse(req.body);
    const settings = await billing.updateSettings(actorOf(req), changes, requestContext(req));
    res.json({ settings });
  });

  router.get("/summary", requireRole("admin"), async (req, res) => {
    const { year } = billingSummaryQuerySchema.parse(req.query);
    res.json({ summary: await billing.summary(actorOf(req), year) });
  });

  return router;
}

/** /api/invoices: invoices across the signed-in person's own matters, and the CSV export. */
export function invoicesRouter(billing: BillingService): Router {
  const router = Router();
  router.use(requireRole("lawyer", "assistant"));

  router.get("/", async (req, res) => {
    const query = invoiceListQuerySchema.parse(req.query);
    const page = await billing.listInvoices(actorOf(req), query);
    res.json({ invoices: page.items, page: page.page, hasMore: page.hasMore });
  });

  router.get("/export", requireRole("lawyer"), async (req, res) => {
    const { from, to } = exportQuerySchema.parse(req.query);
    const file = await billing.exportCsv(actorOf(req), from, to, requestContext(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.body);
  });

  return router;
}

/** /api/matters/:matterId/fee-agreements */
export function feeAgreementsRouter(billing: BillingService): Router {
  const router = Router({ mergeParams: true });
  validateIds(router, "matterId", "agreementId");

  router.get("/", async (req, res) => {
    const feeAgreements = await billing.listFeeAgreements(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ feeAgreements });
  });

  router.post("/", async (req, res) => {
    const input = createFeeAgreementRequestSchema.parse(req.body);
    const feeAgreement = await billing.createFeeAgreement(
      actorOf(req),
      param(req, "matterId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ feeAgreement });
  });

  router.patch("/:agreementId", async (req, res) => {
    const changes = updateFeeAgreementRequestSchema.parse(req.body);
    const feeAgreement = await billing.updateFeeAgreement(
      actorOf(req),
      param(req, "matterId"),
      param(req, "agreementId"),
      changes,
      requestContext(req),
    );
    res.json({ feeAgreement });
  });

  return router;
}

/** /api/matters/:matterId/invoices: invoices, credit notes and their payments. */
export function matterInvoicesRouter(billing: BillingService): Router {
  const router = Router({ mergeParams: true });
  validateIds(router, "matterId", "invoiceId", "paymentId");

  router.get("/", async (req, res) => {
    const invoices = await billing.listMatterInvoices(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ invoices });
  });

  router.post("/", async (req, res) => {
    const input = createInvoiceRequestSchema.parse(req.body);
    const invoice = await billing.createInvoice(
      actorOf(req),
      param(req, "matterId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ invoice });
  });

  router.get("/:invoiceId", async (req, res) => {
    const invoice = await billing.getInvoice(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      requestContext(req),
    );
    res.json({ invoice });
  });

  router.patch("/:invoiceId", async (req, res) => {
    const changes = updateInvoiceRequestSchema.parse(req.body);
    const invoice = await billing.updateInvoice(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      changes,
      requestContext(req),
    );
    res.json({ invoice });
  });

  router.delete("/:invoiceId", async (req, res) => {
    await billing.deleteInvoice(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      requestContext(req),
    );
    res.status(204).end();
  });

  router.post("/:invoiceId/issue", async (req, res) => {
    const invoice = await billing.issueInvoice(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      requestContext(req),
    );
    res.json({ invoice });
  });

  router.post("/:invoiceId/credit-note", async (req, res) => {
    const invoice = await billing.createCreditNote(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      requestContext(req),
    );
    res.status(201).json({ invoice });
  });

  router.post("/:invoiceId/payments", async (req, res) => {
    const input = recordPaymentRequestSchema.parse(req.body);
    const invoice = await billing.recordPayment(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ invoice });
  });

  router.post("/:invoiceId/payments/:paymentId/void", async (req, res) => {
    const { reason } = voidPaymentRequestSchema.parse(req.body);
    const invoice = await billing.voidPayment(
      actorOf(req),
      param(req, "matterId"),
      param(req, "invoiceId"),
      param(req, "paymentId"),
      reason,
      requestContext(req),
    );
    res.json({ invoice });
  });

  return router;
}
