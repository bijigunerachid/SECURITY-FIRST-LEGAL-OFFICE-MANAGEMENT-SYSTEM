import type { Database } from "../../lib/database.js";
import type { Logger } from "../../lib/logger.js";

/**
 * Periodic background tasks (ADR 0008). The tasks and their intervals are
 * rows in `scheduled_task`, created by migrations. A worker claims a due
 * task with a single conditional UPDATE (due, and not leased by another
 * worker), so several worker processes can run safely: each task runs once
 * per interval. A crashed run is retried by any worker after its lease ends.
 */

export interface PeriodicTask {
  name: string;
  /** Does the work and returns a short summary for the task table (no personal data). */
  run(now: Date): Promise<string>;
}

export interface RunResult {
  name: string;
  status: "ok" | "error" | "skipped";
}

/** How long a claimed run may take before another worker may take it over. */
export const LEASE_MS = 10 * 60_000;

export async function runDueTasks(
  db: Database,
  tasks: PeriodicTask[],
  logger: Logger,
  options: { now?: Date; force?: boolean } = {},
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const task of tasks) {
    const now = options.now ?? new Date();
    const row = await db.scheduledTask.findUnique({
      where: { name: task.name },
      select: { intervalSeconds: true },
    });
    if (!row) {
      logger.error({ task: task.name }, "scheduled task missing from the database");
      results.push({ name: task.name, status: "error" });
      continue;
    }
    const { count } = await db.scheduledTask.updateMany({
      where: {
        name: task.name,
        ...(options.force ? {} : { nextRunAt: { lte: now } }),
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        nextRunAt: new Date(now.getTime() + row.intervalSeconds * 1000),
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        lastStartedAt: now,
      },
    });
    if (count === 0) {
      results.push({ name: task.name, status: "skipped" });
      continue;
    }
    let status: "ok" | "error" = "ok";
    let summary: string;
    try {
      summary = (await task.run(now)).slice(0, 200);
      logger.info({ task: task.name, summary }, "scheduled task finished");
    } catch (error) {
      status = "error";
      summary = "failed (see worker log)";
      logger.error({ err: error, task: task.name }, "scheduled task failed");
    }
    await db.scheduledTask.updateMany({
      where: { name: task.name },
      data: {
        leaseUntil: null,
        lastFinishedAt: new Date(),
        lastStatus: status,
        lastSummary: summary,
      },
    });
    results.push({ name: task.name, status });
  }
  return results;
}
