import {
  agendaResponseSchema,
  hearingResponseSchema,
  notificationListResponseSchema,
  taskResponseSchema,
} from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateReminders } from "../../modules/calendar/notifications.js";
import { fromOfficeLocal, officeToday } from "../../modules/matters/office-date.js";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addMember,
  auditActions,
  createClient,
  createMatter,
  person,
  type Person,
} from "../../test/matters.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await integrationContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

/** An office calendar day, `days` from today. */
const day = (days: number) => {
  const date = new Date(`${officeToday()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function team() {
  const lead = await person(ctx, "lawyer");
  const assistant = await person(ctx, "assistant");
  const client = await createClient(lead);
  const matter = await createMatter(lead, client.id);
  await addMember(lead, matter.id, assistant);
  return { lead, assistant, matter, base: `/api/matters/${matter.id}` };
}

async function hearing(who: Person, base: string, body: Record<string, unknown> = {}) {
  const res = await who.browser.send("post", `${base}/hearings`, {
    startsAt: `${day(3)}T09:30`,
    title: "Audience de plaidoirie",
    court: "Tribunal de première instance de Rabat",
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return hearingResponseSchema.parse(res.body).hearing;
}

async function task(who: Person, base: string, body: Record<string, unknown> = {}) {
  const res = await who.browser.send("post", `${base}/tasks`, {
    kind: "deadline",
    title: "Délai d'appel",
    dueOn: day(10),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return taskResponseSchema.parse(res.body).task;
}

describe("hearings", () => {
  it("stores office time as an instant and gives it back in office time", async () => {
    const { lead, base } = await team();
    // A settled past date: Morocco was on UTC+1 in November 2025.
    const created = await hearing(lead, base, { startsAt: "2025-11-03T09:30" });
    expect(created.startsAt).toBe("2025-11-03T08:30:00.000Z");
    expect(created.startsAtLocal).toBe("2025-11-03T09:30");
    expect(created.status).toBe("scheduled");
  });

  it("records the outcome once held, never while still scheduled", async () => {
    const { lead, base } = await team();
    const created = await hearing(lead, base);
    const path = `${base}/hearings/${created.id}`;
    const early = await lead.browser.send("patch", path, { outcome: "Renvoyée" });
    expect(early.status).toBe(400);
    expect(early.body.error.fields).toEqual([{ path: "outcome", issue: "custom" }]);
    const held = await lead.browser.send("patch", path, {
      status: "held",
      outcome: "Mise en délibéré au 15",
    });
    expect(held.status).toBe(200);
    expect(hearingResponseSchema.parse(held.body).hearing).toMatchObject({
      status: "held",
      outcome: "Mise en délibéré au 15",
    });
    expect((await auditActions(ctx)).find((e) => e.action === "hearing.update")?.metadata).toEqual({
      matterId: expect.any(String),
      fields: ["status", "outcome"],
      status: { from: "scheduled", to: "held" },
    });
  });

  it("refuses impossible dates, unknown fields and blank titles", async () => {
    const { lead, base } = await team();
    for (const body of [
      { startsAt: "2026-02-30T09:00", title: "x" },
      { startsAt: "2026-11-03 09:00", title: "x" },
      { startsAt: "2026-11-03T24:00", title: "x" },
      { startsAt: "2026-11-03T09:00", title: "  " },
      { startsAt: "2026-11-03T09:00", title: "x", matterId: "x" },
      { startsAt: "2026-11-03T09:00", title: "x", status: "held" },
    ]) {
      expect((await lead.browser.send("post", `${base}/hearings`, body)).status).toBe(400);
    }
  });
});

describe("deadlines and tasks", () => {
  it("requires a date for a deadline, not for a task", async () => {
    const { lead, base } = await team();
    const noDate = await lead.browser.send("post", `${base}/tasks`, {
      kind: "deadline",
      title: "x",
    });
    expect(noDate.status).toBe(400);
    const created = await task(lead, base, {
      kind: "task",
      title: "Préparer les pièces",
      dueOn: null,
    });
    expect(created.dueOn).toBeNull();
    const deadline = await task(lead, base);
    const cleared = await lead.browser.send("patch", `${base}/tasks/${deadline.id}`, {
      dueOn: null,
    });
    expect(cleared.status).toBe(400);
  });

  it("assigns only to active team members, and tells the assignee", async () => {
    const { lead, assistant, base } = await team();
    const outsider = await person(ctx, "lawyer");
    const admin = await person(ctx, "admin");
    for (const assigneeId of [outsider.user.id, admin.user.id]) {
      const res = await lead.browser.send("post", `${base}/tasks`, {
        kind: "task",
        title: "x",
        assigneeId,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toEqual([{ path: "assigneeId", issue: "custom" }]);
    }
    const created = await task(lead, base, { kind: "task", assigneeId: assistant.user.id });
    expect(created.assignee?.id).toBe(assistant.user.id);
    const inbox = notificationListResponseSchema.parse(
      (await assistant.browser.send("get", "/api/notifications")).body,
    );
    expect(inbox.unread).toBe(1);
    expect(inbox.notifications[0]).toMatchObject({
      kind: "task_assigned",
      subject: "Délai d'appel",
    });
    // The person who assigned the task does not notify themselves.
    expect(
      notificationListResponseSchema.parse(
        (await lead.browser.send("get", "/api/notifications")).body,
      ).unread,
    ).toBe(0);
  });

  it("completes and reopens, recording who completed it", async () => {
    const { lead, assistant, base } = await team();
    const created = await task(lead, base);
    const path = `${base}/tasks/${created.id}`;
    const done = taskResponseSchema.parse(
      (await assistant.browser.send("patch", path, { completed: true })).body,
    ).task;
    expect(done.completedBy?.id).toBe(assistant.user.id);
    const reopened = taskResponseSchema.parse(
      (await lead.browser.send("patch", path, { completed: false })).body,
    ).task;
    expect(reopened).toMatchObject({ completedAt: null, completedBy: null });
    const actions = (await auditActions(ctx)).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["task.complete", "task.reopen"]));
  });
});

describe("access", () => {
  async function grid(who: (w: { lead: Person; matterId: string }) => Browser | Promise<Browser>) {
    const { lead, matter, base } = await team();
    const h = await hearing(lead, base);
    const t = await task(lead, base);
    const browser = await who({ lead, matterId: matter.id });
    const before = {
      hearings: await ctx.db.hearing.findMany({ orderBy: { id: "asc" } }),
      tasks: await ctx.db.matterTask.findMany({ orderBy: { id: "asc" } }),
    };
    const statuses = {
      listHearings: (await browser.send("get", `${base}/hearings`)).status,
      addHearing: (
        await browser.send("post", `${base}/hearings`, {
          startsAt: `${day(5)}T10:00`,
          title: "Autre",
        })
      ).status,
      editHearing: (await browser.send("patch", `${base}/hearings/${h.id}`, { room: "Salle 3" }))
        .status,
      listTasks: (await browser.send("get", `${base}/tasks`)).status,
      addTask: (await browser.send("post", `${base}/tasks`, { kind: "task", title: "Autre" }))
        .status,
      editTask: (await browser.send("patch", `${base}/tasks/${t.id}`, { completed: true })).status,
      deleteTask: (await browser.send("delete", `${base}/tasks/${t.id}`)).status,
    };
    const changed = Object.values(statuses).some((s) => s === 201 || s === 204 || s === 200);
    return { statuses, before, changed };
  }

  const ALL = {
    listHearings: 200,
    addHearing: 201,
    editHearing: 200,
    listTasks: 200,
    addTask: 201,
    editTask: 200,
    deleteTask: 204,
  };
  const NONE = Object.fromEntries(Object.keys(ALL).map((k) => [k, 404]));

  it("lead lawyer: everything; assistant: everything but deleting", async () => {
    expect((await grid(({ lead }) => lead.browser)).statuses).toEqual(ALL);
    expect(
      (
        await grid(async ({ lead, matterId }) => {
          const assistant = await person(ctx, "assistant");
          await addMember(lead, matterId, assistant);
          return assistant.browser;
        })
      ).statuses,
    ).toEqual({ ...ALL, deleteTask: 403 });
  });

  it.each(["lawyer", "assistant", "admin"] as const)(
    "%s outside the team: nothing visible, nothing changed",
    async (role) => {
      const { statuses, before } = await grid(async () => (await person(ctx, role)).browser);
      expect(statuses).toEqual(NONE);
      expect(await ctx.db.hearing.findMany({ orderBy: { id: "asc" } })).toEqual(before.hearings);
      expect(await ctx.db.matterTask.findMany({ orderBy: { id: "asc" } })).toEqual(before.tasks);
    },
  );

  it("administrator with break-glass access: reads only", async () => {
    const { statuses, before } = await grid(async ({ matterId }) => {
      const admin = await person(ctx, "admin", { reauth: true });
      const matter = await ctx.db.matter.findUniqueOrThrow({ where: { id: matterId } });
      await admin.browser.send("post", "/api/break-glass", {
        reference: matter.reference,
        reason: "Avocat injoignable, audience demain matin.",
      });
      return admin.browser;
    });
    expect(statuses).toEqual({
      listHearings: 200,
      addHearing: 403,
      editHearing: 403,
      listTasks: 200,
      addTask: 403,
      editTask: 403,
      deleteTask: 403,
    });
    expect(await ctx.db.matterTask.findMany({ orderBy: { id: "asc" } })).toEqual(before.tasks);
  });

  it("signed out: 401", async () => {
    const { statuses } = await grid(() => new Browser(ctx));
    expect(Object.values(statuses)).toEqual(Object.values(ALL).map(() => 401));
  });

  it("refuses a hearing or task ID from another matter", async () => {
    const { lead, base } = await team();
    const client = await createClient(lead, { name: "Autre" });
    const other = await createMatter(lead, client.id);
    const foreignHearing = await hearing(lead, `/api/matters/${other.id}`);
    const foreignTask = await task(lead, `/api/matters/${other.id}`);
    expect(
      (await lead.browser.send("patch", `${base}/hearings/${foreignHearing.id}`, { room: "x" }))
        .status,
    ).toBe(404);
    expect((await lead.browser.send("delete", `${base}/tasks/${foreignTask.id}`)).status).toBe(404);
  });
});

describe("agenda", () => {
  it("shows upcoming hearings and open items from the user's matters only, and what is overdue", async () => {
    const { lead, base } = await team();
    await hearing(lead, base, { startsAt: `${day(2)}T10:00`, title: "Visible" });
    const cancelled = await hearing(lead, base, { startsAt: `${day(2)}T11:00`, title: "Annulée" });
    await lead.browser.send("patch", `${base}/hearings/${cancelled.id}`, { status: "cancelled" });
    await task(lead, base, { title: "Bientôt", dueOn: day(4) });
    await task(lead, base, { title: "En retard", dueOn: day(-3) });
    const done = await task(lead, base, { title: "Fait", dueOn: day(4) });
    await lead.browser.send("patch", `${base}/tasks/${done.id}`, { completed: true });

    const outsider = await person(ctx, "lawyer");
    const theirs = await createClient(outsider, { name: "Voisin" });
    const theirMatter = await createMatter(outsider, theirs.id);
    await hearing(outsider, `/api/matters/${theirMatter.id}`, {
      startsAt: `${day(2)}T09:00`,
      title: "Pas pour moi",
    });

    const res = await lead.browser.send("get", `/api/agenda?from=${day(0)}&to=${day(30)}`);
    const agenda = agendaResponseSchema.parse(res.body);
    expect(agenda.hearings.map((h) => h.title)).toEqual(["Visible"]);
    expect(agenda.tasks.map((t) => t.title)).toEqual(["Bientôt"]);
    expect(agenda.overdue.map((t) => t.title)).toEqual(["En retard"]);
    expect(agenda.hearings[0]?.matter.reference).toMatch(/^\d{4}-\d{4}$/);
  });

  it("refuses inverted or over-long ranges", async () => {
    const { lead } = await team();
    expect((await lead.browser.send("get", `/api/agenda?from=${day(5)}&to=${day(1)}`)).status).toBe(
      400,
    );
    expect(
      (await lead.browser.send("get", `/api/agenda?from=${day(0)}&to=${day(200)}`)).status,
    ).toBe(400);
    expect((await lead.browser.send("get", "/api/agenda")).status).toBe(400);
  });
});

describe("reminders", () => {
  it("reminds the team (never administrators or disabled accounts) once per stage", async () => {
    const { lead, assistant, base, matter } = await team();
    const leaver = await person(ctx, "lawyer");
    await addMember(lead, matter.id, leaver);
    await ctx.db.user.update({ where: { id: leaver.user.id }, data: { disabledAt: new Date() } });
    const admin = await person(ctx, "admin", { reauth: true });
    await admin.browser.send("post", "/api/break-glass", {
      reference: matter.reference,
      reason: "Avocat injoignable, audience demain matin.",
    });

    const h = await hearing(lead, base, { startsAt: `${day(6)}T09:30` });
    const d = await task(lead, base, { dueOn: day(-1) });

    const created = await generateReminders(ctx.db);
    const rows = await ctx.db.notification.findMany({
      orderBy: [{ userId: "asc" }, { stage: "asc" }],
    });
    expect(created).toBe(4);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([lead.user.id, assistant.user.id]));
    expect(rows.filter((r) => r.subjectId === h.id).map((r) => r.stage)).toEqual(["7d", "7d"]);
    expect(rows.filter((r) => r.subjectId === d.id).map((r) => r.kind)).toEqual([
      "deadline_overdue",
      "deadline_overdue",
    ]);

    // Running again creates nothing new.
    expect(await generateReminders(ctx.db)).toBe(0);
    // The next day of a hearing's approach brings the next stage.
    const dayBefore = new Date(fromOfficeLocal(`${day(5)}T09:00`).getTime());
    expect(await generateReminders(ctx.db, dayBefore)).toBe(2);
  });

  it("reminds only the assignee of a task that is due", async () => {
    const { lead, assistant, base } = await team();
    await task(lead, base, {
      kind: "task",
      title: "Appeler le greffe",
      dueOn: day(0),
      assigneeId: assistant.user.id,
    });
    await ctx.db.notification.deleteMany({});
    expect(await generateReminders(ctx.db)).toBe(1);
    const row = await ctx.db.notification.findFirstOrThrow();
    expect(row).toMatchObject({ userId: assistant.user.id, kind: "task_due", stage: "due" });
  });

  it("lets each person read and dismiss only their own reminders", async () => {
    const { lead, assistant, base } = await team();
    await task(lead, base, { dueOn: day(0) });
    await generateReminders(ctx.db);
    const mine = notificationListResponseSchema.parse(
      (await lead.browser.send("get", "/api/notifications")).body,
    );
    expect(mine.unread).toBe(1);
    const theirs = await ctx.db.notification.findFirstOrThrow({
      where: { userId: assistant.user.id },
    });
    expect((await lead.browser.send("post", `/api/notifications/${theirs.id}/read`)).status).toBe(
      404,
    );
    const own = mine.notifications[0]?.id ?? "";
    expect((await lead.browser.send("post", `/api/notifications/${own}/read`)).status).toBe(204);
    expect(
      notificationListResponseSchema.parse(
        (await lead.browser.send("get", "/api/notifications")).body,
      ).unread,
    ).toBe(0);
    expect((await assistant.browser.send("post", "/api/notifications/read-all")).status).toBe(204);
    expect(await ctx.db.notification.count({ where: { readAt: null } })).toBe(0);
  });

  it("hides reminders about a matter the person has left", async () => {
    const { lead, assistant, base, matter } = await team();
    await task(lead, base, { dueOn: day(0) });
    await generateReminders(ctx.db);
    await lead.browser.send("delete", `/api/matters/${matter.id}/members/${assistant.user.id}`);
    const list = notificationListResponseSchema.parse(
      (await assistant.browser.send("get", "/api/notifications")).body,
    );
    expect(list).toEqual({ notifications: [], unread: 0 });
  });
});
