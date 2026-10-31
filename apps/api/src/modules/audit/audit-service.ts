import {
  AUDIT_PAGE_SIZE,
  type AuditEvent,
  type AuditVerification,
  type MatterHistoryEvent,
  type auditQuerySchema,
} from "@lexora/shared";
import type { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import type { RequestContext } from "../auth/auth-service.js";
import { authorizeMatter } from "../matters/matter-access.js";
import { fromOfficeLocal, toOfficeLocalSeconds } from "../matters/office-date.js";
import type { Actor } from "../policy/matter-policy.js";
import { recordAudit, verifyAuditChain } from "./audit-log.js";

type AuditQuery = z.output<typeof auditQuerySchema>;

interface EventRow {
  id: bigint;
  occurredAt: Date;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditEvent["outcome"];
  requestId: string | null;
  ipAddress: string | null;
  metadata: Prisma.JsonValue;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only administrators read the audit log (the matter history is separate). */
export const canReadAuditLog = (actor: Actor): boolean => actor.role === "admin";

/**
 * The audit-log viewer for administrators, its integrity check, and each
 * matter's history for its lead lawyer. Reading the log is itself audited.
 */
export class AuditService {
  constructor(private readonly db: Database) {}

  private audit(event: Parameters<typeof recordAudit>[1], ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  /** Display names of the people who acted, in one query. */
  private async people(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    const users = await this.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async search(
    actor: Actor,
    query: AuditQuery,
    ctx: RequestContext,
  ): Promise<{ events: AuditEvent[]; nextBefore: string | null }> {
    if (!canReadAuditLog(actor)) throw forbidden();
    const where: Prisma.AuditEventWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.actorId ? { actorUserId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: fromOfficeLocal(`${query.from}T00:00`) } : {}),
              // Up to the end of the last day: before midnight of the next.
              ...(query.to ? { lt: nextDayStart(query.to) } : {}),
            },
          }
        : {}),
      ...(query.before ? { id: { lt: BigInt(query.before) } } : {}),
    };
    const rows: EventRow[] = await this.db.auditEvent.findMany({
      where,
      orderBy: { id: "desc" },
      take: AUDIT_PAGE_SIZE + 1,
      select: {
        id: true,
        occurredAt: true,
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        outcome: true,
        requestId: true,
        ipAddress: true,
        metadata: true,
      },
    });
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const people = await this.people(page.map((r) => r.actorUserId));
    // Searching the log is audited (which filters, never their values).
    await this.audit(
      {
        action: "audit.search",
        outcome: "success",
        actorUserId: actor.id,
        metadata: {
          filters: Object.keys(query).filter((k) => k !== "before"),
          page: Boolean(query.before),
        },
      },
      ctx,
    );
    return {
      events: page.map((r) => ({
        id: r.id.toString(),
        occurredAt: r.occurredAt.toISOString(),
        occurredAtOffice: toOfficeLocalSeconds(r.occurredAt),
        actor: r.actorUserId ? (people.get(r.actorUserId) ?? null) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        outcome: r.outcome,
        requestId: r.requestId,
        ipAddress: r.ipAddress,
        metadata: isRecord(r.metadata) ? r.metadata : null,
      })),
      nextBefore: rows.length > AUDIT_PAGE_SIZE ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }

  /** Recomputes the whole hash chain. The result is audited. */
  async verify(actor: Actor, ctx: RequestContext): Promise<AuditVerification> {
    if (!canReadAuditLog(actor)) throw forbidden();
    const result = await verifyAuditChain(this.db);
    await this.audit(
      {
        action: "audit.verify",
        outcome: result.valid ? "success" : "failure",
        actorUserId: actor.id,
        metadata: {
          checked: result.checked,
          ...(result.firstInvalidId === null
            ? {}
            : { firstInvalidId: result.firstInvalidId.toString() }),
        },
      },
      ctx,
    );
    return {
      valid: result.valid,
      checked: result.checked,
      firstInvalidId: result.firstInvalidId?.toString() ?? null,
      latestHash: result.latestHash,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Everything recorded about one matter, newest first: events that target
   * the matter, and events about its documents, hearings, tasks, parties,
   * invoices and payments (which carry its ID). For the lead lawyer only.
   * IP addresses and request IDs are left out.
   */
  async matterHistory(
    actor: Actor,
    matterId: string,
    before: string | undefined,
    ctx: RequestContext,
  ): Promise<{ events: MatterHistoryEvent[]; nextBefore: string | null }> {
    await authorizeMatter(this.db, actor, matterId, "readHistory", ctx);
    const cursor = before === undefined ? null : BigInt(before);
    const ids = await this.db.$queryRaw<{ id: bigint }[]>`
      SELECT "id" FROM "audit_event"
      WHERE (("target_type" = 'matter' AND "target_id" = ${matterId})
             OR ("metadata" ->> 'matterId') = ${matterId})
        AND (${cursor}::bigint IS NULL OR "id" < ${cursor}::bigint)
      ORDER BY "id" DESC
      LIMIT ${AUDIT_PAGE_SIZE + 1}`;
    const pageIds = ids.slice(0, AUDIT_PAGE_SIZE).map((r) => r.id);
    const rows = await this.db.auditEvent.findMany({
      where: { id: { in: pageIds } },
      orderBy: { id: "desc" },
      select: {
        id: true,
        occurredAt: true,
        actorUserId: true,
        action: true,
        targetType: true,
        outcome: true,
        metadata: true,
      },
    });
    const people = await this.people(rows.map((r) => r.actorUserId));
    await this.audit(
      {
        action: "matter.history",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matterId,
      },
      ctx,
    );
    return {
      events: rows.map((r) => {
        const metadata = isRecord(r.metadata) ? r.metadata : {};
        const fields = metadata["fields"];
        return {
          id: r.id.toString(),
          occurredAt: r.occurredAt.toISOString(),
          occurredAtOffice: toOfficeLocalSeconds(r.occurredAt),
          actor: r.actorUserId ? (people.get(r.actorUserId) ?? null) : null,
          action: r.action,
          outcome: r.outcome,
          targetType: r.targetType,
          fields:
            Array.isArray(fields) && fields.every((f) => typeof f === "string") ? fields : null,
          breakGlass: metadata["breakGlass"] === true || r.action === "matter.break_glass",
        };
      }),
      nextBefore: ids.length > AUDIT_PAGE_SIZE ? (pageIds.at(-1)?.toString() ?? null) : null,
    };
  }
}

/** The instant the office day after `date` begins. */
function nextDayStart(date: string): Date {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return fromOfficeLocal(`${next.toISOString().slice(0, 10)}T00:00`);
}
