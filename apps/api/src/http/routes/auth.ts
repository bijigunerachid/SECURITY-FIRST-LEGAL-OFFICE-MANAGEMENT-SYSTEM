import {
  loginRequestSchema,
  mfaVerifyRequestSchema,
  passwordChangeRequestSchema,
  passwordSetRequestSchema,
  reauthRequestSchema,
  totpConfirmRequestSchema,
  type SessionResponse,
} from "@lexora/shared";
import { Router, type Request, type Response } from "express";
import type {
  AuthService,
  IssuedSession,
  RequestContext,
} from "../../modules/auth/auth-service.js";
import { isRecentlyReauthenticated } from "../../modules/auth/sessions.js";
import {
  clearSessionCookie,
  requireRecentReauth,
  requireSession,
  sessionOf,
  setSessionCookie,
} from "../middleware/auth.js";

export function requestContext(req: Request): RequestContext {
  return {
    requestId: typeof req.id === "string" ? req.id : "unknown",
    ipAddress: req.ip ?? "unknown",
  };
}

function sendIssued(res: Response, issued: IssuedSession, status = 200): void {
  setSessionCookie(res, issued.token, issued.expiresAt);
  res.status(status).json({ state: issued.state });
}

/**
 * /api/auth — sign-in, second factor, passwords and the current session.
 * These routes are reachable without a full session; each one states which
 * session states it accepts.
 */
export function authRouter(auth: AuthService): Router {
  const router = Router();

  router.get(
    "/session",
    requireSession("active", "mfa_pending", "mfa_setup_required"),
    (req, res) => {
      const session = sessionOf(req);
      const body: SessionResponse = {
        user: session.user,
        state: session.state,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt.toISOString(),
        recentlyReauthenticated: isRecentlyReauthenticated(session),
      };
      res.json(body);
    },
  );

  router.post("/login", async (req, res) => {
    const { email, password } = loginRequestSchema.parse(req.body);
    // Signing in replaces any session this browser had (no session fixation).
    if (req.auth) {
      await auth.sessions.revoke(req.auth.id);
    }
    sendIssued(res, await auth.login(email, password, requestContext(req)));
  });

  router.post("/logout", async (req, res) => {
    if (req.auth) {
      await auth.sessions.revoke(req.auth.id);
      await auth.audit(
        { action: "auth.logout", outcome: "success", actorUserId: req.auth.user.id },
        requestContext(req),
      );
    }
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post("/mfa/verify", requireSession("mfa_pending"), async (req, res) => {
    const input = mfaVerifyRequestSchema.parse(req.body);
    sendIssued(res, await auth.verifyMfa(sessionOf(req), input, requestContext(req)));
  });

  // Enrolment: allowed for an administrator who must set up a second factor,
  // or for anyone signed in who has just re-entered their password.
  router.post(
    "/mfa/totp/setup",
    requireSession("active", "mfa_setup_required"),
    (req, res, next) => {
      if (sessionOf(req).state === "active") {
        requireRecentReauth(req, res, next);
        return;
      }
      next();
    },
    async (req, res) => {
      res.json(await auth.startTotpEnrolment(sessionOf(req)));
    },
  );

  router.post(
    "/mfa/totp/confirm",
    requireSession("active", "mfa_setup_required"),
    async (req, res) => {
      const { code } = totpConfirmRequestSchema.parse(req.body);
      const { issued, recoveryCodes } = await auth.confirmTotpEnrolment(
        sessionOf(req),
        code,
        requestContext(req),
      );
      setSessionCookie(res, issued.token, issued.expiresAt);
      res.json({ recoveryCodes });
    },
  );

  router.post("/mfa/recovery-codes", requireSession(), requireRecentReauth, async (req, res) => {
    res.json({
      recoveryCodes: await auth.regenerateRecoveryCodes(sessionOf(req), requestContext(req)),
    });
  });

  router.delete("/mfa/totp", requireSession(), requireRecentReauth, async (req, res) => {
    await auth.disableOwnTotp(sessionOf(req), requestContext(req));
    res.status(204).end();
  });

  router.post("/reauth", requireSession(), async (req, res) => {
    const input = reauthRequestSchema.parse(req.body);
    await auth.reauthenticate(sessionOf(req), input, requestContext(req));
    res.status(204).end();
  });

  router.post("/password/change", requireSession(), async (req, res) => {
    const { currentPassword, newPassword } = passwordChangeRequestSchema.parse(req.body);
    sendIssued(
      res,
      await auth.changePassword(sessionOf(req), currentPassword, newPassword, requestContext(req)),
    );
  });

  router.post("/password/set", async (req, res) => {
    const { token, password } = passwordSetRequestSchema.parse(req.body);
    await auth.setPasswordWithToken(token, password, requestContext(req));
    // Any session in this browser belonged to before the reset; drop it.
    if (req.auth) {
      await auth.sessions.revoke(req.auth.id);
    }
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post("/sessions/revoke-others", requireSession(), async (req, res) => {
    const session = sessionOf(req);
    const revoked = await auth.sessions.revokeAllForUser(session.user.id, session.id);
    await auth.audit(
      {
        action: "auth.sessions.revoke_others",
        outcome: "success",
        actorUserId: session.user.id,
        metadata: { revoked },
      },
      requestContext(req),
    );
    res.json({ revoked });
  });

  return router;
}
