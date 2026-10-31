import {
  alertCountResponseSchema,
  alertListResponseSchema,
  alertResponseSchema,
  auditListResponseSchema,
  auditVerificationResponseSchema,
  matterHistoryResponseSchema,
} from "@lexora/shared";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALERT_RULES, AlertService } from "../../modules/alerts/alert-service.js";
import { recordAudit } from "../../modules/audit/audit-log.js";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import { addMember, createClient, createMatter, person } from "../../test/matters.js";

let ctx: IntegrationContext;
let alerts: AlertService;
const app = new pg.Client({ connectionString: process.env["DATABASE_URL"] ?? "" });

beforeAll(async () => {
  ctx = await integrationContext();
  alerts = new AlertService(ctx.db);
  await app.connect();
});
afterAll(async () => {
  await app.end();
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

/** Writes `count` audit events as the application would. */
async function events(count: number, event: Parameters<typeof recordAudit>[1]) {
  for (let i = 0; i < count; i += 1) await recordAudit(ctx.db, event);
}

async function alertRows() {
  const { rows } = await ctx.owner.query<{
    kind: string;
    subject: string;
    count: number;
    status: string;
  }>("SELECT kind, subject, count, status FROM security_alert ORDER BY kind::text, subject");
  return rows;
}

describe("audit-log viewer", () => {
  it("is for administrators only; everyone else gets 404", async () => {
    for (const role of ["lawyer", "assistant"] as const) {
      const someone = await person(ctx, role);
      expect((await someone.browser.send("get", "/api/admin/audit")).status).toBe(404);
      expect((await someone.browser.send("post", "/api/admin/audit/verify")).status).toBe(404);
    }
    expect((await new Browser(ctx).send("get", "/api/admin/audit")).status).toBe(401);
  });

  it("filters, pages newest first, names the actor and audits the search", async () => {
    const admin = await person(ctx, "admin");
    const lawyer = await person(ctx, "lawyer");
    await createMatter(lawyer, (await createClient(lawyer)).id);
    await events(60, { action: "test.noise", outcome: "success" });

    const first = auditListResponseSchema.parse(
      (await admin.browser.send("get", "/api/admin/audit?action=test.")).body,
    );
    expect(first.events).toHaveLength(50);
    expect(first.nextBefore).not.toBeNull();
    const second = auditListResponseSchema.parse(
      (
        await admin.browser.send(
          "get",
          `/api/admin/audit?action=test.&before=${first.nextBefore ?? ""}`,
        )
      ).body,
    );
    expect(second.events).toHaveLength(10);
    expect(second.nextBefore).toBeNull();
    const ids = [...first.events, ...second.events].map((e) => BigInt(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => (a > b ? -1 : 1)));

    const mine = auditListResponseSchema.parse(
      (
        await admin.browser.send(
          "get",
          `/api/admin/audit?actorId=${lawyer.user.id}&action=matter.create`,
        )
      ).body,
    );
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]).toMatchObject({
      action: "matter.create",
      outcome: "success",
      actor: { id: lawyer.user.id },
      targetType: "matter",
    });
    // The matter's title or client never appears in the log.
    expect(JSON.stringify(mine)).not.toContain("Succession Berrada");

    for (const bad of [
      "action=DROP",
      "outcome=maybe",
      "actorId=x",
      "from=2026-02-30",
      "before=0",
      "from=2026-03-02&to=2026-03-01",
      "x=1",
    ]) {
      expect((await admin.browser.send("get", `/api/admin/audit?${bad}`)).status, bad).toBe(400);
    }
    const { rows } = await ctx.owner.query(
      "SELECT 1 FROM audit_event WHERE action = 'audit.search'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("verifies the hash chain and reports the first changed event", async () => {
    const admin = await person(ctx, "admin");
    await events(5, { action: "test.event", outcome: "success" });
    const ok = auditVerificationResponseSchema.parse(
      (await admin.browser.send("post", "/api/admin/audit/verify")).body,
    ).verification;
    expect(ok).toMatchObject({ valid: true, firstInvalidId: null });

    // Tampering needs the schema owner with the append-only trigger lifted.
    const { rows } = await ctx.owner.query<{ id: string }>(
      "SELECT id FROM audit_event WHERE action = 'test.event' ORDER BY id LIMIT 1 OFFSET 2",
    );
    await ctx.owner.query(
      "ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update_or_delete",
    );
    await ctx.owner.query("UPDATE audit_event SET outcome = 'failure' WHERE id = $1", [
      rows[0]?.id,
    ]);
    await ctx.owner.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update_or_delete");
    const broken = auditVerificationResponseSchema.parse(
      (await admin.browser.send("post", "/api/admin/audit/verify")).body,
    ).verification;
    expect(broken).toMatchObject({ valid: false, firstInvalidId: rows[0]?.id });

    // The daily worker check raises a critical alert, once.
    await alerts.verifyChain();
    await alerts.verifyChain();
    expect(await alertRows()).toEqual([
      { kind: "audit_chain", subject: rows[0]?.id, count: 1, status: "open" },
    ]);
  });
});

describe("matter history", () => {
  async function scene() {
    const lead = await person(ctx, "lawyer");
    const colleague = await person(ctx, "lawyer");
    const assistant = await person(ctx, "assistant");
    const matter = await createMatter(lead, (await createClient(lead)).id);
    await addMember(lead, matter.id, colleague);
    await addMember(lead, matter.id, assistant);
    return { lead, colleague, assistant, matter, path: `/api/matters/${matter.id}/history` };
  }

  it("is for the lead lawyer: other members get 403, outsiders 404", async () => {
    const { colleague, assistant, path } = await scene();
    expect((await colleague.browser.send("get", path)).status).toBe(403);
    expect((await assistant.browser.send("get", path)).status).toBe(403);
    const outsider = await person(ctx, "lawyer");
    expect((await outsider.browser.send("get", path)).status).toBe(404);
  });

  it("shows who did what, including break-glass reads, without IP addresses or other matters", async () => {
    const { lead, assistant, matter, path } = await scene();
    const other = await createMatter(lead, (await createClient(lead)).id);
    await lead.browser.send("patch", `/api/matters/${matter.id}`, { title: "Nouveau titre" });
    await assistant.browser.send("post", `/api/matters/${matter.id}/tasks`, {
      kind: "task",
      title: "Copier les pièces",
    });
    await lead.browser.send("patch", `/api/matters/${other.id}`, { title: "Autre" });
    // Linked to the other matter through its metadata, not its target.
    await lead.browser.send("post", `/api/matters/${other.id}/tasks`, {
      kind: "task",
      title: "Tâche d'un autre dossier",
    });
    const admin = await person(ctx, "admin", { reauth: true });
    await admin.browser.send("post", "/api/break-glass", {
      reference: matter.reference,
      reason: "Contrôle demandé par le bâtonnier",
    });
    await admin.browser.send("get", `/api/matters/${matter.id}`);

    const res = await lead.browser.send("get", path);
    expect(res.status).toBe(200);
    const { events } = matterHistoryResponseSchema.parse(res.body);
    const summary = events.map((e) => [e.action, e.actor?.id ?? null, e.breakGlass]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ["matter.create", lead.user.id, false],
        ["matter.update", lead.user.id, false],
        ["task.create", assistant.user.id, false],
        ["matter.break_glass", admin.user.id, true],
        ["matter.read", admin.user.id, true],
      ]),
    );
    expect(events.find((e) => e.action === "matter.update")?.fields).toEqual(["title"]);
    // Only this matter's events, newest first, and no network details.
    expect(events.filter((e) => e.action === "matter.update")).toHaveLength(1);
    expect(events.filter((e) => e.action === "task.create")).toHaveLength(1);
    expect(events[0]?.action).toBe("matter.read");
    expect(JSON.stringify(res.body)).not.toMatch(/ipAddress|requestId|127\.0\.0\.1|::1/);
  });
});

describe("alerts", () => {
  const now = () => new Date();

  it("raise one alert per account for repeated failed checks, and keep counting", async () => {
    const lawyer = await person(ctx, "lawyer");
    const failure = {
      action: "auth.login",
      outcome: "failure" as const,
      actorUserId: lawyer.user.id,
    };
    await events(ALERT_RULES.accountFailures - 1, failure);
    expect(await alerts.scan(now())).toBe(0);
    await events(1, failure);
    expect(await alerts.scan(now())).toBe(1);
    await events(2, { action: "auth.mfa.verify", outcome: "failure", actorUserId: lawyer.user.id });
    expect(await alerts.scan(now())).toBe(0);
    expect(await alertRows()).toEqual([
      {
        kind: "login_failures_account",
        subject: lawyer.user.id,
        count: ALERT_RULES.accountFailures + 2,
        status: "open",
      },
    ]);
  });

  it("raise alerts for an IP address and for probing other matters", async () => {
    const lawyer = await person(ctx, "lawyer");
    await events(ALERT_RULES.ipFailures, {
      action: "auth.login",
      outcome: "failure",
      ipAddress: "192.0.2.7",
    });
    await events(ALERT_RULES.deniedAccess, {
      action: "matter.access",
      outcome: "denied",
      actorUserId: lawyer.user.id,
    });
    // Refused uploads and old events are not probing.
    await events(ALERT_RULES.deniedAccess, {
      action: "document.rejected",
      outcome: "denied",
      actorUserId: "00000000-0000-4000-8000-000000000001",
    });
    expect(await alerts.scan(now())).toBe(2);
    expect((await alertRows()).map((a) => [a.kind, a.subject])).toEqual([
      ["access_denied", lawyer.user.id],
      ["login_failures_ip", "192.0.2.7"],
    ]);
    // Once resolved, only new probing counts: refused uploads still do not.
    const admin = await person(ctx, "admin");
    const probing = await ctx.db.securityAlert.findFirstOrThrow({
      where: { kind: "access_denied" },
    });
    await alerts.resolve(
      { id: admin.user.id, role: "admin" },
      probing.id,
      "Vérifié avec l'avocat",
      { requestId: "test-request", ipAddress: "127.0.0.1" },
    );
    await events(ALERT_RULES.deniedAccess, {
      action: "document.rejected",
      outcome: "denied",
      actorUserId: lawyer.user.id,
    });
    expect(await alerts.scan(now())).toBe(0);
    // Outside the 15-minute window nothing is counted.
    await resetDatabase(ctx);
    await events(ALERT_RULES.ipFailures, {
      action: "auth.login",
      outcome: "failure",
      ipAddress: "192.0.2.8",
    });
    expect(await alerts.scan(new Date(Date.now() + ALERT_RULES.windowMs + 1000))).toBe(0);
  });

  it("raise one alert per break-glass grant, never twice, even after it was resolved", async () => {
    const lead = await person(ctx, "lawyer");
    const matter = await createMatter(lead, (await createClient(lead)).id);
    const admin = await person(ctx, "admin", { reauth: true });
    await admin.browser.send("post", "/api/break-glass", {
      reference: matter.reference,
      reason: "Contrôle demandé par le bâtonnier",
    });
    expect(await alerts.scan(now())).toBe(1);
    const list = alertListResponseSchema.parse(
      (await admin.browser.send("get", "/api/admin/alerts")).body,
    );
    expect(list.alerts[0]).toMatchObject({
      kind: "break_glass",
      severity: "high",
      user: { id: admin.user.id },
    });
    await admin.browser.send("post", `/api/admin/alerts/${list.alerts[0]?.id ?? ""}/resolve`, {
      note: "Accès demandé par écrit",
    });
    expect(await alerts.scan(now())).toBe(0);
    expect((await alertRows()).map((a) => a.status)).toEqual(["resolved"]);
  });

  it("report backups: failures alert at once, a long gap only once backups exist", async () => {
    expect(await alerts.scan(now())).toBe(0);
    await alerts.reportBackup(false, "restic: repository locked");
    expect(await alerts.scan(now())).toBe(1);
    await alerts.reportBackup(true, null);
    expect(await alerts.scan(now())).toBe(0);
    const later = new Date(Date.now() + ALERT_RULES.backupMaxAgeMs + 60_000);
    expect(await alerts.scan(later)).toBe(1);
    expect((await alertRows()).map((a) => [a.kind, a.status])).toEqual([
      ["backup_failed", "open"],
      ["backup_overdue", "open"],
    ]);
  });

  it("are handled by administrators: acknowledged, resolved with a note, never twice", async () => {
    const lawyer = await person(ctx, "lawyer");
    await events(ALERT_RULES.accountFailures, {
      action: "auth.login",
      outcome: "failure",
      actorUserId: lawyer.user.id,
    });
    await alerts.scan(now());
    const admin = await person(ctx, "admin");
    expect((await lawyer.browser.send("get", "/api/admin/alerts")).status).toBe(404);
    expect(
      alertCountResponseSchema.parse(
        (await admin.browser.send("get", "/api/admin/alerts/count")).body,
      ),
    ).toEqual({
      unresolved: 1,
    });
    const id =
      alertListResponseSchema.parse((await admin.browser.send("get", "/api/admin/alerts")).body)
        .alerts[0]?.id ?? "";
    const ack = await admin.browser.send("post", `/api/admin/alerts/${id}/acknowledge`);
    expect(alertResponseSchema.parse(ack.body).alert).toMatchObject({
      status: "acknowledged",
      acknowledgedBy: { id: admin.user.id },
    });
    expect((await admin.browser.send("post", `/api/admin/alerts/${id}/acknowledge`)).status).toBe(
      409,
    );
    // Acknowledged alerts still need handling: they stay in the default list.
    const listed = async (query: string) =>
      alertListResponseSchema
        .parse((await admin.browser.send("get", `/api/admin/alerts${query}`)).body)
        .alerts.map((a) => a.id);
    expect(await listed("")).toEqual([id]);
    expect(await listed("?view=resolved")).toEqual([]);
    expect((await admin.browser.send("get", "/api/admin/alerts?view=open")).status).toBe(400);
    expect(
      (await admin.browser.send("post", `/api/admin/alerts/${id}/resolve`, { note: "x" })).status,
    ).toBe(400);
    const resolved = await admin.browser.send("post", `/api/admin/alerts/${id}/resolve`, {
      note: "Mot de passe oublié, confirmé par téléphone",
    });
    expect(alertResponseSchema.parse(resolved.body).alert).toMatchObject({
      status: "resolved",
      resolutionNote: "Mot de passe oublié, confirmé par téléphone",
    });
    expect(
      (await admin.browser.send("post", `/api/admin/alerts/${id}/resolve`, { note: "encore" }))
        .status,
    ).toBe(409);
    expect((await admin.browser.send("get", "/api/admin/alerts/count")).body).toEqual({
      unresolved: 0,
    });
    expect(await listed("")).toEqual([]);
    expect(await listed("?view=resolved")).toEqual([id]);

    // A resolved burst is not raised again; new failures after it are.
    expect(await alerts.scan(now())).toBe(0);
    await events(ALERT_RULES.accountFailures, {
      action: "auth.login",
      outcome: "failure",
      actorUserId: lawyer.user.id,
    });
    expect(await alerts.scan(now())).toBe(1);
  });
});

describe("user administration", () => {
  it("shows live sessions and failed checks in the last day", async () => {
    const admin = await person(ctx, "admin");
    const lawyer = await person(ctx, "lawyer");
    await events(3, { action: "auth.login", outcome: "failure", actorUserId: lawyer.user.id });
    const res = await admin.browser.send("get", "/api/admin/users");
    const row = (
      res.body as { users: { id: string; activeSessions: number; failedSignIns24h: number }[] }
    ).users.find((u) => u.id === lawyer.user.id);
    expect(row).toMatchObject({ activeSessions: 1, failedSignIns24h: 3 });
  });
});

describe("security_alert table", () => {
  const now = () => new Date();

  it("cannot be deleted or rewritten by the application, and keeps its rules", async () => {
    const lawyer = await person(ctx, "lawyer");
    await events(ALERT_RULES.accountFailures, {
      action: "auth.login",
      outcome: "failure",
      actorUserId: lawyer.user.id,
    });
    await alerts.scan(now());
    const expectCode = (sql: string, code: string) =>
      expect(app.query(sql)).rejects.toMatchObject({ code });
    await expectCode("DELETE FROM security_alert", "42501");
    await expectCode("TRUNCATE security_alert", "42501");
    await expectCode("UPDATE security_alert SET kind = 'break_glass'", "42501");
    await expectCode("UPDATE security_alert SET subject = 'someone-else'", "42501");
    await expectCode("UPDATE security_alert SET status = 'resolved'", "23514");
    await expectCode(
      `INSERT INTO security_alert (id, kind, severity, subject, count, first_seen_at, last_seen_at)
       SELECT gen_random_uuid(), kind, severity, subject, 1, now(), now() FROM security_alert`,
      "23505",
    );
  });
});
