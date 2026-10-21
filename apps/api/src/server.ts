import { ConfigError, loadConfig } from "./config/env.js";
import { createApp } from "./http/app.js";
import { createDatabase, createDatabaseProbe } from "./lib/database.js";
import { createLogger } from "./lib/logger.js";
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
  const db = createDatabase(config);

  // The API still starts if the database is down, so the problem is visible
  // through the readiness endpoint and the logs rather than a crash loop.
  if (await createDatabaseProbe(db, STARTUP_DATABASE_TIMEOUT_MS).isReachable()) {
    logger.info("database reachable");
  } else {
    logger.error("database unreachable at startup; readiness will report unavailable");
  }

  const services = createServices(db, config);
  const { auth } = services;
  const app = createApp({ config, logger, database: createDatabaseProbe(db), ...services });

  // Expired sessions and rate-limit windows are also removed when touched;
  // this sweep catches the rest. (Moves to the background worker in Phase 6.)
  const sweep = setInterval(() => {
    Promise.all([auth.sessions.purgeExpired(), auth.limiter.purgeExpired()]).catch(
      (error: unknown) => {
        logger.error({ err: error }, "cleanup of expired sessions failed");
      },
    );
  }, 15 * 60_000);
  sweep.unref();

  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port, env: config.nodeEnv }, "API listening");
  });

  // Limit slow or stalled clients.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
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
