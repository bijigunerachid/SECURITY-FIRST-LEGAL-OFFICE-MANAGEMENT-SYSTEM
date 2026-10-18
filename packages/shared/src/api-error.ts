import { z } from "zod";

/** Stable, machine-readable error codes. Messages are chosen by the client. */
export const apiErrorCodes = [
  "bad_request",
  "validation_failed",
  "unsupported_media_type",
  "payload_too_large",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
  "service_unavailable",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

/**
 * Every error response from the API has this shape. It never includes stack
 * traces, SQL, record contents or the values that failed validation.
 */
export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(apiErrorCodes),
    requestId: z.string(),
    /** Only for validation errors: which fields failed, never their values. */
    fields: z
      .array(
        z.strictObject({
          path: z.string(),
          issue: z.string(),
        }),
      )
      .optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
