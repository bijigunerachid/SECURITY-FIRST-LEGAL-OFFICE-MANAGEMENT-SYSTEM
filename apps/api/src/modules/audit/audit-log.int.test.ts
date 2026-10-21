import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  codeFor,
  createTestUser,
  integrationContext,
  PASSWORD,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import { recordAudit, verifyAuditChain } from "./audit-log.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await integrationContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

const actions = async () =>
  (await ctx.db.auditEvent.findMany({ orderBy: { id: "asc" } })).map(
    (e) => `${e.action}:${e.outcome}`,
  );

describe("audit events", () => {
  it("records sign-in successes and failures with request context but no typed e-mail", async () => {
    const user = await createTestUser(ctx);
    await new Browser(ctx).send("post", "/api/auth/login", {
      email: user.email,
      password: "a wrong password guess",
    });
    await new Browser(ctx).send("post", "/api/auth/login", {
      email: "stranger@cabinet.test",
      password: PASSWORD,
    });
    await new Browser(ctx).send("post", "/api/auth/login", {
      email: user.email,
      password: PASSWORD,
    });

    expect(await actions()).toEqual([
      "auth.login:failure",
      "auth.login:failure",
      "auth.login:success",
    ]);
    const events = await ctx.db.auditEvent.findMany({ orderBy: { id: "asc" } });
    expect(events[0]).toMatchObject({
      actorUserId: user.id,
      metadata: { reason: "wrong_password" },
    });
    expect(events[1]).toMatchObject({ actorUserId: null, metadata: { reason: "unknown_account" } });
    for (const event of events) {
      expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.ipAddress).toBeTruthy();
    }
    expect(
      JSON.stringify(events, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain("stranger@cabinet.test");
  });

  it("never stores passwords, tokens or codes", async () => {
    const admin = await createTestUser(ctx, { role: "admin", mfa: true });
    const browser = new Browser(ctx);
    await browser.signIn(admin);
    await browser.reauth(admin);
    const created = await browser.send("post", "/api/admin/users", {
      email: "new.person@cabinet.test",
      displayName: "New Person",
      role: "lawyer",
    });
    const token = created.body.setup.token as string;
    await new Browser(ctx).send("post", "/api/auth/password/set", {
      token,
      password: "a passphrase nobody else knows",
    });

    const { rows } = await ctx.owner.query("SELECT * FROM audit_event");
    const dump = JSON.stringify(rows);
    for (const secret of [
      PASSWORD,
      token,
      "a passphrase nobody else knows",
      browser.sessionToken ?? "",
      browser.csrfToken ?? "",
      codeFor(admin.totpSecret ?? ""),
    ]) {
      expect(dump).not.toContain(secret);
    }
    expect(await actions()).toEqual(
      expect.arrayContaining([
        "admin.user.create:success",
        "auth.password.set:success",
        "auth.reauth:success",
      ]),
    );
  });

  it("forms a hash chain that verifies", async () => {
    for (let i = 0; i < 25; i++) {
      await recordAudit(ctx.db, {
        action: "test.event",
        outcome: "success",
        metadata: { i, nested: { b: 2, a: 1 } },
      });
    }
    const result = await verifyAuditChain(ctx.db, 10);
    expect(result).toMatchObject({ valid: true, checked: 25, firstInvalidId: null });
    expect(result.latestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("links correctly when many events are written at the same time", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordAudit(ctx.db, { action: "test.concurrent", outcome: "success", metadata: { i } }),
      ),
    );
    expect((await verifyAuditChain(ctx.db)).valid).toBe(true);
  });
});

describe("audit log protection", () => {
  it("cannot be changed or deleted by the application's database role", async () => {
    await recordAudit(ctx.db, { action: "test.event", outcome: "success" });
    const app = new pg.Client({ connectionString: ctx.config.databaseUrl });
    await app.connect();
    try {
      await expect(app.query("UPDATE audit_event SET action = 'tampered'")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(app.query("DELETE FROM audit_event")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("TRUNCATE audit_event")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });

  it("refuses updates even from the schema owner while the trigger is in place", async () => {
    await recordAudit(ctx.db, { action: "test.event", outcome: "success" });
    await expect(ctx.owner.query("UPDATE audit_event SET action = 'tampered'")).rejects.toThrow(
      /append-only/,
    );
  });

  it("detects tampering by someone who bypasses the trigger", async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(ctx.db, { action: "test.event", outcome: "success", metadata: { i } });
    }
    const third = (await ctx.db.auditEvent.findMany({ orderBy: { id: "asc" } }))[2];
    await ctx.owner.query(
      "ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update_or_delete",
    );
    try {
      await ctx.owner.query("UPDATE audit_event SET outcome = 'failure' WHERE id = $1", [
        String(third?.id),
      ]);
    } finally {
      await ctx.owner.query(
        "ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update_or_delete",
      );
    }
    expect(await verifyAuditChain(ctx.db)).toMatchObject({
      valid: false,
      firstInvalidId: third?.id,
    });
  });

  it("detects a deleted event", async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(ctx.db, { action: "test.event", outcome: "success", metadata: { i } });
    }
    await ctx.owner.query(
      "ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update_or_delete",
    );
    try {
      await ctx.owner.query("DELETE FROM audit_event WHERE id = 2");
    } finally {
      await ctx.owner.query(
        "ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update_or_delete",
      );
    }
    expect((await verifyAuditChain(ctx.db)).valid).toBe(false);
  });
});

describe("secrets at rest", () => {
  it("stores the second-factor secret encrypted and recovery codes hashed", async () => {
    const admin = await createTestUser(ctx, { role: "admin" });
    const browser = new Browser(ctx);
    await browser.login(admin.email, PASSWORD);
    const setup = await browser.send("post", "/api/auth/mfa/totp/setup");
    const confirm = await browser.send("post", "/api/auth/mfa/totp/confirm", {
      code: codeFor(setup.body.secret as string),
    });

    const { rows } = await ctx.owner.query(
      "SELECT t.*, r.code_hash FROM totp_factor t JOIN recovery_code r USING (user_id)",
    );
    const dump =
      JSON.stringify(rows) +
      rows
        .map((r: { secret_ciphertext: Buffer }) => r.secret_ciphertext.toString("latin1"))
        .join("");
    expect(dump).not.toContain(setup.body.secret);
    for (const code of confirm.body.recoveryCodes as string[]) {
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(code.replace(/-/g, ""));
    }
  });

  it("stores passwords only as Argon2id hashes", async () => {
    const user = await createTestUser(ctx);
    const { rows } = await ctx.owner.query<{ password_hash: string }>(
      "SELECT password_hash FROM app_user WHERE id = $1",
      [user.id],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(PASSWORD);
  });
});
