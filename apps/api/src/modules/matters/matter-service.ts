import {
  LIST_PAGE_SIZE,
  type ClientDetail,
  type ClientListItem,
  type MatterDetail,
  type MatterSummary,
  type createClientRequestSchema,
  type createMatterRequestSchema,
  type partyRequestSchema,
  type updateClientRequestSchema,
  type updateMatterRequestSchema,
  type updatePartyRequestSchema,
} from "@lexora/shared";
import { ZodError, type z } from "zod";
import type { MatterStatus, Prisma } from "../../generated/prisma/client.js";
import { conflict, forbidden, notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit, type AuditEventInput } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import type { RateLimiter } from "../auth/rate-limit.js";
import {
  activeGrantWhere,
  canBeMatterMember,
  canOnMatter,
  clientPermissions,
  matterAccess,
  matterPermissions,
  visibleClientsWhere,
  visibleMattersWhere,
  type Actor,
  type MatterAccess,
  type MatterAction,
  type MatterFacts,
} from "../policy/matter-policy.js";
import { searchConflicts } from "./conflict-search.js";
import { fromDbDate, officeToday, toDbDate } from "./office-date.js";
import { identifierKey, searchKey } from "./search-text.js";

type CreateClientInput = z.output<typeof createClientRequestSchema>;
type UpdateClientInput = z.output<typeof updateClientRequestSchema>;
type CreateMatterInput = z.output<typeof createMatterRequestSchema>;
type UpdateMatterInput = z.output<typeof updateMatterRequestSchema>;
type PartyInput = z.output<typeof partyRequestSchema>;
type UpdatePartyInput = z.output<typeof updatePartyRequestSchema>;

/** A validation error on one field, reported like any other invalid input. */
function fieldError(path: string, message: string): ZodError {
  return new ZodError([{ code: "custom", path: [path], message, input: undefined }]);
}

/** `contains` uses LIKE: wildcards typed by the user are matched literally as spaces. */
const likeText = (q: string): string => q.replace(/[%_\\]/g, " ").trim();

/** Only fields present in the request, with their search keys kept in step. */
function changedFields<T extends object>(changes: T): (keyof T & string)[] {
  return (Object.keys(changes) as (keyof T & string)[]).filter((k) => changes[k] !== undefined);
}

const clientSummarySelect = {
  id: true,
  kind: true,
  name: true,
  identifier: true,
} satisfies Prisma.ClientSelect;

/** What a matter summary needs: the lead and the actor's own membership only. */
function summarySelect(actor: Actor, now: Date) {
  return {
    id: true,
    reference: true,
    title: true,
    area: true,
    status: true,
    restricted: true,
    openedOn: true,
    client: { select: clientSummarySelect },
    members: {
      where: { OR: [{ role: "lead" as const }, { userId: actor.id }] },
      select: { userId: true, role: true, user: { select: { id: true, displayName: true } } },
    },
    breakGlassGrants: {
      where: activeGrantWhere(actor, now),
      select: { expiresAt: true },
      orderBy: { expiresAt: "desc" as const },
      take: 1,
    },
  } satisfies Prisma.MatterSelect;
}

interface SummaryRow {
  id: string;
  reference: string;
  title: string;
  area: MatterSummary["area"];
  status: MatterSummary["status"];
  restricted: boolean;
  openedOn: Date;
  client: MatterSummary["client"];
  members: { userId: string; role: "lead" | "member"; user: { id: string; displayName: string } }[];
  breakGlassGrants: { expiresAt: Date }[];
}

function toSummary(actor: Actor, row: SummaryRow): MatterSummary {
  const lead = row.members.find((m) => m.role === "lead");
  const mine = row.members.find((m) => m.userId === actor.id);
  const grant = actor.role === "admin" ? row.breakGlassGrants[0] : undefined;
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    area: row.area,
    status: row.status,
    restricted: row.restricted,
    openedOn: fromDbDate(row.openedOn),
    client: row.client,
    lead: lead ? { id: lead.user.id, displayName: lead.user.displayName } : null,
    myRole: actor.role === "admin" ? null : (mine?.role ?? null),
    breakGlassUntil: grant ? grant.expiresAt.toISOString() : null,
  };
}

/** Membership rows as loaded for an access decision. */
interface AccessRow {
  members: {
    userId: string;
    role: "lead" | "member";
    user: { role: Actor["role"]; disabledAt: Date | null };
  }[];
  breakGlassGrants: { expiresAt: Date }[];
}

/** The lead can still act when their account is active and they are still a lawyer. */
function leadCanAct(lead: { user: { role: Actor["role"]; disabledAt: Date | null } } | undefined) {
  return lead?.user.role === "lawyer" && lead.user.disabledAt === null;
}

function accessOf(
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

function accessSelect(actor: Actor, now: Date) {
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

export interface Page<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

/**
 * Clients, matters, matter teams and parties. Every method takes the acting
 * user and goes through the policy module: single records with
 * `authorizeMatter`/`authorizeClient`, lists with the `visible…Where` scopes.
 */
export class MatterService {
  constructor(
    private readonly db: Database,
    private readonly limiter: RateLimiter,
  ) {}

  /** Conflict-of-interest search (see conflict-search.ts for what each hit reveals). */
  searchConflicts(actor: Actor, q: string, ctx: RequestContext) {
    return searchConflicts(this.db, this.limiter, actor, q, ctx);
  }

  private audit(event: AuditEventInput, ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  /**
   * Loads a matter and checks `action`. A matter the actor cannot see is
   * "not found" (and the attempt is audited); a visible matter on which the
   * action is not allowed is "forbidden".
   */
  private async authorizeMatter(
    actor: Actor,
    matterId: string,
    action: MatterAction,
    ctx: RequestContext,
  ) {
    const now = new Date();
    const matter = await this.db.matter.findUnique({
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
      await this.audit(
        {
          action: "matter.access",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
        },
        ctx,
      );
      throw notFound();
    }
    if (!canOnMatter(actor, access, action, facts)) {
      await this.audit(
        {
          action: `matter.${action}`,
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
        },
        ctx,
      );
      throw forbidden();
    }
    return { matter, access, facts };
  }

  private async authorizeClient(
    actor: Actor,
    clientId: string,
    action: "read" | "update",
    ctx: RequestContext,
  ) {
    const now = new Date();
    const client = await this.db.client.findUnique({
      where: { id: clientId },
      select: { id: true, createdById: true, _count: { select: { matters: true } } },
    });
    if (!client) throw notFound();
    const matters = await this.db.matter.findMany({
      where: { AND: [{ clientId }, visibleMattersWhere(actor, now)] },
      orderBy: [{ openedOn: "desc" }, { reference: "desc" }],
      select: {
        ...summarySelect(actor, now),
        // Both the summary (names) and the access decision (roles, status) need these.
        members: {
          where: { OR: [{ role: "lead" as const }, { userId: actor.id }] },
          select: {
            userId: true,
            role: true,
            user: { select: { id: true, displayName: true, role: true, disabledAt: true } },
          },
        },
      },
    });
    const ownsUnattached =
      actor.role !== "admin" && client.createdById === actor.id && client._count.matters === 0;
    if (matters.length === 0 && !ownsUnattached) {
      await this.audit(
        {
          action: "client.access",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "client",
          targetId: clientId,
        },
        ctx,
      );
      throw notFound();
    }
    const rights = matters.map((m) => {
      const { access, facts } = accessOf(actor, m);
      return { access, permissions: matterPermissions(actor, access, facts) };
    });
    const permissions = clientPermissions(
      actor,
      rights.map((r) => r.permissions),
      ownsUnattached,
    );
    if (action === "update" && !permissions.update) {
      await this.audit(
        {
          action: "client.update",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "client",
          targetId: clientId,
        },
        ctx,
      );
      throw forbidden();
    }
    const breakGlassOnly =
      rights.length > 0 && rights.every((r) => r.access?.kind === "break_glass");
    return { matters, permissions, breakGlassOnly };
  }

  // --- Clients -------------------------------------------------------------------

  async listClients(actor: Actor, query: { q?: string | undefined; page: number }) {
    const now = new Date();
    const filters: Prisma.ClientWhereInput[] = [visibleClientsWhere(actor, now)];
    if (query.q) {
      const key = searchKey(query.q);
      const idKey = identifierKey(query.q);
      if (!key && !idKey) return { items: [], page: query.page, hasMore: false };
      filters.push({
        OR: [
          ...(key ? [{ searchName: { contains: likeText(key) } }] : []),
          ...(idKey.length >= 3 ? [{ searchIdentifier: { contains: likeText(idKey) } }] : []),
        ],
      });
    }
    const rows = await this.db.client.findMany({
      where: { AND: filters },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE + 1,
      select: {
        ...clientSummarySelect,
        _count: { select: { matters: { where: visibleMattersWhere(actor, now) } } },
      },
    });
    const items: ClientListItem[] = rows.slice(0, LIST_PAGE_SIZE).map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      identifier: row.identifier,
      matterCount: row._count.matters,
    }));
    return { items, page: query.page, hasMore: rows.length > LIST_PAGE_SIZE };
  }

  async getClient(actor: Actor, clientId: string, ctx: RequestContext): Promise<ClientDetail> {
    const { matters, permissions, breakGlassOnly } = await this.authorizeClient(
      actor,
      clientId,
      "read",
      ctx,
    );
    const client = await this.db.client.findUniqueOrThrow({ where: { id: clientId } });
    if (breakGlassOnly) {
      await this.audit(
        {
          action: "client.read",
          outcome: "success",
          actorUserId: actor.id,
          targetType: "client",
          targetId: clientId,
          metadata: { breakGlass: true },
        },
        ctx,
      );
    }
    return {
      id: client.id,
      kind: client.kind,
      name: client.name,
      identifier: client.identifier,
      email: client.email,
      phone: client.phone,
      address: client.address,
      notes: client.notes,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      matters: matters.map((m) => toSummary(actor, m)),
      permissions,
    };
  }

  async createClient(
    actor: Actor,
    input: CreateClientInput,
    ctx: RequestContext,
  ): Promise<ClientDetail> {
    const client = await this.db.client.create({
      data: {
        kind: input.kind,
        name: input.name,
        searchName: searchKey(input.name),
        identifier: input.identifier ?? null,
        searchIdentifier: input.identifier ? identifierKey(input.identifier) : null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await this.audit(
      {
        action: "client.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "client",
        targetId: client.id,
        metadata: { kind: input.kind },
      },
      ctx,
    );
    return this.getClient(actor, client.id, ctx);
  }

  async updateClient(
    actor: Actor,
    clientId: string,
    changes: UpdateClientInput,
    ctx: RequestContext,
  ): Promise<void> {
    await this.authorizeClient(actor, clientId, "update", ctx);
    await this.db.client.update({
      where: { id: clientId },
      data: {
        ...(changes.name === undefined
          ? {}
          : { name: changes.name, searchName: searchKey(changes.name) }),
        ...(changes.identifier === undefined
          ? {}
          : {
              identifier: changes.identifier,
              searchIdentifier: changes.identifier ? identifierKey(changes.identifier) : null,
            }),
        ...(changes.email === undefined ? {} : { email: changes.email }),
        ...(changes.phone === undefined ? {} : { phone: changes.phone }),
        ...(changes.address === undefined ? {} : { address: changes.address }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
      },
    });
    await this.audit(
      {
        action: "client.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "client",
        targetId: clientId,
        // Which fields changed, never their values.
        metadata: { fields: changedFields(changes) },
      },
      ctx,
    );
  }

  // --- Matters -------------------------------------------------------------------

  async listMatters(
    actor: Actor,
    query: { q?: string | undefined; status?: MatterStatus | undefined; page: number },
  ): Promise<Page<MatterSummary>> {
    const now = new Date();
    const filters: Prisma.MatterWhereInput[] = [visibleMattersWhere(actor, now)];
    if (query.status) filters.push({ status: query.status });
    if (query.q) {
      const text = likeText(query.q);
      const key = searchKey(query.q);
      if (!text) return { items: [], page: query.page, hasMore: false };
      filters.push({
        OR: [
          { title: { contains: text, mode: "insensitive" } },
          { reference: { contains: text } },
          { courtCaseNumber: { contains: text, mode: "insensitive" } },
          ...(key ? [{ client: { searchName: { contains: likeText(key) } } }] : []),
        ],
      });
    }
    const rows = await this.db.matter.findMany({
      where: { AND: filters },
      orderBy: [{ openedOn: "desc" }, { reference: "desc" }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE + 1,
      select: summarySelect(actor, now),
    });
    return {
      items: rows.slice(0, LIST_PAGE_SIZE).map((row) => toSummary(actor, row)),
      page: query.page,
      hasMore: rows.length > LIST_PAGE_SIZE,
    };
  }

  async getMatter(actor: Actor, matterId: string, ctx: RequestContext): Promise<MatterDetail> {
    const { access, facts } = await this.authorizeMatter(actor, matterId, "read", ctx);
    const now = new Date();
    const row = await this.db.matter.findUniqueOrThrow({
      where: { id: matterId },
      select: {
        ...summarySelect(actor, now),
        court: true,
        courtCaseNumber: true,
        description: true,
        closedOn: true,
        createdAt: true,
        updatedAt: true,
        members: {
          orderBy: [{ role: "asc" }, { addedAt: "asc" }],
          select: {
            userId: true,
            role: true,
            user: { select: { id: true, displayName: true, role: true, disabledAt: true } },
          },
        },
        parties: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (access.kind === "break_glass") {
      await this.audit(
        {
          action: "matter.read",
          outcome: "success",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
          metadata: { breakGlass: true, restricted: row.restricted },
        },
        ctx,
      );
    }
    return {
      ...toSummary(actor, row),
      court: row.court,
      courtCaseNumber: row.courtCaseNumber,
      description: row.description,
      closedOn: row.closedOn ? fromDbDate(row.closedOn) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      members: row.members.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        role: m.user.role,
        memberRole: m.role,
        active: m.user.disabledAt === null,
      })),
      parties: row.parties.map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        role: p.role,
        identifier: p.identifier,
        notes: p.notes,
      })),
      permissions: matterPermissions(actor, access, facts),
    };
  }

  /**
   * Opens a matter for a client the lawyer can see. The lawyer becomes its
   * lead. The reference comes from a per-year counter row updated in the same
   * transaction, so references are unique and have no gaps.
   */
  async createMatter(
    actor: Actor,
    input: CreateMatterInput,
    ctx: RequestContext,
  ): Promise<MatterDetail> {
    const now = new Date();
    const client = await this.db.client.findFirst({
      where: { AND: [{ id: input.clientId }, visibleClientsWhere(actor, now)] },
      select: { id: true },
    });
    if (!client) {
      await this.audit(
        {
          action: "client.access",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "client",
          targetId: input.clientId,
        },
        ctx,
      );
      throw notFound();
    }
    const today = officeToday(now);
    const openedOn = input.openedOn ?? today;
    if (openedOn > today) throw fieldError("openedOn", "in the future");
    const year = Number(today.slice(0, 4));

    const matter = await this.db.$transaction(async (tx) => {
      const [counter] = await tx.$queryRaw<{ last_value: number }[]>`
        INSERT INTO matter_counter (year, last_value) VALUES (${year}, 1)
        ON CONFLICT (year) DO UPDATE SET last_value = matter_counter.last_value + 1
        RETURNING last_value`;
      if (!counter) throw new Error("matter counter did not return a value");
      return tx.matter.create({
        data: {
          reference: `${year}-${String(counter.last_value).padStart(4, "0")}`,
          title: input.title,
          area: input.area,
          restricted: input.restricted,
          court: input.court ?? null,
          courtCaseNumber: input.courtCaseNumber ?? null,
          description: input.description ?? null,
          openedOn: toDbDate(openedOn),
          clientId: client.id,
          createdById: actor.id,
          members: { create: { userId: actor.id, role: "lead" } },
        },
        select: { id: true, reference: true },
      });
    });
    await this.audit(
      {
        action: "matter.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matter.id,
        metadata: { reference: matter.reference, area: input.area, restricted: input.restricted },
      },
      ctx,
    );
    return this.getMatter(actor, matter.id, ctx);
  }

  async updateMatter(
    actor: Actor,
    matterId: string,
    changes: UpdateMatterInput,
    ctx: RequestContext,
  ): Promise<void> {
    const { matter, access, facts } = await this.authorizeMatter(actor, matterId, "update", ctx);
    const restrictedChanges =
      changes.restricted !== undefined && changes.restricted !== matter.restricted;
    if (restrictedChanges && !canOnMatter(actor, access, "setRestricted", facts)) {
      await this.audit(
        {
          action: "matter.setRestricted",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
        },
        ctx,
      );
      throw forbidden();
    }

    const today = officeToday();
    const openedOn = changes.openedOn ?? fromDbDate(matter.openedOn);
    if (changes.openedOn !== undefined && changes.openedOn > today) {
      throw fieldError("openedOn", "in the future");
    }
    const status = changes.status ?? matter.status;
    let closedOn: string | null = null;
    if (status === "closed") {
      closedOn = matter.closedOn ? fromDbDate(matter.closedOn) : today;
      if (openedOn > closedOn) throw fieldError("openedOn", "after the closing date");
    }

    await this.db.matter.update({
      where: { id: matterId },
      data: {
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.area === undefined ? {} : { area: changes.area }),
        ...(changes.court === undefined ? {} : { court: changes.court }),
        ...(changes.courtCaseNumber === undefined
          ? {}
          : { courtCaseNumber: changes.courtCaseNumber }),
        ...(changes.description === undefined ? {} : { description: changes.description }),
        ...(changes.openedOn === undefined ? {} : { openedOn: toDbDate(changes.openedOn) }),
        ...(changes.restricted === undefined ? {} : { restricted: changes.restricted }),
        status,
        closedOn: closedOn === null ? null : toDbDate(closedOn),
      },
    });
    await this.audit(
      {
        action: "matter.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matterId,
        metadata: {
          fields: changedFields(changes),
          ...(status === matter.status ? {} : { status: { from: matter.status, to: status } }),
          ...(restrictedChanges ? { restricted: changes.restricted } : {}),
        },
      },
      ctx,
    );
  }

  // --- Team ----------------------------------------------------------------------

  /** Active lawyers and assistants who are not yet on the team. */
  async teamCandidates(actor: Actor, matterId: string, ctx: RequestContext) {
    await this.authorizeMatter(actor, matterId, "manageTeam", ctx);
    return this.db.user.findMany({
      where: {
        role: { in: ["lawyer", "assistant"] },
        disabledAt: null,
        memberships: { none: { matterId } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true, displayName: true, role: true },
    });
  }

  /** Serialises team changes on one matter. */
  private async lockMatter(tx: Prisma.TransactionClient, matterId: string): Promise<void> {
    // NO KEY UPDATE: serialises team changes without blocking inserts that
    // only reference the matter (parties, grants).
    await tx.$queryRaw`SELECT id FROM matter WHERE id = ${matterId}::uuid FOR NO KEY UPDATE`;
  }

  async addMember(actor: Actor, matterId: string, userId: string, ctx: RequestContext) {
    await this.authorizeMatter(actor, matterId, "manageTeam", ctx);
    await this.db.$transaction(async (tx) => {
      await this.lockMatter(tx, matterId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, disabledAt: true },
      });
      if (user?.disabledAt !== null || !canBeMatterMember(user.role)) throw notFound();
      const existing = await tx.matterMember.findUnique({
        where: { matterId_userId: { matterId, userId } },
      });
      if (existing) throw conflict("Already a member of this matter");
      await tx.matterMember.create({ data: { matterId, userId, role: "member" } });
    });
    await this.audit(
      {
        action: "matter.member.add",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matterId,
        metadata: { userId },
      },
      ctx,
    );
  }

  async removeMember(actor: Actor, matterId: string, userId: string, ctx: RequestContext) {
    await this.authorizeMatter(actor, matterId, "manageTeam", ctx);
    await this.db.$transaction(async (tx) => {
      await this.lockMatter(tx, matterId);
      const membership = await tx.matterMember.findUnique({
        where: { matterId_userId: { matterId, userId } },
      });
      if (!membership) throw notFound();
      if (membership.role === "lead") throw conflict("Hand the lead to someone else first");
      await tx.matterMember.delete({ where: { matterId_userId: { matterId, userId } } });
    });
    await this.audit(
      {
        action: "matter.member.remove",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matterId,
        metadata: { userId },
      },
      ctx,
    );
  }

  /**
   * Makes `userId` the lead. The lead may hand over to any active lawyer on the
   * team; a lawyer member may take the lead themselves when the current lead
   * can no longer act (account disabled or no longer a lawyer).
   */
  async transferLead(actor: Actor, matterId: string, userId: string, ctx: RequestContext) {
    const { access, facts } = await this.authorizeMatter(actor, matterId, "read", ctx);
    const manages = canOnMatter(actor, access, "manageTeam", facts);
    const claims = canOnMatter(actor, access, "claimLead", facts) && userId === actor.id;
    if (!manages && !claims) {
      await this.audit(
        {
          action: "matter.manageTeam",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
        },
        ctx,
      );
      throw forbidden();
    }

    const previousLead = await this.db.$transaction(async (tx) => {
      await this.lockMatter(tx, matterId);
      const members = await tx.matterMember.findMany({
        where: { matterId },
        select: { userId: true, role: true, user: { select: { role: true, disabledAt: true } } },
      });
      const lead = members.find((m) => m.role === "lead");
      const target = members.find((m) => m.userId === userId);
      if (!target) throw notFound();
      if (target.user.role !== "lawyer" || target.user.disabledAt !== null) {
        throw conflict("Only an active lawyer can lead a matter");
      }
      if (target.role === "lead") throw conflict("Already the lead");
      // Re-checked under the lock: the actor must still be entitled.
      if (manages ? lead?.userId !== actor.id : leadCanAct(lead)) {
        throw conflict("The team changed; reload and try again");
      }
      if (lead) {
        await tx.matterMember.update({
          where: { matterId_userId: { matterId, userId: lead.userId } },
          data: { role: "member" },
        });
      }
      await tx.matterMember.update({
        where: { matterId_userId: { matterId, userId } },
        data: { role: "lead" },
      });
      return lead?.userId ?? null;
    });
    await this.audit(
      {
        action: "matter.lead.transfer",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "matter",
        targetId: matterId,
        metadata: { from: previousLead, to: userId, claimed: !manages },
      },
      ctx,
    );
  }

  // --- Parties -------------------------------------------------------------------

  async addParty(actor: Actor, matterId: string, input: PartyInput, ctx: RequestContext) {
    await this.authorizeMatter(actor, matterId, "writeParties", ctx);
    const party = await this.db.party.create({
      data: {
        matterId,
        kind: input.kind,
        name: input.name,
        searchName: searchKey(input.name),
        role: input.role,
        identifier: input.identifier ?? null,
        searchIdentifier: input.identifier ? identifierKey(input.identifier) : null,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });
    await this.audit(
      {
        action: "party.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "party",
        targetId: party.id,
        metadata: { matterId, role: input.role },
      },
      ctx,
    );
    return party.id;
  }

  private async partyOf(matterId: string, partyId: string): Promise<void> {
    const party = await this.db.party.findFirst({
      where: { id: partyId, matterId },
      select: { id: true },
    });
    if (!party) throw notFound();
  }

  async updateParty(
    actor: Actor,
    matterId: string,
    partyId: string,
    changes: UpdatePartyInput,
    ctx: RequestContext,
  ) {
    await this.authorizeMatter(actor, matterId, "writeParties", ctx);
    await this.partyOf(matterId, partyId);
    await this.db.party.update({
      where: { id: partyId },
      data: {
        ...(changes.kind === undefined ? {} : { kind: changes.kind }),
        ...(changes.name === undefined
          ? {}
          : { name: changes.name, searchName: searchKey(changes.name) }),
        ...(changes.role === undefined ? {} : { role: changes.role }),
        ...(changes.identifier === undefined
          ? {}
          : {
              identifier: changes.identifier,
              searchIdentifier: changes.identifier ? identifierKey(changes.identifier) : null,
            }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
      },
    });
    await this.audit(
      {
        action: "party.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "party",
        targetId: partyId,
        metadata: { matterId, fields: changedFields(changes) },
      },
      ctx,
    );
  }

  async removeParty(actor: Actor, matterId: string, partyId: string, ctx: RequestContext) {
    await this.authorizeMatter(actor, matterId, "writeParties", ctx);
    await this.partyOf(matterId, partyId);
    await this.db.party.delete({ where: { id: partyId } });
    await this.audit(
      {
        action: "party.delete",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "party",
        targetId: partyId,
        metadata: { matterId },
      },
      ctx,
    );
  }
}
