import { ConfigError, loadConfig } from "./config/env.js";
import { createApp } from "./http/app.js";
import { createDatabase, createDatabaseProbe } from "./lib/database.js";
import { createLogger } from "./lib/logger.js";
import { REQUIRED_TZDATA, runtimeTzdata, tzdataCheck } from "./lib/tzdata.js";
import { createServices } from "./modules/services.js";

const SHUTDOWN_GRACE_MS = 10_000;
/**
 * Opening the first database connection can take over a second on a busy
 * machine, longer than the readiness check allows. Connecting before
 * accepting requests keeps readiness from falsely reporting the database as
 * down right after a restart.
 */
const STARTUP_DATABASE_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // The logger needs configuration, so report configuration errors plainly.
    // ConfigError messages name settings and rules, never values.
    console.error(error instanceof ConfigError ? error.message : "Failed to load configuration");
    process.exit(1);
  }

  const logger = createLogger(config);
  const tz = tzdataCheck(config.isProduction, runtimeTzdata());
  if (tz !== "ok") {
    const detail = { found: runtimeTzdata(), required: REQUIRED_TZDATA };
    if (tz === "refuse") {
      logger.fatal(detail, "outdated time-zone data: office times would be wrong; update Node.js");
      process.exit(1);
    }
    logger.warn(detail, "outdated time-zone data: office times may be off by one hour");
  }
  const db = createDatabase(config);

  // The API still starts if the database is down, so the problem is visible
  // through the readiness endpoint and the logs rather than a crash loop.
  if (await createDatabaseProbe(db, STARTUP_DATABASE_TIMEOUT_MS).isReachable()) {
    logger.info("database reachable");
  } else {
    logger.error("database unreachable at startup; readiness will report unavailable");
  }

  const services = createServices(db, config);
  try {
    // Document folders must exist and be writable before uploads are accepted.
    await services.storage.init();
  } catch {
    logger.fatal("document storage folder is missing or not writable (DOCUMENT_STORAGE_DIR)");
    process.exit(1);
  }
  const app = createApp({ config, logger, database: createDatabaseProbe(db), ...services });

  // Periodic cleanup (expired sessions, rate-limit windows, abandoned
  // uploads) and reminders run in the worker process: src/worker.ts.

  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port, env: config.nodeEnv }, "API listening");
  });

  // Limit slow or stalled clients.
  server.headersTimeout = 15_000;
  // Long enough for a 25 MB upload over a slow office Wi-Fi link; headers
  // must still arrive within 15 seconds.
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    const forceExit = setTimeout(() => {
      logger.error("shutdown timed out; exiting");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close(() => {
      db.$disconnect()
        .catch((error: unknown) => {
          logger.error({ err: error }, "error while disconnecting from the database");
        })
        .finally(() => {
          process.exit(0);
        });
    });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
}

start().catch((error: unknown) => {
  console.error("Failed to start the API", error instanceof Error ? error.name : "");
  process.exit(1);
});
