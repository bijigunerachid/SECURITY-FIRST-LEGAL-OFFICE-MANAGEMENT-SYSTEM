import { utimes, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memoryLogger } from "../../test/helpers.js";
import {
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import { runDueTasks, type PeriodicTask } from "./scheduler.js";
import { periodicTasks } from "./tasks.js";

let ctx: IntegrationContext;
const app = new pg.Client({ connectionString: process.env["DATABASE_URL"] ?? "" });

beforeAll(async () => {
  ctx = await integrationContext();
  await app.connect();
});
afterAll(async () => {
  await app.end();
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  // The task rows come from the migration; make them all due and unleased.
  await ctx.owner.query(
    "UPDATE scheduled_task SET next_run_at = now() - interval '1 minute', lease_until = NULL, last_status = NULL",
  );
});

const logger = () => memoryLogger().logger;

function counting(name: string, behaviour: () => Promise<string> = () => Promise.resolve("done")) {
  const task = {
    name,
    runs: 0,
    run: async () => {
      task.runs += 1;
      return behaviour();
    },
  };
  return task;
}

describe("runDueTasks", () => {
  it("runs a due task once, then waits for its interval", async () => {
    const task = counting("reminders");
    expect(await runDueTasks(ctx.db, [task], logger())).toEqual([
      { name: "reminders", status: "ok" },
    ]);
    expect(await runDueTasks(ctx.db, [task], logger())).toEqual([
      { name: "reminders", status: "skipped" },
    ]);
    expect(task.runs).toBe(1);
    const row = await ctx.db.scheduledTask.findUniqueOrThrow({ where: { name: "reminders" } });
    expect(row).toMatchObject({ lastStatus: "ok", lastSummary: "done", leaseUntil: null });
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });

  it("runs a task once even when two workers check at the same moment", async () => {
    const slow = counting("reminders", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return "done";
    });
    const results = await Promise.all([
      runDueTasks(ctx.db, [slow], logger()),
      runDueTasks(ctx.db, [slow], logger()),
      runDueTasks(ctx.db, [slow], logger()),
    ]);
    expect(slow.runs).toBe(1);
    expect(
      results
        .flat()
        .map((r) => r.status)
        .sort(),
    ).toEqual(["ok", "skipped", "skipped"]);
  });

  it("records a failure without its details, and releases the lease", async () => {
    const failing: PeriodicTask = {
      name: "purge-expired",
      run: () => Promise.reject(new Error("secret detail")),
    };
    const log = memoryLogger();
    expect(await runDueTasks(ctx.db, [failing], log.logger)).toEqual([
      { name: "purge-expired", status: "error" },
    ]);
    const row = await ctx.db.scheduledTask.findUniqueOrThrow({ where: { name: "purge-expired" } });
    expect(row).toMatchObject({ lastStatus: "error", leaseUntil: null });
    expect(row.lastSummary).not.toContain("secret detail");
  });

  it("does not take over a task another worker holds, until its lease ends", async () => {
    await ctx.owner.query(
      "UPDATE scheduled_task SET lease_until = now() + interval '5 minutes' WHERE name = 'reminders'",
    );
    const task = counting("reminders");
    expect(await runDueTasks(ctx.db, [task], logger(), { force: true })).toEqual([
      { name: "reminders", status: "skipped" },
    ]);
    await ctx.owner.query(
      "UPDATE scheduled_task SET lease_until = now() - interval '1 second' WHERE name = 'reminders'",
    );
    expect(await runDueTasks(ctx.db, [task], logger())).toEqual([
      { name: "reminders", status: "ok" },
    ]);
  });

  it("runs a task early only when forced", async () => {
    await ctx.owner.query("UPDATE scheduled_task SET next_run_at = now() + interval '1 hour'");
    const task = counting("reminders");
    expect((await runDueTasks(ctx.db, [task], logger()))[0]?.status).toBe("skipped");
    expect((await runDueTasks(ctx.db, [task], logger(), { force: true }))[0]?.status).toBe("ok");
  });
});

describe("the worker's tasks", () => {
  it("removes abandoned uploads from quarantine, and keeps recent ones", async () => {
    const quarantine = join(ctx.storageDir, "quarantine");
    const old = join(quarantine, "old-upload");
    const recent = join(quarantine, "recent-upload");
    await writeFile(old, "x");
    await writeFile(recent, "x");
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await utimes(old, twoHoursAgo, twoHoursAgo);

    const tasks = periodicTasks({
      db: ctx.db,
      sessions: ctx.auth.sessions,
      limiter: ctx.auth.limiter,
      storageDir: ctx.storageDir,
    });
    const results = await runDueTasks(ctx.db, tasks, logger());
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(await readdir(quarantine)).toEqual(["recent-upload"]);
  });
});

describe("application role on calendar tables", () => {
  /** SQLSTATE 42501 insufficient_privilege. */
  const denied = (sql: string) => expect(app.query(sql)).rejects.toMatchObject({ code: "42501" });

  it("cannot add, remove or reschedule periodic tasks", async () => {
    await denied(
      "INSERT INTO scheduled_task (name, interval_seconds, next_run_at) VALUES ('evil', 60, now())",
    );
    await denied("DELETE FROM scheduled_task");
    await denied("UPDATE scheduled_task SET interval_seconds = 604800");
    await denied("UPDATE scheduled_task SET name = 'renamed'");
  });

  it("cannot delete hearings or rewrite reminders", async () => {
    await denied("DELETE FROM hearing");
    await denied("UPDATE notification SET user_id = gen_random_uuid()");
    await denied("UPDATE notification SET stage = 'x'");
  });
});
