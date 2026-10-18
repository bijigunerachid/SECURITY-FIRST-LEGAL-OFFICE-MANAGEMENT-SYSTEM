import { apiErrorResponseSchema, type ApiErrorCode } from "@lexora/shared";
import type { z } from "zod";

const DEFAULT_TIMEOUT_MS = 10_000;

/** A failed API call. `code` is null when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly code: ApiErrorCode | "network_error" | "invalid_response",
    public readonly requestId: string | null = null,
  ) {
    super(`API request failed: ${code}`);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Some endpoints answer with a meaningful body on an error status (e.g. 503 readiness). */
  acceptStatuses?: number[];
}

/**
 * Calls the same-origin API and validates the response with a shared Zod
 * schema, so the UI never trusts an unexpected response shape. Cookies are
 * sent only to our own origin.
 */
export async function getJson<T extends z.ZodType>(
  path: `/api/${string}`,
  schema: T,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, acceptStatuses = [] }: RequestOptions = {},
): Promise<z.infer<T>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: combined,
    });
  } catch {
    throw new ApiError(null, "network_error");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "invalid_response");
  }

  if (response.ok || acceptStatuses.includes(response.status)) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(response.status, "invalid_response");
    }
    return parsed.data;
  }

  const error = apiErrorResponseSchema.safeParse(body);
  if (error.success) {
    throw new ApiError(response.status, error.data.error.code, error.data.error.requestId);
  }
  throw new ApiError(response.status, "invalid_response");
}
