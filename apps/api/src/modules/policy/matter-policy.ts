import type { MemberRole, Prisma, Role } from "../../generated/prisma/client.js";

/**
 * The single place that decides who may do what with matters and clients
 * (ADR 0003, docs/security.md "Authorization").
 *
 * - Roles say what kind of action a user may take; matter membership says on
 *   which matters.
 * - Administrators never get access through membership, even if they were
 *   members before a role change. They only read a matter through an active
 *   break-glass grant (decision D2).
 * - Lists and searches must use the `visible…Where` helpers below, so they can
 *   only return records the same rules allow.
 *
 * Every function here is pure: services load the facts (membership, grant,
 * lead status) and ask. Callers turn "no access" into 404, never 403, so the
 * existence of a record is not revealed.
 */

export interface Actor {
  id: string;
  role: Role;
}

export type MatterAccess =
  { kind: "member"; memberRole: MemberRole } | { kind: "break_glass"; until: Date };

export type MatterAction =
  | "read"
  | "update"
  | "manageTeam"
  | "setRestricted"
  | "writeParties"
  | "updateClient"
  | "claimLead"
  | "writeDocuments"
  | "deleteDocuments"
  | "writeCalendar"
  | "deleteTasks"
  | "readBilling"
  | "draftInvoices"
  | "manageBilling"
  | "readHistory";

export const MATTER_ACTIONS: readonly MatterAction[] = [
  "read",
  "update",
  "manageTeam",
  "setRestricted",
  "writeParties",
  "updateClient",
  "claimLead",
  "writeDocuments",
  "deleteDocuments",
  "writeCalendar",
  "deleteTasks",
  "readBilling",
  "draftInvoices",
  "manageBilling",
  "readHistory",
];

/** How the actor reaches a matter, from their membership and any break-glass grant. */
export function matterAccess(
  actor: Actor,
  membership: MemberRole | null,
  breakGlassUntil: Date | null,
): MatterAccess | null {
  if (actor.role === "admin") {
    return breakGlassUntil ? { kind: "break_glass", until: breakGlassUntil } : null;
  }
  return membership ? { kind: "member", memberRole: membership } : null;
}

export interface MatterFacts {
  /** True when the current lead is an active lawyer who can still act. */
  leadCanAct: boolean;
}

export function canOnMatter(
  actor: Actor,
  access: MatterAccess | null,
  action: MatterAction,
  facts: MatterFacts,
): boolean {
  if (!access) return false;
  // Break-glass access is read-only, and never reaches the matter's money.
  if (access.kind === "break_glass") return action === "read";

  const lawyer = actor.role === "lawyer";
  const lead = access.memberRole === "lead";
  switch (action) {
    case "read":
    case "writeParties":
    case "updateClient":
    case "writeDocuments":
    case "writeCalendar":
    case "readBilling":
    case "draftInvoices":
      return true;
    case "update":
    case "deleteDocuments":
    case "deleteTasks":
    case "manageBilling":
      return lawyer;
    case "manageTeam":
    case "setRestricted":
    case "readHistory":
      // A lead who has been made an assistant loses these rights.
      return lawyer && lead;
    case "claimLead":
      return lawyer && !lead && !facts.leadCanAct;
  }
}

export function matterPermissions(actor: Actor, access: MatterAccess | null, facts: MatterFacts) {
  return {
    update: canOnMatter(actor, access, "update", facts),
    manageTeam: canOnMatter(actor, access, "manageTeam", facts),
    setRestricted: canOnMatter(actor, access, "setRestricted", facts),
    writeParties: canOnMatter(actor, access, "writeParties", facts),
    updateClient: canOnMatter(actor, access, "updateClient", facts),
    claimLead: canOnMatter(actor, access, "claimLead", facts),
    writeDocuments: canOnMatter(actor, access, "writeDocuments", facts),
    deleteDocuments: canOnMatter(actor, access, "deleteDocuments", facts),
    writeCalendar: canOnMatter(actor, access, "writeCalendar", facts),
    deleteTasks: canOnMatter(actor, access, "deleteTasks", facts),
    readBilling: canOnMatter(actor, access, "readBilling", facts),
    draftInvoices: canOnMatter(actor, access, "draftInvoices", facts),
    manageBilling: canOnMatter(actor, access, "manageBilling", facts),
    readHistory: canOnMatter(actor, access, "readHistory", facts),
  };
}

/** Office billing details and office-wide totals (no client or matter details). */
export const canManageBillingSettings = (actor: Actor): boolean => actor.role === "admin";
/** The invoice journal export covers the actor's own matters only. */
export const canExportInvoices = (actor: Actor): boolean => actor.role === "lawyer";

/** Only lawyers open files and run conflict searches. */
export const canCreateClientsAndMatters = (actor: Actor): boolean => actor.role === "lawyer";
export const canSearchConflicts = (actor: Actor): boolean => actor.role === "lawyer";
/** Who may be placed on a matter team. */
export const canBeMatterMember = (role: Role): boolean => role === "lawyer" || role === "assistant";

/** A break-glass grant of this actor that has neither expired nor been ended. */
export function activeGrantWhere(actor: Actor, now: Date) {
  return { userId: actor.id, expiresAt: { gt: now }, endedAt: null };
}

/** Matters the actor may see. Used by every list and search. */
export function visibleMattersWhere(actor: Actor, now: Date): Prisma.MatterWhereInput {
  if (actor.role === "admin") {
    return { breakGlassGrants: { some: activeGrantWhere(actor, now) } };
  }
  return { members: { some: { userId: actor.id } } };
}

/**
 * Matters whose billing the actor may see: the team's only. Break-glass
 * access never reaches fees, invoices or payments.
 */
export function billingMattersWhere(actor: Actor): Prisma.MatterWhereInput {
  if (actor.role === "admin") return { id: { in: [] } };
  return { members: { some: { userId: actor.id } } };
}

/**
 * Clients the actor may see: those with at least one visible matter, plus
 * clients the actor recorded that have no matter yet (so a matter can be
 * opened for them).
 */
export function visibleClientsWhere(actor: Actor, now: Date): Prisma.ClientWhereInput {
  const viaMatters: Prisma.ClientWhereInput = {
    matters: { some: visibleMattersWhere(actor, now) },
  };
  if (actor.role === "admin") return viaMatters;
  return { OR: [viaMatters, { createdById: actor.id, matters: { none: {} } }] };
}

/**
 * Client-level rights, from the actor's rights on the client's visible matters.
 * `ownsUnattached`: the actor recorded this client and it has no matter yet.
 */
export function clientPermissions(
  actor: Actor,
  matterRights: { updateClient: boolean }[],
  ownsUnattached: boolean,
) {
  const lawyer = canCreateClientsAndMatters(actor);
  return {
    update: (ownsUnattached && lawyer) || matterRights.some((m) => m.updateClient),
    openMatter: lawyer && (ownsUnattached || matterRights.length > 0),
  };
}
