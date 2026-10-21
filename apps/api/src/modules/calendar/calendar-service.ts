import type {
  AgendaResponse,
  Hearing,
  MatterTask,
  createHearingRequestSchema,
  createTaskRequestSchema,
  updateHearingRequestSchema,
  updateTaskRequestSchema,
} from "@lexora/shared";
import { ZodError, type z } from "zod";
import type { HearingStatus, Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit, type AuditEventInput } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import { authorizeMatter } from "../matters/matter-access.js";
import { fromDbDate, fromOfficeLocal, toDbDate, toOfficeLocal } from "../matters/office-date.js";
import { visibleMattersWhere, type Actor } from "../policy/matter-policy.js";

type CreateHearing = z.output<typeof createHearingRequestSchema>;
type UpdateHearing = z.output<typeof updateHearingRequestSchema>;
type CreateTask = z.output<typeof createTaskRequestSchema>;
type UpdateTask = z.output<typeof updateTaskRequestSchema>;

function fieldError(path: string, message: string): ZodError {
  return new ZodError([{ code: "custom", path: [path], message, input: undefined }]);
}

const changedFields = (changes: object) =>
  Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k);

interface HearingRow {
  id: string;
  matterId: string;
  startsAt: Date;
  title: string;
  court: string | null;
  room: string | null;
  notes: string | null;
  status: HearingStatus;
  outcome: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toHearing(row: HearingRow): Hearing {
  return {
    id: row.id,
    matterId: row.matterId,
    startsAt: row.startsAt.toISOString(),
    startsAtLocal: toOfficeLocal(row.startsAt),
    title: row.title,
    court: row.court,
    room: row.room,
    notes: row.notes,
    status: row.status,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const person = { select: { id: true, displayName: true } } as const;
const taskSelect = {
  id: true,
  matterId: true,
  kind: true,
  title: true,
  dueOn: true,
  notes: true,
  completedAt: true,
  createdAt: true,
  assignee: person,
  completedBy: person,
} satisfies Prisma.MatterTaskSelect;

type TaskRow = Prisma.MatterTaskGetPayload<{ select: typeof taskSelect }>;

function toTask(row: TaskRow): MatterTask {
  return {
    id: row.id,
    matterId: row.matterId,
    kind: row.kind,
    title: row.title,
    dueOn: row.dueOn ? fromDbDate(row.dueOn) : null,
    notes: row.notes,
    assignee: row.assignee,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

const matterRef = { select: { id: true, reference: true, title: true } } as const;

/**
 * Hearings, deadlines and tasks of a matter, and each person's agenda.
 * Access follows the matter (policy module): team members add and edit;
 * lawyers on the team delete deadlines and tasks; hearings are never
 * deleted (they are cancelled). Break-glass access is read-only.
 */
export class CalendarService {
  constructor(private readonly db: Database) {}

  private audit(event: AuditEventInput, ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  // --- Hearings -------------------------------------------------------------------

  async listHearings(actor: Actor, matterId: string, ctx: RequestContext): Promise<Hearing[]> {
    await authorizeMatter(this.db, actor, matterId, "read", ctx);
    const rows = await this.db.hearing.findMany({
      where: { matterId },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toHearing);
  }

  async createHearing(
    actor: Actor,
    matterId: string,
    input: CreateHearing,
    ctx: RequestContext,
  ): Promise<Hearing> {
    await authorizeMatter(this.db, actor, matterId, "writeCalendar", ctx);
    const row = await this.db.hearing.create({
      data: {
        matterId,
        startsAt: fromOfficeLocal(input.startsAt),
        title: input.title,
        court: input.court ?? null,
        room: input.room ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    await this.audit(
      {
        action: "hearing.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "hearing",
        targetId: row.id,
        metadata: { matterId },
      },
      ctx,
    );
    return toHearing(row);
  }

  async updateHearing(
    actor: Actor,
    matterId: string,
    hearingId: string,
    changes: UpdateHearing,
    ctx: RequestContext,
  ): Promise<Hearing> {
    await authorizeMatter(this.db, actor, matterId, "writeCalendar", ctx);
    const current = await this.db.hearing.findFirst({ where: { id: hearingId, matterId } });
    if (!current) throw notFound();
    const status = changes.status ?? current.status;
    const outcome = changes.outcome === undefined ? current.outcome : changes.outcome;
    if (outcome !== null && status === "scheduled") {
      throw fieldError("outcome", "only after the hearing");
    }
    const row = await this.db.hearing.update({
      where: { id: hearingId },
      data: {
        ...(changes.startsAt === undefined ? {} : { startsAt: fromOfficeLocal(changes.startsAt) }),
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.court === undefined ? {} : { court: changes.court }),
        ...(changes.room === undefined ? {} : { room: changes.room }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.outcome === undefined ? {} : { outcome: changes.outcome }),
      },
    });
    await this.audit(
      {
        action: "hearing.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "hearing",
        targetId: hearingId,
        metadata: {
          matterId,
          fields: changedFields(changes),
          ...(status === current.status ? {} : { status: { from: current.status, to: status } }),
        },
      },
      ctx,
    );
    return toHearing(row);
  }

  // --- Deadlines and tasks -----------------------------------------------------------

  /** The assignee must be an active lawyer or assistant on the matter's team. */
  private async checkAssignee(matterId: string, assigneeId: string): Promise<void> {
    const member = await this.db.matterMember.findUnique({
      where: { matterId_userId: { matterId, userId: assigneeId } },
      select: { user: { select: { role: true, disabledAt: true } } },
    });
    const usable =
      member !== null &&
      member.user.disabledAt === null &&
      (member.user.role === "lawyer" || member.user.role === "assistant");
    if (!usable) throw fieldError("assigneeId", "not an active member of the team");
  }

  /** Tells the person a task was given to (in-app). Each assignment notifies once. */
  private async notifyAssigned(task: TaskRow, actor: Actor): Promise<void> {
    if (!task.assignee || task.assignee.id === actor.id) return;
    await this.db.notification.createMany({
      data: [
        {
          userId: task.assignee.id,
          matterId: task.matterId,
          kind: "task_assigned",
          subjectId: task.id,
          stage: "assigned",
          dueAt: task.dueOn ?? task.createdAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async listTasks(actor: Actor, matterId: string, ctx: RequestContext): Promise<MatterTask[]> {
    await authorizeMatter(this.db, actor, matterId, "read", ctx);
    const rows = await this.db.matterTask.findMany({
      where: { matterId },
      // Open first, then by date (undated last), then oldest first.
      orderBy: [
        { completedAt: { sort: "asc", nulls: "first" } },
        { dueOn: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      select: taskSelect,
    });
    return rows.map(toTask);
  }

  async createTask(
    actor: Actor,
    matterId: string,
    input: CreateTask,
    ctx: RequestContext,
  ): Promise<MatterTask> {
    await authorizeMatter(this.db, actor, matterId, "writeCalendar", ctx);
    if (input.assigneeId) await this.checkAssignee(matterId, input.assigneeId);
    const row = await this.db.matterTask.create({
      data: {
        matterId,
        kind: input.kind,
        title: input.title,
        dueOn: input.dueOn ? toDbDate(input.dueOn) : null,
        notes: input.notes ?? null,
        assigneeId: input.assigneeId ?? null,
        createdById: actor.id,
      },
      select: taskSelect,
    });
    await this.notifyAssigned(row, actor);
    await this.audit(
      {
        action: "task.create",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "task",
        targetId: row.id,
        metadata: { matterId, kind: input.kind },
      },
      ctx,
    );
    return toTask(row);
  }

  async updateTask(
    actor: Actor,
    matterId: string,
    taskId: string,
    changes: UpdateTask,
    ctx: RequestContext,
  ): Promise<MatterTask> {
    await authorizeMatter(this.db, actor, matterId, "writeCalendar", ctx);
    const current = await this.db.matterTask.findFirst({
      where: { id: taskId, matterId },
      select: { kind: true, dueOn: true, assigneeId: true, completedAt: true },
    });
    if (!current) throw notFound();
    if (current.kind === "deadline" && changes.dueOn === null) {
      throw fieldError("dueOn", "a deadline needs a date");
    }
    if (changes.assigneeId) await this.checkAssignee(matterId, changes.assigneeId);

    const completing = changes.completed === true && current.completedAt === null;
    const reopening = changes.completed === false && current.completedAt !== null;
    const row = await this.db.matterTask.update({
      where: { id: taskId },
      data: {
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.dueOn === undefined
          ? {}
          : { dueOn: changes.dueOn === null ? null : toDbDate(changes.dueOn) }),
        ...(changes.notes === undefined ? {} : { notes: changes.notes }),
        ...(changes.assigneeId === undefined ? {} : { assigneeId: changes.assigneeId }),
        ...(completing ? { completedAt: new Date(), completedById: actor.id } : {}),
        ...(reopening ? { completedAt: null, completedById: null } : {}),
      },
      select: taskSelect,
    });
    if (changes.assigneeId && changes.assigneeId !== current.assigneeId) {
      await this.notifyAssigned(row, actor);
    }
    await this.audit(
      {
        action: completing ? "task.complete" : reopening ? "task.reopen" : "task.update",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "task",
        targetId: taskId,
        metadata: { matterId, fields: changedFields(changes) },
      },
      ctx,
    );
    return toTask(row);
  }

  async deleteTask(
    actor: Actor,
    matterId: string,
    taskId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await authorizeMatter(this.db, actor, matterId, "deleteTasks", ctx);
    const task = await this.db.matterTask.findFirst({
      where: { id: taskId, matterId },
      select: { id: true, kind: true },
    });
    if (!task) throw notFound();
    await this.db.$transaction([
      this.db.notification.deleteMany({ where: { subjectId: taskId } }),
      this.db.matterTask.delete({ where: { id: taskId } }),
    ]);
    await this.audit(
      {
        action: "task.delete",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "task",
        targetId: taskId,
        metadata: { matterId, kind: task.kind },
      },
      ctx,
    );
  }

  // --- Agenda ---------------------------------------------------------------------

  /**
   * Hearings (not cancelled) and open deadlines and tasks between two office
   * days, plus anything open and overdue, across the matters the actor can see.
   */
  async agenda(actor: Actor, from: string, to: string): Promise<AgendaResponse> {
    const now = new Date();
    const visible = visibleMattersWhere(actor, now);
    const start = fromOfficeLocal(`${from}T00:00`);
    const end = fromOfficeLocal(`${to}T23:59`);
    const [hearings, tasks, overdue] = await Promise.all([
      this.db.hearing.findMany({
        where: {
          matter: visible,
          status: { not: "cancelled" },
          startsAt: { gte: start, lte: end },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        include: { matter: matterRef },
      }),
      this.db.matterTask.findMany({
        where: {
          matter: visible,
          completedAt: null,
          dueOn: { gte: toDbDate(from), lte: toDbDate(to) },
        },
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        select: { ...taskSelect, matter: matterRef },
      }),
      this.db.matterTask.findMany({
        where: { matter: visible, completedAt: null, dueOn: { lt: toDbDate(from) } },
        orderBy: [{ dueOn: "asc" }, { id: "asc" }],
        take: 100,
        select: { ...taskSelect, matter: matterRef },
      }),
    ]);
    return {
      hearings: hearings.map((h) => ({ ...toHearing(h), matter: h.matter })),
      tasks: tasks.map((t) => ({ ...toTask(t), matter: t.matter })),
      overdue: overdue.map((t) => ({ ...toTask(t), matter: t.matter })),
    };
  }
}
