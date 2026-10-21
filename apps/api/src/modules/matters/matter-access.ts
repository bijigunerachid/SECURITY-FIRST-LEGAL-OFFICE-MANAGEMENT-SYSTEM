import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import {
  activeGrantWhere,
  canOnMatter,
  matterAccess,
  type Actor,
  type MatterAccess,
  type MatterAction,
  type MatterFacts,
} from "../policy/matter-policy.js";

/**
 * Loading a matter and deciding the actor's access to it, shared by every
 * service that works inside a matter (matters, parties, documents).
 */

/** Membership rows as loaded for an access decision. */
export interface AccessRow {
  members: {
    userId: string;
    role: "lead" | "member";
    user: { role: Actor["role"]; disabledAt: Date | null };
  }[];
  breakGlassGrants: { expiresAt: Date }[];
}

/** The lead can still act when their account is active and they are still a lawyer. */
export function leadCanAct(
  lead: { user: { role: Actor["role"]; disabledAt: Date | null } } | undefined,
) {
  return lead?.user.role === "lawyer" && lead.user.disabledAt === null;
}

export function accessOf(
  actor: Actor,
  row: AccessRow,
): { access: MatterAccess | null; facts: MatterFacts } {
  const mine = row.members.find((m) => m.userId === actor.id);
  const lead = row.members.find((m) => m.role === "lead");
  return {
    access: matterAccess(actor, mine?.role ?? null, row.breakGlassGrants[0]?.expiresAt ?? null),
    facts: { leadCanAct: leadCanAct(lead) },
  };
}

export function accessSelect(actor: Actor, now: Date) {
  return {
    members: {
      where: { OR: [{ role: "lead" as const }, { userId: actor.id }] },
      select: { userId: true, role: true, user: { select: { role: true, disabledAt: true } } },
    },
    breakGlassGrants: {
      where: activeGrantWhere(actor, now),
      select: { expiresAt: true },
      orderBy: { expiresAt: "desc" as const },
      take: 1,
    },
  } satisfies Prisma.MatterSelect;
}

/**
 * Loads a matter and checks `action`. A matter the actor cannot see is
 * "not found" (and the attempt is audited); a visible matter on which the
 * action is not allowed is "forbidden".
 */
export async function authorizeMatter(
  db: Database,
  actor: Actor,
  matterId: string,
  action: MatterAction,
  ctx: RequestContext,
) {
  const now = new Date();
  const matter = await db.matter.findUnique({
    where: { id: matterId },
    select: {
      id: true,
      status: true,
      restricted: true,
      openedOn: true,
      closedOn: true,
      ...accessSelect(actor, now),
    },
  });
  if (!matter) throw notFound();
  const { access, facts } = accessOf(actor, matter);
  if (!access || !canOnMatter(actor, access, "read", facts)) {
    await recordAudit(db, {
      action: "matter.access",
      outcome: "denied",
      actorUserId: actor.id,
      targetType: "matter",
      targetId: matterId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    throw notFound();
  }
  if (!canOnMatter(actor, access, action, facts)) {
    await recordAudit(db, {
      action: `matter.${action}`,
      outcome: "denied",
      actorUserId: actor.id,
      targetType: "matter",
      targetId: matterId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    throw forbidden();
  }
  return { matter, access, facts };
}
