import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import request from "supertest";
import type { Express } from "express";
import { loadConfig, type Config } from "../config/env.js";
import { createApp } from "../http/app.js";
import { createDatabase, createDatabaseProbe, type Database } from "../lib/database.js";
import type { AuthService } from "../modules/auth/auth-service.js";
import { createServices } from "../modules/services.js";
import { hashPassword } from "../modules/auth/passwords.js";
import { SESSION_COOKIE } from "../modules/auth/sessions.js";
import { currentTotp, encryptTotpSecret, newTotpSecret } from "../modules/auth/totp.js";
import { startFakeClamd, type FakeClamd } from "./fake-clamd.js";
import { memoryLogger } from "./helpers.js";

/**
 * Shared set-up for integration tests: the real API wired to the real test
 * database, a "browser" that keeps cookies and the CSRF token, and helpers
 * to create users directly.
 */

export interface IntegrationContext {
  config: Config;
  db: Database;
  auth: AuthService;
  app: Express;
  /** Owner-role connection, only for cleaning tables and inspecting state. */
  owner: pg.Client;
  /** Fake malware scanner speaking the clamd protocol; tests can change its mode. */
  clamd: FakeClamd;
  /** This test file's own document storage folder (deleted afterwards). */
  storageDir: string;
  close(): Promise<void>;
}

const TABLES = [
  "document_version",
  "document",
  "break_glass_grant",
  "party",
  "matter_member",
  "matter",
  "matter_counter",
  "client",
  "audit_event",
  "rate_limit_bucket",
  "password_token",
  "recovery_code",
  "totp_factor",
  "session",
  "app_user",
];

export async function integrationContext(): Promise<IntegrationContext> {
  const clamd = await startFakeClamd();
  const storageDir = await mkdtemp(join(tmpdir(), "lexora-documents-"));
  const config: Config = {
    ...loadConfig(process.env),
    documents: { storageDir, maxUploadBytes: 2 * 1024 * 1024 },
    clamav: { host: "127.0.0.1", port: clamd.port, timeoutMs: 2_000 },
  };
  const db = createDatabase(config);
  const services = createServices(db, config);
  await services.storage.init();
  const { auth } = services;
  const app = createApp({
    config,
    logger: memoryLogger().logger,
    database: createDatabaseProbe(db),
    ...services,
  });

  const ownerUrl = process.env["MIGRATION_DATABASE_URL"];
  if (!ownerUrl || !new URL(ownerUrl).pathname.endsWith("_test")) {
    throw new Error("MIGRATION_DATABASE_URL must point to a *_test database");
  }
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();

  return {
    config,
    db,
    auth,
    app,
    owner,
    clamd,
    storageDir,
    async close() {
      await owner.end();
      await db.$disconnect();
      await clamd.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

/** Empties every table (owner role: the app role may not truncate). */
export async function resetDatabase(ctx: IntegrationContext): Promise<void> {
  await ctx.owner.query(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export const PASSWORD = "olive tree beside the old harbour";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Base32 TOTP secret when the user has a confirmed second factor. */
  totpSecret: string | null;
}

let counter = 0;

export async function createTestUser(
  ctx: IntegrationContext,
  options: {
    role?: "admin" | "lawyer" | "assistant";
    mfa?: boolean;
    disabled?: boolean;
    password?: string | null;
    email?: string;
  } = {},
): Promise<TestUser> {
  counter += 1;
  const email = options.email ?? `user${counter}-${Date.now()}@cabinet.test`;
  const password = options.password === undefined ? PASSWORD : options.password;
  const user = await ctx.db.user.create({
    data: {
      email,
      displayName: `Test User ${counter}`,
      role: options.role ?? "lawyer",
      passwordHash: password === null ? null : await hashPassword(password, ctx.config.argon2),
      disabledAt: options.disabled ? new Date() : null,
    },
  });
  let totpSecret: string | null = null;
  if (options.mfa) {
    totpSecret = newTotpSecret();
    const sealed = encryptTotpSecret(totpSecret, user.id, ctx.config.mfaEncryptionKey);
    await ctx.db.totpFactor.create({
      data: {
        userId: user.id,
        secretCiphertext: new Uint8Array(sealed.ciphertext),
        keyId: sealed.keyId,
        confirmedAt: new Date(),
      },
    });
  }
  return { id: user.id, email, password: password ?? "", totpSecret };
}

/** A code from a time step that has not been used yet (each step is accepted once). */
export function codeFor(secret: string, offsetSteps = 0): string {
  return currentTotp(secret, Date.now() + offsetSteps * 30_000);
}

type Method = "get" | "post" | "patch" | "delete";

/**
 * Behaves like the browser: sends the app's Origin, keeps the session cookie
 * it is given, and echoes the CSRF token.
 */
export class Browser {
  sessionToken: string | null = null;
  csrfToken: string | null = null;
  origin: string;

  constructor(private readonly ctx: IntegrationContext) {
    this.origin = ctx.config.appOrigin;
  }

  private get app(): Express {
    return this.ctx.app;
  }

  /**
   * Each authenticator code is accepted once (replay protection, tested
   * separately). Tests that sign the same user in several times within one
   * 30-second step clear that marker first.
   */
  async allowCodeReuse(user: TestUser): Promise<void> {
    await this.ctx.owner.query("UPDATE totp_factor SET last_used_step = NULL WHERE user_id = $1", [
      user.id,
    ]);
  }

  async send(method: Method, path: string, body?: unknown, headers: Record<string, string> = {}) {
    let req = request(this.app)[method](path).set("Origin", this.origin);
    if (this.sessionToken) req = req.set("Cookie", `${SESSION_COOKIE}=${this.sessionToken}`);
    if (this.csrfToken) req = req.set("X-CSRF-Token", this.csrfToken);
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    const res = body === undefined ? await req : await req.send(body as object);
    this.absorbCookies(res.headers["set-cookie"]);
    return res;
  }

  private absorbCookies(header: string | string[] | undefined): void {
    const cookies = Array.isArray(header) ? header : header ? [header] : [];
    for (const cookie of cookies) {
      const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(cookie);
      if (!match) continue;
      const expired = /Expires=Thu, 01 Jan 1970/i.test(cookie) || match[1] === "";
      this.sessionToken = expired ? null : (match[1] ?? null);
      this.csrfToken = null;
    }
  }

  /** Loads the CSRF token for the current session. */
  async refresh() {
    const res = await this.send("get", "/api/auth/session");
    this.csrfToken = res.status === 200 ? (res.body as { csrfToken: string }).csrfToken : null;
    return res;
  }

  async login(email: string, password: string) {
    const res = await this.send("post", "/api/auth/login", { email, password });
    await this.refresh();
    return res;
  }

  /** Signs in completely, including the second factor if the user has one. */
  async signIn(user: TestUser) {
    const res = await this.login(user.email, user.password);
    if ((res.body as { state?: string }).state === "mfa_pending" && user.totpSecret) {
      await this.allowCodeReuse(user);
      await this.send("post", "/api/auth/mfa/verify", { code: codeFor(user.totpSecret) });
      await this.refresh();
    }
    return res;
  }

  async reauth(user: TestUser) {
    if (user.totpSecret) await this.allowCodeReuse(user);
    return this.send("post", "/api/auth/reauth", {
      password: user.password,
      ...(user.totpSecret ? { code: codeFor(user.totpSecret) } : {}),
    });
  }
}
