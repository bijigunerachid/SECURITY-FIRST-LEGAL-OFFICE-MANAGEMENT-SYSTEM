import {
  breakGlassGrantResponseSchema,
  breakGlassListResponseSchema,
  matterListResponseSchema,
  matterResponseSchema,
} from "@lexora/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  createTestUser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import { auditActions, createClient, createMatter, person } from "../../test/matters.js";

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

const REASON = "Lead lawyer in hospital; hearing tomorrow at 9:00.";

async function setUp() {
  const lawyer = await person(ctx, "lawyer");
  const client = await createClient(lawyer, { name: "Client Urgent" });
  const matter = await createMatter(lawyer, client.id, { restricted: true });
  const admin = await person(ctx, "admin", { reauth: true });
  return { lawyer, client, matter, admin };
}

describe("break-glass access", () => {
  it("gives an administrator read-only access to one matter for 60 minutes, fully audited", async () => {
    const { client, matter, admin } = await setUp();
    expect((await admin.browser.send("get", `/api/matters/${matter.id}`)).status).toBe(404);

    const res = await admin.browser.send("post", "/api/break-glass", {
      reference: matter.reference,
      reason: REASON,
    });
    expect(res.status).toBe(201);
    const { grant } = breakGlassGrantResponseSchema.parse(res.body);
    const minutes = (Date.parse(grant.expiresAt) - Date.parse(grant.createdAt)) / 60_000;
    expect(minutes).toBe(60);

    const detail = matterResponseSchema.parse(
      (await admin.browser.send("get", `/api/matters/${matter.id}`)).body,
    ).matter;
    expect(detail.breakGlassUntil).toBe(grant.expiresAt);
    expect(detail.myRole).toBeNull();
    expect(Object.values(detail.permissions).every((allowed) => !allowed)).toBe(true);
    expect((await admin.browser.send("get", `/api/clients/${client.id}`)).status).toBe(200);
    const list = matterListResponseSchema.parse(
      (await admin.browser.send("get", "/api/matters")).body,
    );
    expect(list.matters.map((m) => m.id)).toEqual([matter.id]);

    const events = await auditActions(ctx);
    const granted = events.find((e) => e.action === "matter.break_glass");
    expect(granted).toMatchObject({
      outcome: "success",
      targetId: matter.id,
      metadata: { grantId: grant.id, minutes: 60, restricted: true, priority: "high" },
    });
    expect(events.filter((e) => e.action === "matter.read")).toEqual([
      expect.objectContaining({ metadata: { breakGlass: true, restricted: true } }),
    ]);
    expect(events.filter((e) => e.action === "client.read")).toHaveLength(1);
  });

  it("requires a fresh password and code, a real reason and an existing reference", async () => {
    const { matter } = await setUp();
    const admin = await person(ctx, "admin");
    const noReauth = await admin.browser.send("post", "/api/break-glass", {
      reference: matter.reference,
      reason: REASON,
    });
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error.code).toBe("reauthentication_required");

    expect((await admin.browser.reauth(admin.user)).status).toBe(204);
    for (const body of [
      { reference: matter.reference, reason: "because" },
      { reference: matter.reference },
      { reference: "not-a-reference", reason: REASON },
      { reference: matter.reference, reason: REASON, minutes: 600 },
      { matterId: matter.id, reason: REASON },
    ]) {
      expect((await admin.browser.send("post", "/api/break-glass", body)).status).toBe(400);
    }
    const unknown = await admin.browser.send("post", "/api/break-glass", {
      reference: "1999-0001",
      reason: REASON,
    });
    expect(unknown.status).toBe(404);
    expect(await ctx.db.breakGlassGrant.count()).toBe(0);
    expect((await auditActions(ctx)).filter((e) => e.action === "matter.break_glass")).toEqual([
      expect.objectContaining({ outcome: "failure" }),
    ]);
  });

  it("ends when it expires or when the administrator ends it, everywhere (record, list, client)", async () => {
    const { client, matter, admin } = await setUp();
    /** Every way the administrator could still reach the matter or its client. */
    const reach = async () => ({
      matter: (await admin.browser.send("get", `/api/matters/${matter.id}`)).status,
      client: (await admin.browser.send("get", `/api/clients/${client.id}`)).status,
      listed: matterListResponseSchema.parse((await admin.browser.send("get", "/api/matters")).body)
        .matters.length,
      clients: ((await admin.browser.send("get", "/api/clients")).body as { clients: unknown[] })
        .clients.length,
    });
    const open = { matter: 200, client: 200, listed: 1, clients: 1 };
    const closed = { matter: 404, client: 404, listed: 0, clients: 0 };
    const grant = breakGlassGrantResponseSchema.parse(
      (
        await admin.browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: REASON,
        })
      ).body,
    ).grant;
    expect(await reach()).toEqual(open);

    // Ended early.
    expect((await admin.browser.send("post", `/api/break-glass/${grant.id}/end`)).status).toBe(204);
    expect(await reach()).toEqual(closed);
    expect(
      breakGlassListResponseSchema.parse((await admin.browser.send("get", "/api/break-glass")).body)
        .grants,
    ).toEqual([]);

    // Expired (moved into the past directly in the database).
    const second = breakGlassGrantResponseSchema.parse(
      (
        await admin.browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: REASON,
        })
      ).body,
    ).grant;
    expect(await reach()).toEqual(open);
    await ctx.owner.query(
      "UPDATE break_glass_grant SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1",
      [second.id],
    );
    expect(await reach()).toEqual(closed);
    expect((await admin.browser.send("post", `/api/break-glass/${second.id}/end`)).status).toBe(
      404,
    );
  });

  it("belongs to one administrator: others cannot use or end it", async () => {
    const { matter, admin } = await setUp();
    const grant = breakGlassGrantResponseSchema.parse(
      (
        await admin.browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: REASON,
        })
      ).body,
    ).grant;
    const other = await person(ctx, "admin", { reauth: true });
    expect((await other.browser.send("get", `/api/matters/${matter.id}`)).status).toBe(404);
    expect((await other.browser.send("post", `/api/break-glass/${grant.id}/end`)).status).toBe(404);
  });

  it("is invisible to lawyers and assistants, and a grant row gives them nothing", async () => {
    const { matter } = await setUp();
    for (const role of ["lawyer", "assistant"] as const) {
      const p = await person(ctx, role);
      expect((await p.browser.send("get", "/api/break-glass")).status).toBe(404);
      expect(
        (
          await p.browser.send("post", "/api/break-glass", {
            reference: matter.reference,
            reason: REASON,
          })
        ).status,
      ).toBe(404);
      // Even a grant written straight into the database is ignored for non-administrators.
      await ctx.db.breakGlassGrant.create({
        data: {
          userId: p.user.id,
          matterId: matter.id,
          reason: REASON,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      expect((await p.browser.send("get", `/api/matters/${matter.id}`)).status).toBe(404);
    }
    expect((await new Browser(ctx).send("get", "/api/break-glass")).status).toBe(401);
  });

  it("stops working when the administrator is disabled (sessions end)", async () => {
    const { matter } = await setUp();
    const adminUser = await createTestUser(ctx, { role: "admin", mfa: true });
    const browser = new Browser(ctx);
    await browser.signIn(adminUser);
    await browser.reauth(adminUser);
    expect(
      (
        await browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: REASON,
        })
      ).status,
    ).toBe(201);
    await ctx.auth.sessions.revokeAllForUser(adminUser.id);
    expect((await browser.send("get", `/api/matters/${matter.id}`)).status).toBe(401);
  });
});
