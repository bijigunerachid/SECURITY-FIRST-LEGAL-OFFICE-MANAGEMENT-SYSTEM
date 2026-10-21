import {
  addMemberRequestSchema,
  breakGlassRequestSchema,
  conflictQuerySchema,
  createClientRequestSchema,
  createMatterRequestSchema,
  listQuerySchema,
  matterListQuerySchema,
  partyRequestSchema,
  transferLeadRequestSchema,
  updateClientRequestSchema,
  updateMatterRequestSchema,
  updatePartyRequestSchema,
} from "@lexora/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { BreakGlassService } from "../../modules/matters/break-glass.js";
import type { MatterService } from "../../modules/matters/matter-service.js";
import type { Actor } from "../../modules/policy/matter-policy.js";
import { notFound } from "../errors.js";
import { requireRecentReauth, requireRole, sessionOf } from "../middleware/auth.js";
import { requestContext } from "./auth.js";

const idSchema = z.uuid();

/** Malformed IDs are "not found", not validation errors: there is nothing to learn. */
function validateIds(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => {
      next(idSchema.safeParse(value).success ? undefined : notFound());
    });
  }
}

/** A path parameter already checked by `validateIds`. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function actorOf(req: Request): Actor {
  const { user } = sessionOf(req);
  return { id: user.id, role: user.role };
}

/**
 * /api/clients. Everyone signed in may call these routes, but each answer is
 * limited by the policy module: a client is visible through a matter the
 * user belongs to. Only lawyers record new clients.
 */
export function clientsRouter(matters: MatterService): Router {
  const router = Router();
  validateIds(router, "clientId");

  router.get("/", async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const page = await matters.listClients(actorOf(req), query);
    res.json({ clients: page.items, page: page.page, hasMore: page.hasMore });
  });

  router.post("/", requireRole("lawyer"), async (req, res) => {
    const input = createClientRequestSchema.parse(req.body);
    const client = await matters.createClient(actorOf(req), input, requestContext(req));
    res.status(201).json({ client });
  });

  router.get("/:clientId", async (req, res) => {
    const client = await matters.getClient(
      actorOf(req),
      param(req, "clientId"),
      requestContext(req),
    );
    res.json({ client });
  });

  router.patch("/:clientId", async (req, res) => {
    const changes = updateClientRequestSchema.parse(req.body);
    await matters.updateClient(actorOf(req), param(req, "clientId"), changes, requestContext(req));
    res.status(204).end();
  });

  return router;
}

/** /api/matters: matters, their team and their parties. */
export function mattersRouter(matters: MatterService): Router {
  const router = Router();
  validateIds(router, "matterId", "userId", "partyId");

  router.get("/", async (req, res) => {
    const query = matterListQuerySchema.parse(req.query);
    const page = await matters.listMatters(actorOf(req), query);
    res.json({ matters: page.items, page: page.page, hasMore: page.hasMore });
  });

  router.post("/", requireRole("lawyer"), async (req, res) => {
    const input = createMatterRequestSchema.parse(req.body);
    const matter = await matters.createMatter(actorOf(req), input, requestContext(req));
    res.status(201).json({ matter });
  });

  router.get("/:matterId", async (req, res) => {
    const matter = await matters.getMatter(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ matter });
  });

  router.patch("/:matterId", async (req, res) => {
    const changes = updateMatterRequestSchema.parse(req.body);
    await matters.updateMatter(actorOf(req), param(req, "matterId"), changes, requestContext(req));
    res.status(204).end();
  });

  router.get("/:matterId/candidates", async (req, res) => {
    const users = await matters.teamCandidates(
      actorOf(req),
      param(req, "matterId"),
      requestContext(req),
    );
    res.json({ users });
  });

  router.post("/:matterId/members", async (req, res) => {
    const { userId } = addMemberRequestSchema.parse(req.body);
    await matters.addMember(actorOf(req), param(req, "matterId"), userId, requestContext(req));
    res.status(204).end();
  });

  router.delete("/:matterId/members/:userId", async (req, res) => {
    await matters.removeMember(
      actorOf(req),
      param(req, "matterId"),
      param(req, "userId"),
      requestContext(req),
    );
    res.status(204).end();
  });

  router.post("/:matterId/lead", async (req, res) => {
    const { userId } = transferLeadRequestSchema.parse(req.body);
    await matters.transferLead(actorOf(req), param(req, "matterId"), userId, requestContext(req));
    res.status(204).end();
  });

  router.post("/:matterId/parties", async (req, res) => {
    const input = partyRequestSchema.parse(req.body);
    const id = await matters.addParty(
      actorOf(req),
      param(req, "matterId"),
      input,
      requestContext(req),
    );
    res.status(201).json({ id });
  });

  router.patch("/:matterId/parties/:partyId", async (req, res) => {
    const changes = updatePartyRequestSchema.parse(req.body);
    await matters.updateParty(
      actorOf(req),
      param(req, "matterId"),
      param(req, "partyId"),
      changes,
      requestContext(req),
    );
    res.status(204).end();
  });

  router.delete("/:matterId/parties/:partyId", async (req, res) => {
    await matters.removeParty(
      actorOf(req),
      param(req, "matterId"),
      param(req, "partyId"),
      requestContext(req),
    );
    res.status(204).end();
  });

  return router;
}

/** /api/conflicts: conflict-of-interest search, for lawyers only (404 for others). */
export function conflictsRouter(matters: MatterService): Router {
  const router = Router();
  router.use(requireRole("lawyer"));
  router.get("/", async (req, res) => {
    const { q } = conflictQuerySchema.parse(req.query);
    res.json(await matters.searchConflicts(actorOf(req), q, requestContext(req)));
  });
  return router;
}

/**
 * /api/break-glass: emergency, read-only access to one matter for
 * administrators (404 for everyone else). Opening access needs a recent
 * re-entry of the password and code.
 */
export function breakGlassRouter(breakGlass: BreakGlassService): Router {
  const router = Router();
  router.use(requireRole("admin"));
  validateIds(router, "grantId");

  router.get("/", async (req, res) => {
    res.json({ grants: await breakGlass.listActive(actorOf(req)) });
  });

  router.post("/", requireRecentReauth, async (req, res) => {
    const input = breakGlassRequestSchema.parse(req.body);
    const grant = await breakGlass.grant(actorOf(req), input, requestContext(req));
    res.status(201).json({ grant });
  });

  router.post("/:grantId/end", async (req, res) => {
    await breakGlass.end(actorOf(req), param(req, "grantId"), requestContext(req));
    res.status(204).end();
  });

  return router;
}
