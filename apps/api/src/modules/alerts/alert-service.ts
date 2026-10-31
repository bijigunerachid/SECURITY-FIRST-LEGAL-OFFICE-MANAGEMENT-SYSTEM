import { LIST_PAGE_SIZE, type AlertKind, type AlertView, type SecurityAlert } from "@lexora/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict, forbidden, notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit, verifyAuditChain } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import { toOfficeLocalSeconds } from "../matters/office-date.js";
import type { Actor } from "../policy/matter-policy.js";

/**
 * Security alerts for administrators (in the app only: decision D12, no
 * e-mail service). The worker derives them from the audit log; nothing
 * else writes alerts, so an alert always points at recorded events.
 */

/** Window and thresholds for the repeated-failure rules. */
export const ALERT_RULES = {
  windowMs: 15 * 60_000,
  /** Failed sign-in, code or password checks for one account (half the lockout limit). */
  accountFailures: 5,
  /** Failed or refused sign-ins from one IP address. */
  ipFailures: 10,
  /** Refused access to records by one person (probing for other matters). */
  deniedAccess: 10,
  /** Event-based alerts look back this far, so a stopped worker catches up. */
  lookbackMs: 24 * 60 * 60_000,
  /** A backup is overdue after this long without a successful one. */
  backupMaxAgeMs: 26 * 60 * 60_000,
} as const;

const SEVERITY: Record<AlertKind, "high" | "critical"> = {
  login_failures_account: "high",
  login_failures_ip: "high",
  access_denied: "high",
  break_glass: "high",
  audit_chain: "critical",
  backup_failed: "critical",
  backup_overdue: "high",
};

interface Candidate {
  kind: AlertKind;
  subject: string;
  userId: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const person = { select: { id: true, displayName: true } } as const;
const alertSelect = {
  id: true,
  kind: true,
  severity: true,
  subject: true,
  user: person,
  count: true,
  firstSeenAt: true,
  lastSeenAt: true,
  status: true,
  acknowledgedBy: person,
  acknowledgedAt: true,
  resolvedBy: person,
  resolvedAt: true,
  resolutionNote: true,
  createdAt: true,
} satisfies Prisma.SecurityAlertSelect;

type AlertRow = Prisma.SecurityAlertGetPayload<{ select: typeof alertSelect }>;

function toAlert(row: AlertRow): SecurityAlert {
  return {
    ...row,
    firstSeenAt: row.firstSeenAt.toISOString(),
    firstSeenAtOffice: toOfficeLocalSeconds(row.firstSeenAt),
    lastSeenAtOffice: toOfficeLocalSeconds(row.lastSeenAt),
    lastSeenAt: row.lastSeenAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const canManageAlerts = (actor: Actor): boolean => actor.role === "admin";

export class AlertService {
  constructor(private readonly db: Database) {}

  // --- Detection (worker) ---------------------------------------------------------------

  /**
   * Repeated failures counted per account, IP or person within the window.
   * After an alert for the same subject was resolved, only later events
   * count, so a resolved burst is not raised again.
   */
  private async repeated(now: Date): Promise<Candidate[]> {
    const since = new Date(now.getTime() - ALERT_RULES.windowMs);
    interface Row {
      subject: string;
      count: number;
      first: Date;
      last: Date;
    }
    const [accounts, ips, denied] = await Promise.all([
      this.db.$queryRaw<Row[]>`
        SELECT "actor_user_id"::text AS subject, count(*)::int AS count,
               min("occurred_at") AS first, max("occurred_at") AS last
        FROM "audit_event"
        WHERE "occurred_at" > ${since} AND "outcome" = 'failure' AND "actor_user_id" IS NOT NULL
          AND "action" IN ('auth.login', 'auth.mfa.verify', 'auth.reauth')
        GROUP BY "actor_user_id"`,
      this.db.$queryRaw<Row[]>`
        SELECT "ip_address" AS subject, count(*)::int AS count,
               min("occurred_at") AS first, max("occurred_at") AS last
        FROM "audit_event"
        WHERE "occurred_at" > ${since} AND "outcome" IN ('failure', 'denied')
          AND "action" = 'auth.login' AND "ip_address" IS NOT NULL
        GROUP BY "ip_address"`,
      // Refused access to records; refused uploads (wrong file type) are not probing.
      this.db.$queryRaw<Row[]>`
        SELECT "actor_user_id"::text AS subject, count(*)::int AS count,
               min("occurred_at") AS first, max("occurred_at") AS last
        FROM "audit_event"
        WHERE "occurred_at" > ${since} AND "outcome" = 'denied' AND "actor_user_id" IS NOT NULL
          AND "action" NOT LIKE 'auth.%' AND "action" <> 'document.rejected'
        GROUP BY "actor_user_id"`,
    ]);
    const rules: [AlertKind, Row[], number, boolean][] = [
      ["login_failures_account", accounts, ALERT_RULES.accountFailures, true],
      ["login_failures_ip", ips, ALERT_RULES.ipFailures, false],
      ["access_denied", denied, ALERT_RULES.deniedAccess, true],
    ];
    const candidates: Candidate[] = [];
    for (const [kind, rows, threshold, isUser] of rules) {
      for (const row of rows) {
        if (row.count < threshold) continue;
        const resolved = await this.db.securityAlert.findFirst({
          where: { kind, subject: row.subject, status: "resolved", resolvedAt: { gt: since } },
          orderBy: { resolvedAt: "desc" },
          select: { resolvedAt: true },
        });
        let { count, first } = row;
        if (resolved?.resolvedAt) {
          const after = resolved.resolvedAt;
          const recount = await this.countAfter(kind, row.subject, after);
          if (recount.count < threshold) continue;
          ({ count, first } = recount);
        }
        candidates.push({
          kind,
          subject: row.subject,
          userId: isUser ? row.subject : null,
          count,
          firstSeenAt: first,
          lastSeenAt: row.last,
        });
      }
    }
    return candidates;
  }

  private async countAfter(kind: AlertKind, subject: string, after: Date) {
    const where: Prisma.AuditEventWhereInput =
      kind === "login_failures_ip"
        ? { action: "auth.login", outcome: { in: ["failure", "denied"] }, ipAddress: subject }
        : kind === "login_failures_account"
          ? {
              action: { in: ["auth.login", "auth.mfa.verify", "auth.reauth"] },
              outcome: "failure",
              actorUserId: subject,
            }
          : {
              outcome: "denied",
              actorUserId: subject,
              NOT: [{ action: { startsWith: "auth." } }, { action: "document.rejected" }],
            };
    const agg = await this.db.auditEvent.aggregate({
      where: { ...where, occurredAt: { gt: after } },
      _count: { _all: true },
      _min: { occurredAt: true },
    });
    return { count: agg._count._all, first: agg._min.occurredAt ?? after };
  }

  /** One alert per break-glass grant and per failed backup report. */
  private async events(now: Date): Promise<Candidate[]> {
    const since = new Date(now.getTime() - ALERT_RULES.lookbackMs);
    const rows = await this.db.auditEvent.findMany({
      where: {
        occurredAt: { gt: since },
        OR: [
          { action: "matter.break_glass", outcome: "success" },
          { action: "backup.run", outcome: "failure" },
        ],
      },
      select: { id: true, action: true, actorUserId: true, occurredAt: true },
    });
    return rows.map((r) => ({
      kind: r.action === "backup.run" ? "backup_failed" : "break_glass",
      subject: r.id.toString(),
      userId: r.action === "backup.run" ? null : r.actorUserId,
      count: 1,
      firstSeenAt: r.occurredAt,
      lastSeenAt: r.occurredAt,
    }));
  }

  /**
   * The last successful backup is too old. Only once one has succeeded
   * (backups arrive in Phase 9); failures raise their own alerts.
   */
  private async backupOverdue(now: Date): Promise<Candidate[]> {
    const lastSuccess = await this.db.auditEvent.findFirst({
      where: { action: "backup.run", outcome: "success" },
      orderBy: { id: "desc" },
      select: { occurredAt: true },
    });
    if (!lastSuccess) return [];
    if (now.getTime() - lastSuccess.occurredAt.getTime() <= ALERT_RULES.backupMaxAgeMs) return [];
    return [
      {
        kind: "backup_overdue",
        subject: "backup",
        userId: null,
        count: 1,
        firstSeenAt: lastSuccess.occurredAt,
        lastSeenAt: now,
      },
    ];
  }

  /** Raises a new alert, or updates the unresolved one for the same kind and subject. */
  private async raise(candidate: Candidate): Promise<boolean> {
    const existing = await this.db.securityAlert.findFirst({
      where: { kind: candidate.kind, subject: candidate.subject, status: { not: "resolved" } },
      select: { id: true, count: true, lastSeenAt: true },
    });
    if (existing) {
      if (candidate.count > existing.count || candidate.lastSeenAt > existing.lastSeenAt) {
        await this.db.securityAlert.update({
          where: { id: existing.id },
          data: {
            count: Math.max(existing.count, candidate.count),
            lastSeenAt:
              candidate.lastSeenAt > existing.lastSeenAt
                ? candidate.lastSeenAt
                : existing.lastSeenAt,
          },
        });
      }
      return false;
    }
    try {
      const alert = await this.db.securityAlert.create({
        data: { ...candidate, severity: SEVERITY[candidate.kind] },
        select: { id: true },
      });
      await recordAudit(this.db, {
        action: "alert.raise",
        outcome: "success",
        targetType: "security_alert",
        targetId: alert.id,
        metadata: { kind: candidate.kind, count: candidate.count },
      });
      return true;
    } catch (error) {
      // Already raised for this event (and resolved), or raised by another worker meanwhile.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /** The worker's 5-minute scan. Returns how many new alerts were raised. */
  async scan(now: Date = new Date()): Promise<number> {
    const candidates = [
      ...(await this.repeated(now)),
      ...(await this.events(now)),
      ...(await this.backupOverdue(now)),
    ];
    let raised = 0;
    for (const candidate of candidates) {
      if (await this.raise(candidate)) raised += 1;
    }
    return raised;
  }

  /** The worker's daily check of the audit hash chain. */
  async verifyChain(): Promise<string> {
    const result = await verifyAuditChain(this.db);
    await recordAudit(this.db, {
      action: "audit.verify",
      outcome: result.valid ? "success" : "failure",
      metadata: {
        checked: result.checked,
        ...(result.firstInvalidId === null
          ? {}
          : { firstInvalidId: result.firstInvalidId.toString() }),
      },
    });
    if (!result.valid && result.firstInvalidId !== null) {
      const now = new Date();
      await this.raise({
        kind: "audit_chain",
        subject: result.firstInvalidId.toString(),
        userId: null,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      return `chain broken at event ${result.firstInvalidId.toString()}`;
    }
    return `${String(result.checked)} events verified`;
  }

  /**
   * Recorded by the backup job (Phase 9) through the admin CLI. A failure
   * raises an alert at the next scan; so does a long gap between successes.
   */
  async reportBackup(ok: boolean, detail: string | null): Promise<void> {
    await recordAudit(this.db, {
      action: "backup.run",
      outcome: ok ? "success" : "failure",
      metadata: detail ? { detail: detail.slice(0, 200) } : null,
    });
  }

  // --- Administrators -------------------------------------------------------------------

  async list(
    actor: Actor,
    query: { view: AlertView; page: number },
  ): Promise<{ items: SecurityAlert[]; page: number; hasMore: boolean }> {
    if (!canManageAlerts(actor)) throw forbidden();
    const rows = await this.db.securityAlert.findMany({
      where: query.view === "resolved" ? { status: "resolved" } : { status: { not: "resolved" } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE + 1,
      select: alertSelect,
    });
    return {
      items: rows.slice(0, LIST_PAGE_SIZE).map(toAlert),
      page: query.page,
      hasMore: rows.length > LIST_PAGE_SIZE,
    };
  }

  async unresolvedCount(actor: Actor): Promise<number> {
    if (!canManageAlerts(actor)) throw forbidden();
    return this.db.securityAlert.count({ where: { status: { not: "resolved" } } });
  }

  async acknowledge(actor: Actor, alertId: string, ctx: RequestContext): Promise<SecurityAlert> {
    if (!canManageAlerts(actor)) throw forbidden();
    const { count } = await this.db.securityAlert.updateMany({
      where: { id: alertId, status: "open" },
      data: { status: "acknowledged", acknowledgedById: actor.id, acknowledgedAt: new Date() },
    });
    return this.afterChange(actor, alertId, count, "alert.acknowledge", ctx);
  }

  async resolve(
    actor: Actor,
    alertId: string,
    note: string,
    ctx: RequestContext,
  ): Promise<SecurityAlert> {
    if (!canManageAlerts(actor)) throw forbidden();
    const now = new Date();
    const current = await this.db.securityAlert.findUnique({
      where: { id: alertId },
      select: { acknowledgedAt: true },
    });
    const { count } = await this.db.securityAlert.updateMany({
      where: { id: alertId, status: { not: "resolved" } },
      data: {
        status: "resolved",
        resolvedById: actor.id,
        resolvedAt: now,
        resolutionNote: note,
        // Resolving implies having seen it.
        ...(current?.acknowledgedAt ? {} : { acknowledgedById: actor.id, acknowledgedAt: now }),
      },
    });
    return this.afterChange(actor, alertId, count, "alert.resolve", ctx);
  }

  private async afterChange(
    actor: Actor,
    alertId: string,
    changed: number,
    action: string,
    ctx: RequestContext,
  ): Promise<SecurityAlert> {
    const row = await this.db.securityAlert.findUnique({
      where: { id: alertId },
      select: alertSelect,
    });
    if (!row) throw notFound();
    if (changed === 0) throw conflict("already handled");
    await recordAudit(this.db, {
      action,
      outcome: "success",
      actorUserId: actor.id,
      targetType: "security_alert",
      targetId: alertId,
      metadata: { kind: row.kind },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
    });
    return toAlert(row);
  }
}
