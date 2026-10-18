import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import type { Config } from "../config/env.js";

export type { Logger } from "pino";

/**
 * Paths removed from every log line. Request serializers below already avoid
 * logging headers and bodies; this list is the second line of defence for
 * anything logged by hand.
 */
export const REDACT_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "secret",
  "code",
  "totp",
  "cookie",
  "authorization",
  "databaseUrl",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
  "*.secret",
  "*.code",
  "*.totp",
  "*.cookie",
  "*.authorization",
  "*.databaseUrl",
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

export function createLogger(
  config: Pick<Config, "logLevel" | "nodeEnv">,
  destination?: DestinationStream,
): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    base: { service: "lexora-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
