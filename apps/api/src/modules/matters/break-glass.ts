import { BREAK_GLASS_MINUTES, type BreakGlassGrant } from "@lexora/shared";
import { notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import type { Actor } from "../policy/matter-policy.js";

/**
 * Break-glass access (decision D2): administrators cannot read matter
 * content, except in an emergency. They name the matter by its reference,
 * give a written reason and have just re-entered their password (checked by
 * the route). The grant is read-only, lasts BREAK_GLASS_MINUTES, can be ended
 * early, and the grant and every matter read under it are audited.
 *
 * The routes are for administrators only; the policy module ignores grants
 * held by anyone else.
 */
export class BreakGlassService {
  constructor(private readonly db: Database) {}

  private toGrant(row: {
    id: string;
    matterId: string;
    reason: string;
    createdAt: Date;
    expiresAt: Date;
    matter: { reference: string };
  }): BreakGlassGrant {
    return {
      id: row.id,
      matterId: row.matterId,
      reference: row.matter.reference,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async grant(
    actor: Actor,
    input: { reference: string; reason: string },
    ctx: RequestContext,
  ): Promise<BreakGlassGrant> {
    const matter = await this.db.matter.findUnique({
      where: { reference: input.reference },
      select: { id: true, restricted: true },
    });
    if (!matter) {
      await recordAudit(this.db, {
        action: "matter.break_glass",
        outcome: "failure",
        actorUserId: actor.id,
        metadata: { reason: "unknown_reference" },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
      });
      throw notFound();
    }
    const now = new Date();
    const grant = await this.db.breakGlassGrant.create({
      data: {
        userId: actor.id,
        matterId: matter.id,
        reason: input.reason,
        createdAt: now,
        expiresAt: new Date(now.getTime() + BREAK_GLASS_MINUTES * 60_000),
      },
      select: {
        id: true,
        matterId: true,
        reason: true,
        createdAt: true,
        expiresAt: true,
        matter: { select: { reference: true } },
      },
    });
    // High-priority event: alerts on it arrive with the audit viewer (Phase 8).
    await recordAudit(this.db, {
      action: "matter.break_glass",
      outcome: "success",
      actorUserId: actor.id,
      targetType: "matter",
      targetId: matter.id,
      metadata: {
        grantId: grant.id,
        minutes: BREAK_GLASS_MINUTES,
        restricted: matter.restricted,
        priority: "high",
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    return this.toGrant(grant);
  }

  /** The actor's grants that are still running. */
  async listActive(actor: Actor): Promise<BreakGlassGrant[]> {
    const rows = await this.db.breakGlassGrant.findMany({
      where: { userId: actor.id, expiresAt: { gt: new Date() }, endedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        matterId: true,
        reason: true,
        createdAt: true,
        expiresAt: true,
        matter: { select: { reference: true } },
      },
    });
    return rows.map((row) => this.toGrant(row));
  }

  async end(actor: Actor, grantId: string, ctx: RequestContext): Promise<void> {
    const { count } = await this.db.breakGlassGrant.updateMany({
      where: { id: grantId, userId: actor.id, endedAt: null, expiresAt: { gt: new Date() } },
      data: { endedAt: new Date() },
    });
    if (count === 0) throw notFound();
    await recordAudit(this.db, {
      action: "matter.break_glass.end",
      outcome: "success",
      actorUserId: actor.id,
      targetType: "break_glass_grant",
      targetId: grantId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
  }
}
