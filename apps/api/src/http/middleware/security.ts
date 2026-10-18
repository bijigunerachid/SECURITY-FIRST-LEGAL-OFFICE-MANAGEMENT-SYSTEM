import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import { HttpError } from "../errors.js";

/**
 * Security headers for API responses. The API only returns JSON and files,
 * so its Content Security Policy forbids everything. The web application's
 * own policy is set where its HTML is served (the reverse proxy).
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    xFrameOptions: { action: "deny" },
  });
}

/** Confidential responses must never be stored by browsers or proxies. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hasBody(req: Request): boolean {
  const length = req.headers["content-length"];
  return req.headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0");
}

/**
 * Request bodies must be JSON. HTML forms on other sites cannot send
 * `application/json` without a CORS preflight, so this also narrows CSRF.
 * Routes that accept file uploads will opt out explicitly.
 */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (METHODS_WITH_BODY.has(req.method) && hasBody(req) && !req.is("application/json")) {
    next(new HttpError(415, "unsupported_media_type"));
    return;
  }
  next();
}
