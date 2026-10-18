import type { ApiErrorCode } from "@lexora/shared";

/**
 * An error whose code and status are safe to show to the client. Anything
 * else that reaches the error handler is reported as a generic 500.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export const notFound = (): HttpError => new HttpError(404, "not_found");
