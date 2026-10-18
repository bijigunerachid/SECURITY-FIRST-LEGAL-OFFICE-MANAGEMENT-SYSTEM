import type { ApiErrorCode, ApiErrorResponse } from "@lexora/shared";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError, notFound } from "../errors.js";

/** Errors raised by Express's body parser carry a `type` and a `status`. */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as Partial<BodyParserError>).type === "string" &&
    typeof (err as Partial<BodyParserError>).status === "number"
  );
}

const BODY_PARSER_ERRORS: Record<string, { status: number; code: ApiErrorCode }> = {
  "entity.parse.failed": { status: 400, code: "bad_request" },
  "entity.too.large": { status: 413, code: "payload_too_large" },
  "encoding.unsupported": { status: 415, code: "unsupported_media_type" },
  "charset.unsupported": { status: 415, code: "unsupported_media_type" },
  "request.aborted": { status: 400, code: "bad_request" },
};

/** Request IDs are always UUID strings (see request-logger.ts). */
function requestIdOf(req: Request): string {
  return typeof req.id === "string" ? req.id : "unknown";
}

/** Final handler for requests that matched no route. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound());
}

/**
 * Turns every error into the shared error shape. Clients see only a code and
 * the request ID; details stay in the server log. Validation errors list the
 * failing field paths, never the submitted values.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  let status = 500;
  let body: ApiErrorResponse = {
    error: { code: "internal_error", requestId: requestIdOf(req) },
  };

  if (err instanceof HttpError) {
    status = err.status;
    body = {
      error: {
        code: err.code,
        requestId: requestIdOf(req),
        ...(err.reason === undefined ? {} : { reason: err.reason }),
      },
    };
    if (err.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
    }
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: "validation_failed",
        requestId: requestIdOf(req),
        fields: err.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          issue: issue.code,
        })),
      },
    };
  } else if (isBodyParserError(err) && BODY_PARSER_ERRORS[err.type] !== undefined) {
    const mapped = BODY_PARSER_ERRORS[err.type];
    if (mapped !== undefined) {
      status = mapped.status;
      body = { error: { code: mapped.code, requestId: requestIdOf(req) } };
    }
  }

  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
  } else {
    req.log.warn({ code: body.error.code }, "request rejected");
  }

  res.status(status).json(body);
}
