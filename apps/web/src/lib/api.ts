import {
  apiErrorResponseSchema,
  type ApiErrorCode,
  type PasswordProblemCode,
} from "@lexora/shared";
import type { z } from "zod";

const DEFAULT_TIMEOUT_MS = 10_000;

/** A failed API call. `status` is null when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly code: ApiErrorCode | "network_error" | "invalid_response",
    public readonly requestId: string | null = null,
    /** For `password_rejected`: which rule the password broke. */
    public readonly reason: PasswordProblemCode | null = null,
    /** For `validation_failed`: the paths of the fields the server refused. */
    public readonly fields: string[] = [],
  ) {
    super(`API request failed: ${code}`);
    this.name = "ApiError";
  }
}

export const isApiError = (error: unknown, code?: ApiError["code"]): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

/**
 * The CSRF token of the current session. It is not secret from our own
 * page (it is returned by /api/auth/session); it proves to the server that
 * a request was made by this page and not by another site.
 */
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

interface RequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  /** Some endpoints answer with a meaningful body on an error status (e.g. 503 readiness). */
  acceptStatuses?: number[];
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function call(
  method: Method,
  path: `/api/${string}`,
  body: unknown,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  try {
    return await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: combined,
    });
  } catch {
    throw new ApiError(null, "network_error");
  }
}

async function toError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError(response.status, "invalid_response");
  }
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (!parsed.success) return new ApiError(response.status, "invalid_response");
  const { code, requestId, reason, fields } = parsed.data.error;
  return new ApiError(
    response.status,
    code,
    requestId,
    reason ?? null,
    fields?.map((f) => f.path) ?? [],
  );
}

async function parseBody<T extends z.ZodType>(response: Response, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "invalid_response");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(response.status, "invalid_response");
  return parsed.data;
}

/**
 * Calls the same-origin API and validates the response with a shared Zod
 * schema, so the UI never trusts an unexpected response shape. Cookies are
 * sent only to our own origin.
 */
export async function getJson<T extends z.ZodType>(
  path: `/api/${string}`,
  schema: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const response = await call("GET", path, undefined, options);
  if (response.ok || options.acceptStatuses?.includes(response.status)) {
    return parseBody(response, schema);
  }
  throw await toError(response);
}

/** A state-changing request. Sends the CSRF token. Pass no schema for 204 responses. */
export async function send<T extends z.ZodType>(
  method: Exclude<Method, "GET">,
  path: `/api/${string}`,
  body?: unknown,
  schema?: T,
  options: RequestOptions = {},
): Promise<z.infer<T>> {
  const response = await call(method, path, body, options);
  if (!response.ok) throw await toError(response);
  if (!schema) return undefined as z.infer<T>;
  return parseBody(response, schema);
}
