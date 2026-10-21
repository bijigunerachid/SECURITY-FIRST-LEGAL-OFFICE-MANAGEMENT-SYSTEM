import { Writable } from "node:stream";
import type { Config } from "../config/env.js";
import { createApp } from "../http/app.js";
import { createDatabase, type DatabaseProbe } from "../lib/database.js";
import { createLogger, type Logger } from "../lib/logger.js";
import { createServices } from "../modules/services.js";

/** A logger that writes JSON lines to memory so tests can inspect them. */
export function memoryLogger(level: Config["logLevel"] = "info"): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
  raw: () => string;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const logger = createLogger({ logLevel: level, nodeEnv: "test" }, stream);
  const raw = () => chunks.join("");
  return {
    logger,
    raw,
    lines: () =>
      raw()
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export const reachableDatabase: DatabaseProbe = { isReachable: () => Promise.resolve(true) };
export const unreachableDatabase: DatabaseProbe = { isReachable: () => Promise.resolve(false) };

export const TEST_APP_ORIGIN = "http://127.0.0.1:4173";

/** Settings for unit tests. The database URL points nowhere: unit tests never query it. */
export function unitTestConfig(): Config {
  return {
    nodeEnv: "test",
    isProduction: false,
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    databaseUrl: "postgresql://lexora_app:test-only-unused-password@127.0.0.1:1/none_test",
    databasePoolMax: 1,
    trustProxy: 0,
    appOrigin: TEST_APP_ORIGIN,
    mfaEncryptionKey: Buffer.alloc(32, 7),
    mfaEncryptionKeyPrevious: null,
    sessionIdleMs: 30 * 60_000,
    sessionAbsoluteMs: 10 * 3_600_000,
    argon2: { memoryKib: 19_456, iterations: 2 },
  };
}

/** The app with all routes, for tests that never reach the database. */
export function testApp(database: DatabaseProbe = reachableDatabase) {
  const log = memoryLogger();
  const config = unitTestConfig();
  const services = createServices(createDatabase(config), config);
  const app = createApp({ config, logger: log.logger, database, ...services });
  return { app, log };
}
