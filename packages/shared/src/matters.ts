import { z } from "zod";
import { roleSchema } from "./auth.js";

/**
 * Request and response contracts for clients, matters, parties, matter teams,
 * conflict searches and break-glass access. Request schemas are strict:
 * unknown fields (an owner, a creator, a matter ID in the body) are refused.
 */

export const clientKinds = ["person", "company"] as const;
export const clientKindSchema = z.enum(clientKinds);
export type ClientKind = z.infer<typeof clientKindSchema>;

export const matterAreas = [
  "civil",
  "commercial",
  "criminal",
  "family",
  "administrative",
  "labour",
  "real_estate",
  "other",
] as const;
export const matterAreaSchema = z.enum(matterAreas);
export type MatterArea = z.infer<typeof matterAreaSchema>;

export const matterStatuses = ["open", "on_hold", "closed"] as const;
export const matterStatusSchema = z.enum(matterStatuses);
export type MatterStatus = z.infer<typeof matterStatusSchema>;

export const memberRoles = ["lead", "member"] as const;
export const memberRoleSchema = z.enum(memberRoles);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const partyRoles = [
  "opposing_party",
  "opposing_counsel",
  "co_party",
  "witness",
  "expert",
  "other",
] as const;
export const partyRoleSchema = z.enum(partyRoles);
export type PartyRole = z.infer<typeof partyRoleSchema>;

// --- Text fields ---------------------------------------------------------------

/**
 * Control characters, and the Unicode controls that reorder text (bidi
 * overrides and isolates). In a name they can make one text look like
 * another ("Trojan Source" spoofing), which matters for conflict searches.
 * The plain LRM/RLM marks stay allowed: mixed Arabic and French text may
 * legitimately need them.
 */
/* eslint-disable no-control-regex -- matching control characters is the point */
const UNSAFE_SINGLE_LINE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
/** As above, but line breaks and tabs are allowed. */
const UNSAFE_MULTI_LINE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
/* eslint-enable no-control-regex */

export const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !UNSAFE_SINGLE_LINE.test(v), { message: "unsupported characters" });

export const multiLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !UNSAFE_MULTI_LINE.test(v), { message: "unsupported characters" });

/** Optional text: an empty string means "no value" and is stored as null. */
export const optional = <T extends z.ZodType<string>>(schema: T) =>
  z
    .union([schema, z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

/** Must contain at least one letter or digit, so it can be searched. */
export const personOrCompanyNameSchema = singleLine(200).regex(/[\p{L}\p{N}]/u);
export const matterTitleSchema = singleLine(200).pipe(z.string().min(1));
/** CIN, passport, ICE, RC…: letters, digits and simple separators only. */
export const identifierSchema = singleLine(64).regex(
  /^(?:[\p{L}\p{N} ./-]*[\p{L}\p{N}][\p{L}\p{N} ./-]*)?$/u,
);
export const phoneSchema = singleLine(32).regex(/^(?:[+0-9 ().-]{6,32})?$/);
const optionalEmail = z
  .union([z.literal(""), z.string().trim().toLowerCase().max(254).pipe(z.email()), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();
/** Calendar date, YYYY-MM-DD. */
export const calendarDateSchema = z.iso.date();
const uuid = z.uuid();

// --- Clients -------------------------------------------------------------------

const clientFields = {
  name: personOrCompanyNameSchema,
  identifier: optional(identifierSchema),
  email: optionalEmail,
  phone: optional(phoneSchema),
  address: optional(multiLine(500)),
  notes: optional(multiLine(4000)),
};

export const createClientRequestSchema = z.strictObject({
  kind: clientKindSchema,
  ...clientFields,
});
export type CreateClientRequest = z.input<typeof createClientRequestSchema>;

export const updateClientRequestSchema = z
  .strictObject({ ...clientFields, name: clientFields.name.optional() })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateClientRequest = z.input<typeof updateClientRequestSchema>;

export const clientSummarySchema = z.strictObject({
  id: uuid,
  kind: clientKindSchema,
  name: z.string(),
  identifier: z.string().nullable(),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;

// --- Matters -------------------------------------------------------------------

const matterFields = {
  title: matterTitleSchema,
  area: matterAreaSchema,
  court: optional(singleLine(200)),
  courtCaseNumber: optional(singleLine(64)),
  description: optional(multiLine(4000)),
  openedOn: calendarDateSchema,
};

export const createMatterRequestSchema = z.strictObject({
  clientId: uuid,
  ...matterFields,
  openedOn: calendarDateSchema.optional(),
  restricted: z.boolean().default(false),
});
export type CreateMatterRequest = z.input<typeof createMatterRequestSchema>;

export const updateMatterRequestSchema = z
  .strictObject({
    title: matterFields.title.optional(),
    area: matterFields.area.optional(),
    court: matterFields.court,
    courtCaseNumber: matterFields.courtCaseNumber,
    description: matterFields.description,
    openedOn: matterFields.openedOn.optional(),
    status: matterStatusSchema.optional(),
    restricted: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });
export type UpdateMatterRequest = z.input<typeof updateMatterRequestSchema>;

export const personRefSchema = z.strictObject({ id: uuid, displayName: z.string() });

/** What the signed-in user may do with this matter. The server enforces the same rules. */
export const matterPermissionsSchema = z.strictObject({
  update: z.boolean(),
  manageTeam: z.boolean(),
  setRestricted: z.boolean(),
  writeParties: z.boolean(),
  updateClient: z.boolean(),
  /** A lawyer member may take over the lead when the lead can no longer act. */
  claimLead: z.boolean(),
  /** Upload documents, add versions, rename. */
  writeDocuments: z.boolean(),
  /** Hide (delete) documents. Lawyers on the team only. */
  deleteDocuments: z.boolean(),
  /** Add and edit hearings, deadlines and tasks. */
  writeCalendar: z.boolean(),
  /** Delete deadlines and tasks. Lawyers on the team only. */
  deleteTasks: z.boolean(),
  /** See fee agreements, invoices and payments. The team only (not break-glass access). */
  readBilling: z.boolean(),
  /** Prepare and edit draft invoices and credit notes. */
  draftInvoices: z.boolean(),
  /** Issue invoices and credit notes, record payments, manage fee agreements. Lawyers on the team only. */
  manageBilling: z.boolean(),
  /** See who read or changed what on the matter (audit history). The lead lawyer only. */
  readHistory: z.boolean(),
});
export type MatterPermissions = z.infer<typeof matterPermissionsSchema>;

export const matterSummarySchema = z.strictObject({
  id: uuid,
  reference: z.string(),
  title: z.string(),
  area: matterAreaSchema,
  status: matterStatusSchema,
  restricted: z.boolean(),
  openedOn: calendarDateSchema,
  client: clientSummarySchema,
  lead: personRefSchema.nullable(),
  /** The signed-in user's place in the team, or null (break-glass access). */
  myRole: memberRoleSchema.nullable(),
  /** Set while an administrator's emergency access to this matter lasts. */
  breakGlassUntil: z.iso.datetime().nullable(),
});
export type MatterSummary = z.infer<typeof matterSummarySchema>;

export const matterMemberSchema = z.strictObject({
  userId: uuid,
  displayName: z.string(),
  role: roleSchema,
  memberRole: memberRoleSchema,
  /** Disabled accounts stay listed (history) but can no longer act. */
  active: z.boolean(),
});
export type MatterMember = z.infer<typeof matterMemberSchema>;

export const partySchema = z.strictObject({
  id: uuid,
  kind: clientKindSchema,
  name: z.string(),
  role: partyRoleSchema,
  identifier: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Party = z.infer<typeof partySchema>;

export const matterDetailSchema = z.strictObject({
  ...matterSummarySchema.shape,
  court: z.string().nullable(),
  courtCaseNumber: z.string().nullable(),
  description: z.string().nullable(),
  closedOn: calendarDateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  members: z.array(matterMemberSchema),
  parties: z.array(partySchema),
  permissions: matterPermissionsSchema,
});
export type MatterDetail = z.infer<typeof matterDetailSchema>;

export const matterResponseSchema = z.strictObject({ matter: matterDetailSchema });

export const listQuerySchema = z.strictObject({
  q: singleLine(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const matterListQuerySchema = listQuerySchema.extend({
  status: matterStatusSchema.optional(),
});

export const LIST_PAGE_SIZE = 25;

export const matterListResponseSchema = z.strictObject({
  matters: z.array(matterSummarySchema),
  page: z.number().int(),
  hasMore: z.boolean(),
});

export const clientListItemSchema = z.strictObject({
  ...clientSummarySchema.shape,
  /** Matters of this client that the signed-in user can see. */
  matterCount: z.number().int(),
});
export type ClientListItem = z.infer<typeof clientListItemSchema>;

export const clientListResponseSchema = z.strictObject({
  clients: z.array(clientListItemSchema),
  page: z.number().int(),
  hasMore: z.boolean(),
});

export const clientDetailSchema = z.strictObject({
  ...clientSummarySchema.shape,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Only the matters the signed-in user can see. */
  matters: z.array(matterSummarySchema),
  permissions: z.strictObject({ update: z.boolean(), openMatter: z.boolean() }),
});
export type ClientDetail = z.infer<typeof clientDetailSchema>;

export const clientResponseSchema = z.strictObject({ client: clientDetailSchema });

// --- Team and parties ------------------------------------------------------------

export const addMemberRequestSchema = z.strictObject({ userId: uuid });
export const transferLeadRequestSchema = z.strictObject({ userId: uuid });

export const teamCandidatesResponseSchema = z.strictObject({
  users: z.array(z.strictObject({ id: uuid, displayName: z.string(), role: roleSchema })),
});

export const partyRequestSchema = z.strictObject({
  kind: clientKindSchema,
  name: personOrCompanyNameSchema,
  role: partyRoleSchema,
  identifier: optional(identifierSchema),
  notes: optional(multiLine(1000)),
});
export type PartyRequest = z.input<typeof partyRequestSchema>;

export const updatePartyRequestSchema = z
  .strictObject({
    kind: clientKindSchema.optional(),
    name: personOrCompanyNameSchema.optional(),
    role: partyRoleSchema.optional(),
    identifier: optional(identifierSchema),
    notes: optional(multiLine(1000)),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

// --- Conflict search -------------------------------------------------------------

export const conflictQuerySchema = z.strictObject({
  q: singleLine(100).pipe(z.string().min(3)),
});

/**
 * One match. For matters the user does not belong to, only what is needed to
 * recognise a conflict and whom to ask is returned; for restricted matters,
 * not even the reference.
 */
export const conflictHitSchema = z.strictObject({
  /** The stored name; null for a restricted matter the user does not belong to. */
  matchedName: z.string().nullable(),
  matchedAs: z.union([z.literal("client"), partyRoleSchema]),
  /** Null for a client that has no matter yet. */
  matter: z
    .strictObject({
      /** Only when the user may open the matter. */
      id: uuid.nullable(),
      reference: z.string().nullable(),
      status: matterStatusSchema.nullable(),
      restricted: z.boolean(),
    })
    .nullable(),
  /** Whom to ask: the lead lawyer, or the person who recorded the client. */
  contact: z.string().nullable(),
});
export type ConflictHit = z.infer<typeof conflictHitSchema>;

export const conflictResponseSchema = z.strictObject({
  hits: z.array(conflictHitSchema),
  /** True when there were more matches than returned: refine the search. */
  truncated: z.boolean(),
});

// --- Break-glass access ------------------------------------------------------------

export const BREAK_GLASS_MINUTES = 60;

export const breakGlassRequestSchema = z.strictObject({
  reference: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{4,6}$/),
  reason: multiLine(500).pipe(z.string().min(20)),
});

export const breakGlassGrantSchema = z.strictObject({
  id: uuid,
  matterId: uuid,
  reference: z.string(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type BreakGlassGrant = z.infer<typeof breakGlassGrantSchema>;

export const breakGlassGrantResponseSchema = z.strictObject({ grant: breakGlassGrantSchema });
export const breakGlassListResponseSchema = z.strictObject({
  grants: z.array(breakGlassGrantSchema),
});
