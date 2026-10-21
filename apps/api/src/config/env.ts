import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

/**
 * Settings that may hold secrets. Each can be given directly (`NAME`) or as a
 * path to a file holding the value (`NAME_FILE`), which is how Docker secrets
 * are mounted. Giving both is an error, so there is never doubt about which
 * value is used.
 */
const SECRET_KEYS = ["DATABASE_URL", "MFA_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY_PREVIOUS"] as const;

/** OWASP minimum for Argon2id; enforced in every environment. */
export const ARGON2_MIN_MEMORY_KIB = 19_456;
export const ARGON2_MIN_ITERATIONS = 2;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/** Role names that must never be used by the running application. */
const FORBIDDEN_DATABASE_USERS = new Set(["postgres", "root", "admin", "lexora_owner"]);

const port = z.coerce.number().int().min(1).max(65_535);

const databaseUrl = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a valid URL" });
      return;
    }
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      ctx.addIssue({ code: "custom", message: "must use the postgresql:// scheme" });
    }
    if (url.username === "" || url.password === "") {
      ctx.addIssue({ code: "custom", message: "must include a user name and password" });
    }
    if (FORBIDDEN_DATABASE_USERS.has(decodeURIComponent(url.username))) {
      ctx.addIssue({
        code: "custom",
        message: "must use the least-privilege application role, not a superuser or owner role",
      });
    }
    if (url.pathname.length <= 1) {
      ctx.addIssue({ code: "custom", message: "must name a database" });
    }
  });

/** A 256-bit key, base64-encoded. Generate with `openssl rand -base64 32`. */
const encryptionKey = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const key = Buffer.from(value, "base64");
    if (key.length !== 32 || key.toString("base64") !== value.replace(/\s/g, "")) {
      ctx.addIssue({ code: "custom", message: "must be exactly 32 bytes, base64-encoded" });
      return z.NEVER;
    }
    return key;
  });

/** The web application's origin, e.g. https://lexora.office.example. No path. */
const origin = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a valid URL" });
      return;
    }
    if (url.origin !== value) {
      ctx.addIssue({
        code: "custom",
        message: "must be an origin only (scheme, host and port), with no path or trailing slash",
      });
    }
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: port.default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    /**
     * Number of reverse proxies in front of the API whose X-Forwarded-For
     * headers are trusted. 0 when the API is reached directly.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),
    /** Origin of the web application; requests from any other origin are refused. */
    APP_ORIGIN: origin,
    /** Encrypts TOTP secrets. The previous key is only used to read old values. */
    MFA_ENCRYPTION_KEY: encryptionKey,
    MFA_ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(10),
    ARGON2_MEMORY_KIB: z.coerce
      .number()
      .int()
      .min(ARGON2_MIN_MEMORY_KIB)
      .max(1_048_576)
      .default(65_536),
    ARGON2_ITERATIONS: z.coerce.number().int().min(ARGON2_MIN_ITERATIONS).max(10).default(3),
    /**
     * Private folder for uploaded documents (quarantine and storage), outside
     * any web root. Absolute path; created at startup with owner-only rights.
     */
    DOCUMENT_STORAGE_DIR: z
      .string()
      .min(1)
      .refine((value) => isAbsolute(value), { message: "must be an absolute path" }),
    /** ClamAV daemon (clamd). Uploads are refused while it cannot be reached. */
    CLAMAV_HOST: z.string().min(1).default("127.0.0.1"),
    CLAMAV_PORT: port.default(3310),
    CLAMAV_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(60),
    /** Largest accepted document (decision D8: 25 MB). */
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }
    if (!env.APP_ORIGIN.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "must use https:// in production",
      });
    }
    // DATABASE_URL may already have failed its own checks; refinements can
    // still run in that case, so parse defensively.
    let password = "";
    try {
      password = decodeURIComponent(new URL(env.DATABASE_URL).password);
    } catch {
      return;
    }
    if (password.length < 24) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "password must be at least 24 characters in production",
      });
    }
    if (env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "trace") {
      ctx.addIssue({
        code: "custom",
        path: ["LOG_LEVEL"],
        message: "debug and trace logging are not allowed in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config {
  nodeEnv: Env["NODE_ENV"];
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: Env["LOG_LEVEL"];
  databaseUrl: string;
  databasePoolMax: number;
  trustProxy: number;
  appOrigin: string;
  mfaEncryptionKey: Buffer;
  mfaEncryptionKeyPrevious: Buffer | null;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  argon2: { memoryKib: number; iterations: number };
  documents: { storageDir: string; maxUploadBytes: number };
  clamav: { host: string; port: number; timeoutMs: number };
}

/** Thrown when settings are missing or invalid. Never contains setting values. */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

type RawEnv = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, "utf8");

/** Resolves `NAME_FILE` variables into `NAME`. */
function resolveSecretFiles(raw: RawEnv, readFile: ReadFile): { env: RawEnv; problems: string[] } {
  const env: RawEnv = { ...raw };
  const problems: string[] = [];

  for (const key of SECRET_KEYS) {
    const fileKey = `${key}_FILE`;
    const filePath = raw[fileKey];
    if (filePath === undefined || filePath === "") {
      continue;
    }
    if (raw[key] !== undefined && raw[key] !== "") {
      problems.push(`${key}: set either ${key} or ${fileKey}, not both`);
      continue;
    }
    try {
      // Remove the trailing newline that editors and `echo` add.
      env[key] = readFile(filePath).replace(/\r?\n$/, "");
    } catch {
      problems.push(`${fileKey}: the file could not be read`);
    }
  }
  return { env, problems };
}

/**
 * Validates settings once, at startup. The process must not start with
 * missing or unsafe settings. Error messages name the setting and the rule,
 * never the value, so secrets cannot end up in logs.
 */
export function loadConfig(
  raw: RawEnv = process.env,
  readFile: ReadFile = defaultReadFile,
): Config {
  const { env, problems } = resolveSecretFiles(raw, readFile);
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "(environment)";
      const message = issue.code === "invalid_type" ? "is required" : issue.message;
      problems.push(`${key}: ${message}`);
    }
  }
  if (problems.length > 0 || !parsed.success) {
    throw new ConfigError(problems);
  }

  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    trustProxy: e.TRUST_PROXY,
    appOrigin: e.APP_ORIGIN,
    mfaEncryptionKey: e.MFA_ENCRYPTION_KEY,
    mfaEncryptionKeyPrevious: e.MFA_ENCRYPTION_KEY_PREVIOUS ?? null,
    sessionIdleMs: e.SESSION_IDLE_MINUTES * 60_000,
    sessionAbsoluteMs: e.SESSION_ABSOLUTE_HOURS * 3_600_000,
    argon2: { memoryKib: e.ARGON2_MEMORY_KIB, iterations: e.ARGON2_ITERATIONS },
    documents: {
      storageDir: e.DOCUMENT_STORAGE_DIR,
      maxUploadBytes: e.UPLOAD_MAX_MB * 1024 * 1024,
    },
    clamav: {
      host: e.CLAMAV_HOST,
      port: e.CLAMAV_PORT,
      timeoutMs: e.CLAMAV_TIMEOUT_SECONDS * 1000,
    },
  };
}
