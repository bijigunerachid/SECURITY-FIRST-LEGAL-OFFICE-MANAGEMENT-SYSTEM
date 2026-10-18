import { z } from "zod";

/**
 * Request and response contracts for authentication and user
 * administration. All request schemas are strict: unknown fields are
 * rejected, so a client cannot slip in `role`, `id` or similar (mass
 * assignment).
 */

export const roles = ["admin", "lawyer", "assistant"] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Length bounds only; the full policy (breached list, personal info) runs on the server. */
export const newPasswordSchema = z.string().min(15).max(128);
/** For checking an existing password: any length, bounded to limit hashing cost. */
const existingPasswordSchema = z.string().min(1).max(128);

export const totpCodeSchema = z.string().regex(/^\d{6}$/);
export const recoveryCodeSchema = z
  .string()
  .trim()
  .min(15)
  .max(24)
  .regex(/^[A-Za-z0-9\s-]+$/);
export const displayNameSchema = z.string().trim().min(1).max(120);
/** Password setup/reset tokens: 32 random bytes, base64url. */
export const passwordTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: existingPasswordSchema,
});

export const sessionStates = ["active", "mfa_pending", "mfa_setup_required"] as const;
export const sessionStateSchema = z.enum(sessionStates);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const loginResponseSchema = z.strictObject({ state: sessionStateSchema });

export const mfaVerifyRequestSchema = z.union([
  z.strictObject({ code: totpCodeSchema }),
  z.strictObject({ recoveryCode: recoveryCodeSchema }),
]);

export const sessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  mfaEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.strictObject({
  user: sessionUserSchema,
  state: sessionStateSchema,
  csrfToken: z.string(),
  expiresAt: z.iso.datetime(),
  /** True when a sensitive action may be done without re-entering the password. */
  recentlyReauthenticated: z.boolean(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const reauthRequestSchema = z.strictObject({
  password: existingPasswordSchema,
  code: totpCodeSchema.optional(),
});

export const totpSetupResponseSchema = z.strictObject({
  /** Base32 secret, for typing into an authenticator by hand. */
  secret: z.string(),
  /** otpauth:// URI, shown as a QR code. */
  uri: z.string(),
});

export const totpConfirmRequestSchema = z.strictObject({ code: totpCodeSchema });

export const recoveryCodesResponseSchema = z.strictObject({
  recoveryCodes: z.array(z.string()),
});

export const passwordChangeRequestSchema = z.strictObject({
  currentPassword: existingPasswordSchema,
  newPassword: newPasswordSchema,
});

export const passwordSetRequestSchema = z.strictObject({
  token: passwordTokenSchema,
  password: newPasswordSchema,
});

export const revokedSessionsResponseSchema = z.strictObject({ revoked: z.number().int() });

// --- User administration -----------------------------------------------------

export const adminUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  disabled: z.boolean(),
  mfaEnabled: z.boolean(),
  hasPassword: z.boolean(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListResponseSchema = z.strictObject({ users: z.array(adminUserSchema) });

export const createUserRequestSchema = z.strictObject({
  email: emailSchema,
  displayName: displayNameSchema,
  role: roleSchema,
});

export const updateUserRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    role: roleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

/** A single-use link to set a password. Shown once; give it to the person directly. */
export const passwordTokenResponseSchema = z.strictObject({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});

export const createUserResponseSchema = z.strictObject({
  user: adminUserSchema,
  setup: passwordTokenResponseSchema,
});
