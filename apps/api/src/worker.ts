import { ConfigError, loadConfig } from "./config/env.js";
import { createDatabase } from "./lib/database.js";
import { createLogger } from "./lib/logger.js";
import { REQUIRED_TZDATA, tzdataCheck } from "./lib/tzdata.js";
import { runDueTasks } from "./modules/jobs/scheduler.js";
import { periodicTasks } from "./modules/jobs/tasks.js";
import { createServices } from "./modules/services.js";

/**
 * The background worker (ADR 0008): the same code and image as the API, run
 * as a separate process. It checks every 30 seconds which periodic tasks are
 * due and runs them. Several workers may run at once; each task still runs
 * once per interval.
 *
 *   npm run worker -w @lexora/api            (runs until stopped)
 *   npm run worker -w @lexora/api -- --once  (runs every task now, then exits)
 */

const POLL_MS = 30_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : "Failed to load configuration");
    process.exit(1);
  }
  const logger = createLogger(config).child({ process: "worker" });
  const tz = tzdataCheck(config.isProduction);
  if (tz !== "ok") {
    const detail = { found: process.versions["tz"], required: REQUIRED_TZDATA };
    if (tz === "refuse") {
      logger.fatal(detail, "outdated time-zone data: reminders would be wrong; update Node.js");
      process.exit(1);
    }
    logger.warn(detail, "outdated time-zone data: reminder times may be off by one hour");
  }
  const db = createDatabase(config);
  const { auth } = createServices(db, config);
  const tasks = periodicTasks({
    db,
    sessions: auth.sessions,
    limiter: auth.limiter,
    storageDir: config.documents.storageDir,
  });

  if (process.argv.includes("--once")) {
    const results = await runDueTasks(db, tasks, logger, { force: true });
    await db.$disconnect();
    process.exit(results.some((r) => r.status === "error") ? 1 : 0);
  }

  let stopping = false;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    if (stopping) return;
    running = runDueTasks(db, tasks, logger).catch((error: unknown) => {
      // Database unreachable, for example: try again at the next tick.
      logger.error({ err: error }, "worker tick failed");
    });
  };
  tick();
  const timer = setInterval(tick, POLL_MS);
  logger.info({ pollSeconds: POLL_MS / 1000 }, "worker started");

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    logger.info({ signal }, "worker stopping");
    void running.finally(() => db.$disconnect()).finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => {
    stop("SIGTERM");
  });
  process.on("SIGINT", () => {
    stop("SIGINT");
  });
}

main().catch((error: unknown) => {
  console.error("Worker failed to start", error instanceof Error ? error.name : "");
  process.exit(1);
});
