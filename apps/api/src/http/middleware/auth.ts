import { parseCookie } from "cookie";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Role } from "../../generated/prisma/client.js";
import { safeEqual } from "../../lib/crypto.js";
import {
  SESSION_COOKIE,
  isRecentlyReauthenticated,
  type ResolvedSession,
  type SessionState,
  type SessionStore,
} from "../../modules/auth/sessions.js";
import { HttpError, forbidden, notFound, unauthenticated } from "../errors.js";

declare module "express-serve-static-core" {
  interface Request {
    /** The signed-in session, if the request carried a valid session cookie. */
    auth?: ResolvedSession;
  }
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
} as const;

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

/** Resolves the session cookie, if any, into `req.auth`. Never rejects by itself. */
export function loadSession(store: SessionStore): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.cookie;
    const token = header ? parseCookie(header)[SESSION_COOKIE] : undefined;
    if (token === undefined) {
      next();
      return;
    }
    const session = await store.resolve(token);
    if (session) {
      req.auth = session;
    } else {
      // Expired, revoked or forged: tell the browser to forget it.
      clearSessionCookie(res);
    }
    next();
  };
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-site request checks for state-changing requests:
 *
 * 1. If the browser says where the request comes from (`Origin`), it must be
 *    our own origin.
 * 2. Otherwise, if it sends Fetch Metadata, it must be `same-origin`.
 * 3. A request that carries a session must also echo that session's CSRF
 *    token in `X-CSRF-Token`.
 *
 * Together with SameSite=Strict cookies and JSON-only bodies, this blocks
 * cross-site request forgery.
 */
export function csrfProtection(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (origin !== undefined && origin !== appOrigin) {
      next(forbidden());
      return;
    }
    if (origin === undefined && fetchSite !== undefined && fetchSite !== "same-origin") {
      next(forbidden());
      return;
    }
    if (req.auth) {
      const sent = req.headers["x-csrf-token"];
      if (typeof sent !== "string" || !safeEqual(sent, req.auth.csrfToken)) {
        next(forbidden());
        return;
      }
    }
    next();
  };
}

/** Returns the session, or throws 401. Use inside handlers after `requireSession`. */
export function sessionOf(req: Request): ResolvedSession {
  if (!req.auth) {
    throw unauthenticated();
  }
  return req.auth;
}

/**
 * Requires a session in one of the given states (default: fully signed in).
 * A session that still owes its second factor gets a specific error so the
 * client knows which step to show.
 */
export function requireSession(...allowed: SessionState[]): RequestHandler {
  const states = new Set<SessionState>(allowed.length > 0 ? allowed : ["active"]);
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = req.auth;
    if (!session) {
      next(unauthenticated());
      return;
    }
    if (!states.has(session.state)) {
      if (session.state === "mfa_pending") {
        next(new HttpError(403, "mfa_required"));
      } else if (session.state === "mfa_setup_required") {
        next(new HttpError(403, "mfa_setup_required"));
      } else {
        next(forbidden());
      }
      return;
    }
    next();
  };
}

/**
 * Requires one of the given roles. Answers 404 rather than 403, so people
 * without access cannot even learn that the route exists.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.user.role)) {
      next(notFound());
      return;
    }
    next();
  };
}

/** Requires the password (and code) to have been re-entered in the last few minutes. */
export const requireRecentReauth: RequestHandler = (req, _res, next) => {
  if (!req.auth || !isRecentlyReauthenticated(req.auth)) {
    next(new HttpError(403, "reauthentication_required"));
    return;
  }
  next();
};
