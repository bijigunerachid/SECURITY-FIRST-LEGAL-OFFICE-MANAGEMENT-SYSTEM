import type { Notification } from "@lexora/shared";
import { notFound } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { daysBetween, fromDbDate, officeToday, toOfficeLocal } from "../matters/office-date.js";
import { visibleMattersWhere, type Actor } from "../policy/matter-policy.js";

/** How many reminders a person sees at once (newest first). */
const LIST_LIMIT = 50;

/**
 * In-app reminders (decision D12: no e-mail or SMS service). Each person
 * only ever sees their own, and only for matters they can still see: a
 * reminder about a matter they have left is hidden.
 */
export class NotificationService {
  constructor(private readonly db: Database) {}

  async list(actor: Actor): Promise<{ notifications: Notification[]; unread: number }> {
    const where = { userId: actor.id, matter: visibleMattersWhere(actor, new Date()) };
    const [rows, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        take: LIST_LIMIT,
        include: { matter: { select: { id: true, reference: true, title: true } } },
      }),
      this.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    const subjects = await this.subjectTitles(rows.map((r) => r.subjectId));
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        stage: row.stage,
        dueAt: row.dueAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
        matter: row.matter,
        subject: subjects.get(row.subjectId) ?? "",
      })),
      unread,
    };
  }

  private async subjectTitles(ids: string[]): Promise<Map<string, string>> {
    const [hearings, tasks] = await Promise.all([
      this.db.hearing.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
      this.db.matterTask.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      }),
    ]);
    return new Map([...hearings, ...tasks].map((s) => [s.id, s.title]));
  }

  async markRead(actor: Actor, notificationId: string): Promise<void> {
    const { count } = await this.db.notification.updateMany({
      where: { id: notificationId, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.db.notification.findFirst({
        where: { id: notificationId, userId: actor.id },
        select: { id: true },
      });
      if (!exists) throw notFound();
    }
  }

  async markAllRead(actor: Actor): Promise<number> {
    const { count } = await this.db.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}

// --- Reminder generation (run by the worker) -------------------------------------------

interface Reminder {
  userId: string;
  matterId: string;
  kind: "hearing_soon" | "deadline_soon" | "deadline_overdue" | "task_due";
  subjectId: string;
  stage: string;
  dueAt: Date;
}

/** Active lawyers and assistants on each matter: the people reminders go to. */
async function teams(db: Database, matterIds: string[]): Promise<Map<string, string[]>> {
  const members = await db.matterMember.findMany({
    where: {
      matterId: { in: matterIds },
      user: { disabledAt: null, role: { in: ["lawyer", "assistant"] } },
    },
    select: { matterId: true, userId: true },
  });
  const byMatter = new Map<string, string[]>();
  for (const m of members)
    byMatter.set(m.matterId, [...(byMatter.get(m.matterId) ?? []), m.userId]);
  return byMatter;
}

/** Hearings: a week before and the day before (or on the day, if added late). */
function hearingStage(days: number): string | null {
  if (days < 0) return null;
  if (days <= 1) return "1d";
  if (days <= 7) return "7d";
  return null;
}

/** Deadlines: a week before, two days before, on the day, and once when overdue. */
function deadlineStage(days: number): { stage: string; overdue: boolean } | null {
  if (days < 0) return { stage: "overdue", overdue: true };
  if (days === 0) return { stage: "0d", overdue: false };
  if (days <= 2) return { stage: "2d", overdue: false };
  if (days <= 7) return { stage: "7d", overdue: false };
  return null;
}

/**
 * Creates the reminders that are due now. Only the current stage is created
 * (an item added the day before gets "tomorrow", not a late "in a week"),
 * and the unique (person, item, stage) key makes running twice harmless.
 * Administrators never receive reminders: they are not matter members.
 */
export async function generateReminders(db: Database, now: Date = new Date()): Promise<number> {
  const today = officeToday(now);
  const horizon = new Date(now.getTime() + 8 * 86_400_000);

  const [hearings, tasks] = await Promise.all([
    db.hearing.findMany({
      where: { status: "scheduled", startsAt: { gte: now, lte: horizon } },
      select: { id: true, matterId: true, startsAt: true },
    }),
    db.matterTask.findMany({
      where: {
        completedAt: null,
        dueOn: { not: null, lte: new Date(`${fromDbDate(horizon)}T00:00:00.000Z`) },
      },
      select: { id: true, matterId: true, kind: true, dueOn: true, assigneeId: true },
    }),
  ]);
  const team = await teams(db, [
    ...new Set([...hearings.map((h) => h.matterId), ...tasks.map((t) => t.matterId)]),
  ]);

  const reminders: Reminder[] = [];
  for (const hearing of hearings) {
    const stage = hearingStage(daysBetween(today, toOfficeLocal(hearing.startsAt).slice(0, 10)));
    if (!stage) continue;
    for (const userId of team.get(hearing.matterId) ?? []) {
      reminders.push({
        userId,
        matterId: hearing.matterId,
        kind: "hearing_soon",
        subjectId: hearing.id,
        stage,
        dueAt: hearing.startsAt,
      });
    }
  }
  for (const task of tasks) {
    if (!task.dueOn) continue;
    const days = daysBetween(today, fromDbDate(task.dueOn));
    const members = team.get(task.matterId) ?? [];
    if (task.kind === "deadline") {
      const step = deadlineStage(days);
      if (!step) continue;
      for (const userId of members) {
        reminders.push({
          userId,
          matterId: task.matterId,
          kind: step.overdue ? "deadline_overdue" : "deadline_soon",
          subjectId: task.id,
          stage: step.stage,
          dueAt: task.dueOn,
        });
      }
    } else if (days <= 0) {
      // A task reminds its assignee (if still on the team), otherwise the whole team.
      const recipients =
        task.assigneeId && members.includes(task.assigneeId) ? [task.assigneeId] : members;
      for (const userId of recipients) {
        reminders.push({
          userId,
          matterId: task.matterId,
          kind: "task_due",
          subjectId: task.id,
          stage: "due",
          dueAt: task.dueOn,
        });
      }
    }
  }
  if (reminders.length === 0) return 0;
  const { count } = await db.notification.createMany({ data: reminders, skipDuplicates: true });
  return count;
}
