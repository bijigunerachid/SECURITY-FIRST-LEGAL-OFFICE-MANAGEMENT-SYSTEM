import { createUserRequestSchema, updateUserRequestSchema } from "@lexora/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import type { AuthService } from "../../modules/auth/auth-service.js";
import { notFound } from "../errors.js";
import { requireRecentReauth, requireRole, requireSession, sessionOf } from "../middleware/auth.js";
import { requestContext } from "./auth.js";

const userIdSchema = z.uuid();

/** The validated `:userId` (checked by `router.param` below). */
function userIdParam(req: Request): string {
  const value = req.params["userId"];
  return typeof value === "string" ? value : "";
}

/**
 * /api/admin/users — user administration. Only fully signed-in
 * administrators (which implies a second factor) reach these routes; others
 * get 404. Every change also needs a recent re-entry of the password.
 */
export function adminUsersRouter(auth: AuthService): Router {
  const router = Router();
  router.use(requireSession(), requireRole("admin"));

  router.param("userId", (_req, _res, next, value: string) => {
    // Malformed IDs are "not found", not validation errors: nothing to learn.
    next(userIdSchema.safeParse(value).success ? undefined : notFound());
  });

  router.get("/", async (_req, res) => {
    res.json({ users: await auth.listUsers() });
  });

  router.post("/", requireRecentReauth, async (req, res) => {
    const input = createUserRequestSchema.parse(req.body);
    const ctx = requestContext(req);
    const { userId, setup } = await auth.createUser(input, sessionOf(req).user.id, ctx);
    const user = (await auth.listUsers()).find((u) => u.id === userId);
    res
      .status(201)
      .json({ user, setup: { token: setup.token, expiresAt: setup.expiresAt.toISOString() } });
  });

  router.patch("/:userId", requireRecentReauth, async (req, res) => {
    const changes = updateUserRequestSchema.parse(req.body);
    await auth.updateUser(sessionOf(req), userIdParam(req), changes, requestContext(req));
    res.status(204).end();
  });

  router.post("/:userId/password-token", requireRecentReauth, async (req, res) => {
    const issued = await auth.adminIssuePasswordToken(
      sessionOf(req),
      userIdParam(req),
      requestContext(req),
    );
    res.json({ token: issued.token, expiresAt: issued.expiresAt.toISOString() });
  });

  router.post("/:userId/mfa-reset", requireRecentReauth, async (req, res) => {
    await auth.adminResetSecondFactor(sessionOf(req), userIdParam(req), requestContext(req));
    res.status(204).end();
  });

  router.post("/:userId/sessions/revoke", requireRecentReauth, async (req, res) => {
    const revoked = await auth.adminRevokeSessions(
      sessionOf(req),
      userIdParam(req),
      requestContext(req),
    );
    res.json({ revoked });
  });

  return router;
}
