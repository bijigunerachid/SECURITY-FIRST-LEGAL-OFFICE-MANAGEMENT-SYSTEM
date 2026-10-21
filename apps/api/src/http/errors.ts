import type { ApiErrorCode, PasswordProblemCode } from "@lexora/shared";

/**
 * An error whose code and status are safe to show to the client. Anything
 * else that reaches the error handler is reported as a generic 500.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message?: string,
    /** Extra, safe detail for the client. Only used for `password_rejected`. */
    public readonly reason?: PasswordProblemCode,
    /** Seconds the client should wait, sent as Retry-After (rate limiting). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export const notFound = (): HttpError => new HttpError(404, "not_found");
export const unauthenticated = (): HttpError => new HttpError(401, "unauthenticated");
export const forbidden = (): HttpError => new HttpError(403, "forbidden");
export const conflict = (message?: string): HttpError => new HttpError(409, "conflict", message);
export const rateLimited = (retryAfterSeconds: number): HttpError =>
  new HttpError(429, "rate_limited", undefined, undefined, retryAfterSeconds);
