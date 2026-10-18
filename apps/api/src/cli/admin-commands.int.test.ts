import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Browser,
  createTestUser,
  integrationContext,
  PASSWORD,
  resetDatabase,
  type IntegrationContext,
} from "../test/integration.js";
import { CliError, createFirstAdmin, recoverAdmin } from "./admin-commands.js";

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

const tokenOf = (url: string) => new URL(url).hash.replace("#token=", "");

describe("create the first administrator", () => {
  it("creates an admin with a set-password link carried in the URL fragment", async () => {
    const link = await createFirstAdmin(ctx.db, ctx.config, {
      email: " Owner@Cabinet.test ",
      displayName: "Office Owner",
    });
    expect(link.email).toBe("owner@cabinet.test");
    expect(link.url).toMatch(
      new RegExp(`^${ctx.config.appOrigin}/set-password#token=[A-Za-z0-9_-]{43}$`),
    );

    const set = await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: tokenOf(link.url),
      password: PASSWORD,
    });
    expect(set.status).toBe(204);
    // First sign-in demands a second factor.
    expect((await new Browser(ctx).login("owner@cabinet.test", PASSWORD)).body.state).toBe(
      "mfa_setup_required",
    );
  });

  it("refuses when an active administrator already exists", async () => {
    await createTestUser(ctx, { role: "admin" });
    await expect(
      createFirstAdmin(ctx.db, ctx.config, { email: "second@cabinet.test", displayName: "Second" }),
    ).rejects.toThrow(CliError);
  });

  it("validates its input", async () => {
    await expect(
      createFirstAdmin(ctx.db, ctx.config, { email: "not-an-email", displayName: "X" }),
    ).rejects.toThrow(/e-mail/);
    await expect(
      createFirstAdmin(ctx.db, ctx.config, { email: "a@b.test", displayName: "  " }),
    ).rejects.toThrow(/name/);
  });
});

describe("recover a locked-out administrator", () => {
  it("removes the second factor, signs them out and issues a new link", async () => {
    const admin = await createTestUser(ctx, { role: "admin", mfa: true });
    const browser = new Browser(ctx);
    await browser.signIn(admin);

    const link = await recoverAdmin(ctx.db, ctx.config, admin.email);
    expect((await browser.send("get", "/api/auth/session")).status).toBe(401);

    await new Browser(ctx).send("post", "/api/auth/password/set", {
      token: tokenOf(link.url),
      password: "a completely new office passphrase",
    });
    const login = await new Browser(ctx).login(admin.email, "a completely new office passphrase");
    expect(login.body.state).toBe("mfa_setup_required");
    expect(
      (await ctx.db.auditEvent.findFirst({ where: { action: "admin.recover" } }))?.targetId,
    ).toBe(admin.id);
  });

  it("only works for administrator accounts", async () => {
    const lawyer = await createTestUser(ctx, { role: "lawyer" });
    await expect(recoverAdmin(ctx.db, ctx.config, lawyer.email)).rejects.toThrow(CliError);
    await expect(recoverAdmin(ctx.db, ctx.config, "nobody@cabinet.test")).rejects.toThrow(CliError);
  });
});
