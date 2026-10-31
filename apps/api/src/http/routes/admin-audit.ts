import {
  alertListQuerySchema,
  auditQuerySchema,
  matterHistoryQuerySchema,
  resolveAlertRequestSchema,
} from "@lexora/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { AlertService } from "../../modules/alerts/alert-service.js";
import type { AuditService } from "../../modules/audit/audit-service.js";
import type { Actor } from "../../modules/policy/matter-policy.js";
import { notFound } from "../errors.js";
import { requireRole, requireSession, sessionOf } from "../middleware/auth.js";
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

/** /api/admin/audit: the audit-log viewer and its integrity check. Administrators only (404 for others). */
export function adminAuditRouter(audit: AuditService): Router {
  const router = Router();
  router.use(requireSession(), requireRole("admin"));

  router.get("/", async (req, res) => {
    const query = auditQuerySchema.parse(req.query);
    res.json(await audit.search(actorOf(req), query, requestContext(req)));
  });

  router.post("/verify", async (req, res) => {
    res.json({ verification: await audit.verify(actorOf(req), requestContext(req)) });
  });

  return router;
}

/** /api/admin/alerts: security alerts. Administrators only (404 for others). */
export function adminAlertsRouter(alerts: AlertService): Router {
  const router = Router();
  router.use(requireSession(), requireRole("admin"));
  validateIds(router, "alertId");

  router.get("/", async (req, res) => {
    const query = alertListQuerySchema.parse(req.query);
    const page = await alerts.list(actorOf(req), query);
    res.json({ alerts: page.items, page: page.page, hasMore: page.hasMore });
  });

  router.get("/count", async (req, res) => {
    res.json({ unresolved: await alerts.unresolvedCount(actorOf(req)) });
  });

  router.post("/:alertId/acknowledge", async (req, res) => {
    const alert = await alerts.acknowledge(
      actorOf(req),
      param(req, "alertId"),
      requestContext(req),
    );
    res.json({ alert });
  });

  router.post("/:alertId/resolve", async (req, res) => {
    const { note } = resolveAlertRequestSchema.parse(req.body);
    const alert = await alerts.resolve(
      actorOf(req),
      param(req, "alertId"),
      note,
      requestContext(req),
    );
    res.json({ alert });
  });

  return router;
}

/** /api/matters/:matterId/history: the matter's audit history, for its lead lawyer. */
export function matterHistoryRouter(audit: AuditService): Router {
  const router = Router({ mergeParams: true });
  validateIds(router, "matterId");

  router.get("/", async (req, res) => {
    const { before } = matterHistoryQuerySchema.parse(req.query);
    res.json(
      await audit.matterHistory(actorOf(req), param(req, "matterId"), before, requestContext(req)),
    );
  });

  return router;
}
