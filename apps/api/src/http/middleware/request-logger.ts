import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pinoHttp, type HttpLogger } from "pino-http";
import type { Logger } from "../../lib/logger.js";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Path without the query string, which may contain personal data. */
function pathOnly(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

/**
 * Assigns every request a fresh random ID (never taken from the client, so
 * it cannot be used to inject text into logs), returns it in a response
 * header, and logs one line per request.
 *
 * Only the method, path, status and duration are logged: no headers, query
 * strings or bodies.
 */
export function requestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (_req: IncomingMessage, res: ServerResponse) => {
      const id = randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: pathOnly(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
      if (err !== undefined || res.statusCode >= 500) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
    customSuccessMessage: () => "request completed",
    customErrorMessage: () => "request failed",
  });
}
