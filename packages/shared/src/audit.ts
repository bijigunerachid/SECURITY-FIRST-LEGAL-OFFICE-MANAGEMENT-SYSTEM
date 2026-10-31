import { z } from "zod";
import { calendarDateSchema, multiLine, personRefSchema } from "./matters.js";

/**
 * The audit-log viewer (administrators), the matter history (lead lawyers)
 * and security alerts (administrators).
 *
 * Audit events hold IDs, action names, outcomes, field names, counts and
 * reason codes, never matter content, so administrators can read the whole
 * log without seeing what a matter is about (decision D2).
 */

export const auditOutcomes = ["success", "failure", "denied"] as const;
export const auditOutcomeSchema = z.enum(auditOutcomes);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const AUDIT_PAGE_SIZE = 50;

/** Audit event IDs are 64-bit integers, sent as decimal strings. */
const eventIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);
const uuid = z.uuid();
/**
 * The same instant in office time ("YYYY-MM-DDTHH:mm:ss"), computed by the
 * server: the browser only spells it out and never converts time zones.
 */
const officeTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

export const auditQuerySchema = z
  .strictObject({
    /** An action or the start of one: "auth.", "invoice.issue". */
    action: z
      .string()
      .regex(/^[a-z_.]{1,64}$/)
      .optional(),
    outcome: auditOutcomeSchema.optional(),
    actorId: uuid.optional(),
    targetType: z
      .string()
      .regex(/^[a-z_]{1,32}$/)
      .optional(),
    targetId: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .optional(),
    /** Office calendar days, inclusive. */
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    /** Continue below this event ID (the previous page's `nextBefore`). */
    before: eventIdSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from after to", path: ["to"] });
export type AuditQuery = z.input<typeof auditQuerySchema>;

export const auditEventSchema = z.strictObject({
  id: eventIdSchema,
  occurredAt: z.iso.datetime(),
  occurredAtOffice: officeTimeSchema,
  /** Null for events with no signed-in person (unknown account, the worker). */
  actor: personRefSchema.nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  outcome: auditOutcomeSchema,
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditListResponseSchema = z.strictObject({
  events: z.array(auditEventSchema),
  /** Pass as `before` for the next page; null when there is none. */
  nextBefore: eventIdSchema.nullable(),
});

export const auditVerificationSchema = z.strictObject({
  valid: z.boolean(),
  checked: z.number().int(),
  /** The first event whose hash or link does not match. */
  firstInvalidId: eventIdSchema.nullable(),
  latestHash: z.string().nullable(),
  verifiedAt: z.iso.datetime(),
});
export type AuditVerification = z.infer<typeof auditVerificationSchema>;
export const auditVerificationResponseSchema = z.strictObject({
  verification: auditVerificationSchema,
});

// --- Matter history ------------------------------------------------------------------

export const matterHistoryQuerySchema = z.strictObject({ before: eventIdSchema.optional() });

/** One entry of a matter's history, for its lead lawyer. No IP addresses. */
export const matterHistoryEventSchema = z.strictObject({
  id: eventIdSchema,
  occurredAt: z.iso.datetime(),
  occurredAtOffice: officeTimeSchema,
  actor: personRefSchema.nullable(),
  action: z.string(),
  outcome: auditOutcomeSchema,
  targetType: z.string().nullable(),
  /** For changes: the names of the fields changed (never their values). */
  fields: z.array(z.string()).nullable(),
  /** Done by an administrator under break-glass access. */
  breakGlass: z.boolean(),
});
export type MatterHistoryEvent = z.infer<typeof matterHistoryEventSchema>;
export const matterHistoryResponseSchema = z.strictObject({
  events: z.array(matterHistoryEventSchema),
  nextBefore: eventIdSchema.nullable(),
});

// --- Security alerts -------------------------------------------------------------------

export const alertKinds = [
  /** Repeated failed sign-in, code or password checks for one account. */
  "login_failures_account",
  /** Repeated failed or refused sign-ins from one IP address. */
  "login_failures_ip",
  /** One person refused access to records again and again (probing). */
  "access_denied",
  /** An administrator used break-glass access to a matter. */
  "break_glass",
  /** The audit log's hash chain no longer verifies. */
  "audit_chain",
  /** A backup reported a failure. */
  "backup_failed",
  /** No successful backup for longer than expected. */
  "backup_overdue",
] as const;
export const alertKindSchema = z.enum(alertKinds);
export type AlertKind = z.infer<typeof alertKindSchema>;

export const alertSeverities = ["high", "critical"] as const;
export const alertSeveritySchema = z.enum(alertSeverities);

export const alertStatuses = ["open", "acknowledged", "resolved"] as const;
export const alertStatusSchema = z.enum(alertStatuses);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const alertSchema = z.strictObject({
  id: uuid,
  kind: alertKindSchema,
  severity: alertSeveritySchema,
  /** What the alert is about: an account ID, an IP address, a grant, an event ID… */
  subject: z.string(),
  /** The account concerned, when there is one. */
  user: personRefSchema.nullable(),
  /** How many events were seen. */
  count: z.number().int(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  firstSeenAtOffice: officeTimeSchema,
  lastSeenAtOffice: officeTimeSchema,
  status: alertStatusSchema,
  acknowledgedBy: personRefSchema.nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  resolvedBy: personRefSchema.nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SecurityAlert = z.infer<typeof alertSchema>;

/** What the alerts page shows: everything still to handle (open or acknowledged), or the resolved ones. */
export const alertViews = ["unresolved", "resolved"] as const;
export const alertViewSchema = z.enum(alertViews);
export type AlertView = z.infer<typeof alertViewSchema>;

export const alertListQuerySchema = z.strictObject({
  view: alertViewSchema.default("unresolved"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export const alertListResponseSchema = z.strictObject({
  alerts: z.array(alertSchema),
  page: z.number().int(),
  hasMore: z.boolean(),
});
export const alertResponseSchema = z.strictObject({ alert: alertSchema });
/** Alerts not yet resolved, for the menu badge. */
export const alertCountResponseSchema = z.strictObject({ unresolved: z.number().int().min(0) });

export const resolveAlertRequestSchema = z.strictObject({
  note: multiLine(500).pipe(z.string().min(5)),
});
