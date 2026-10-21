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
  /** Wrong e-mail or password, unknown or disabled account: deliberately indistinguishable. */
  "invalid_credentials",
  /** Wrong or reused second-factor or recovery code. */
  "invalid_code",
  /** Password setup/reset link that is wrong, used or expired. */
  "invalid_token",
  /** New password refused by the password policy; see `reason`. */
  "password_rejected",
  /** The session must complete the second-factor step first. */
  "mfa_required",
  /** An administrator must set up a second factor before doing anything else. */
  "mfa_setup_required",
  /** The action needs the password (and code) re-entered in the last few minutes. */
  "reauthentication_required",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const passwordProblems = [
  "too_short",
  "too_long",
  "common",
  "contains_personal_info",
  "repetitive",
] as const;
export type PasswordProblemCode = (typeof passwordProblems)[number];

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
    /** Only for `password_rejected`: which rule the password broke. */
    reason: z.enum(passwordProblems).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
