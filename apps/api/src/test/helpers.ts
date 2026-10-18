import { Writable } from "node:stream";
import type { Config } from "../config/env.js";
import { createApp } from "../http/app.js";
import type { DatabaseProbe } from "../lib/database.js";
import { createLogger, type Logger } from "../lib/logger.js";

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

export function testApp(database: DatabaseProbe = reachableDatabase) {
  const log = memoryLogger();
  const app = createApp({ config: { trustProxy: 0 }, logger: log.logger, database });
  return { app, log };
}
