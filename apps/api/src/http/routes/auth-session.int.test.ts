import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../lib/crypto.js";
import {
  Browser,
  createTestUser,
  integrationContext,
  PASSWORD,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";

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

async function signedIn(options: Parameters<typeof createTestUser>[1] = {}) {
  const user = await createTestUser(ctx, options);
  const browser = new Browser(ctx);
  await browser.signIn(user);
  return { user, browser };
}

const sessionStatus = async (browser: Browser) =>
  (await browser.send("get", "/api/auth/session")).status;

describe("session lifetime", () => {
  it("ends at logout, server-side, and clears the cookie", async () => {
    const { user, browser } = await signedIn();
    const token = browser.sessionToken;
    const res = await browser.send("post", "/api/auth/logout");
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/Expires=Thu, 01 Jan 1970/);

    const replay = new Browser(ctx);
    replay.sessionToken = token;
    expect(await sessionStatus(replay)).toBe(401);
    expect(await ctx.db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("expires after 30 idle minutes", async () => {
    const { user, browser } = await signedIn();
    await ctx.owner.query(
      "UPDATE session SET last_seen_at = now() - interval '31 minutes' WHERE user_id = $1",
      [user.id],
    );
    expect(await sessionStatus(browser)).toBe(401);
    expect(await ctx.db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("stays alive while used within the idle limit", async () => {
    const { user, browser } = await signedIn();
    await ctx.owner.query(
      "UPDATE session SET last_seen_at = now() - interval '29 minutes' WHERE user_id = $1",
      [user.id],
    );
    expect(await sessionStatus(browser)).toBe(200);
  });

  it("expires at its absolute lifetime even when active", async () => {
    const { user, browser } = await signedIn();
    await ctx.owner.query(
      "UPDATE session SET created_at = now() - interval '11 hours', expires_at = now() - interval '1 second' WHERE user_id = $1",
      [user.id],
    );
    expect(await sessionStatus(browser)).toBe(401);
  });

  it("gives a session waiting for its second factor only ten minutes", async () => {
    const user = await createTestUser(ctx, { mfa: true });
    await new Browser(ctx).login(user.email, PASSWORD);
    const { rows } = await ctx.owner.query<{ minutes: number }>(
      "SELECT extract(epoch FROM expires_at - created_at) / 60 AS minutes FROM session WHERE user_id = $1",
      [user.id],
    );
    expect(Number(rows[0]?.minutes)).toBeCloseTo(10, 0);
  });

  it("stops working immediately when the account is disabled", async () => {
    const { user, browser } = await signedIn();
    await ctx.db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect(await sessionStatus(browser)).toBe(401);
  });

  it("ignores forged or malformed cookies and tells the browser to drop them", async () => {
    for (const token of ["not-a-token", "A".repeat(43), "'; DROP TABLE session; --"]) {
      const browser = new Browser(ctx);
      browser.sessionToken = encodeURIComponent(token);
      const res = await browser.send("get", "/api/auth/session");
      expect(res.status).toBe(401);
    }
  });

  it("stores only a hash of the session token", async () => {
    const { user, browser } = await signedIn();
    const token = browser.sessionToken ?? "";
    const { rows } = await ctx.owner.query<{ token_hash: Buffer }>(
      "SELECT token_hash FROM session WHERE user_id = $1",
      [user.id],
    );
    expect(rows[0]?.token_hash.equals(sha256(token))).toBe(true);
    const dump = await ctx.owner.query("SELECT * FROM session");
    expect(JSON.stringify(dump.rows)).not.toContain(token);
  });
});

describe("password change and signing out other devices", () => {
  it("changes the password, signs out every other session and rotates this one", async () => {
    const { user, browser } = await signedIn();
    const other = new Browser(ctx);
    await other.signIn(user);
    const oldToken = browser.sessionToken;

    const res = await browser.send("post", "/api/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: "a brand new passphrase for the office",
    });
    expect(res.status).toBe(200);
    expect(browser.sessionToken).not.toBe(oldToken);
    expect(await sessionStatus(browser)).toBe(200);
    expect(await sessionStatus(other)).toBe(401);

    const stale = new Browser(ctx);
    stale.sessionToken = oldToken;
    expect(await sessionStatus(stale)).toBe(401);

    expect(
      (
        await new Browser(ctx).send("post", "/api/auth/login", {
          email: user.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await new Browser(ctx).send("post", "/api/auth/login", {
          email: user.email,
          password: "a brand new passphrase for the office",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses a wrong current password and a weak new one", async () => {
    const { browser } = await signedIn();
    await browser.refresh();
    const wrong = await browser.send("post", "/api/auth/password/change", {
      currentPassword: "not my password at all",
      newPassword: "a brand new passphrase for the office",
    });
    expect(wrong.status).toBe(401);

    const weak = await browser.send("post", "/api/auth/password/change", {
      currentPassword: PASSWORD,
      newPassword: "passwordpassword",
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatchObject({ code: "password_rejected", reason: "common" });
  });

  it("signs out other devices on request", async () => {
    const { user, browser } = await signedIn();
    const other = new Browser(ctx);
    await other.signIn(user);
    const res = await browser.send("post", "/api/auth/sessions/revoke-others");
    expect(res.body).toEqual({ revoked: 1 });
    expect(await sessionStatus(other)).toBe(401);
    expect(await sessionStatus(browser)).toBe(200);
  });
});

describe("cross-site request forgery", () => {
  it("refuses a state change without the CSRF token, or with a wrong one", async () => {
    const { browser } = await signedIn();
    const token = browser.csrfToken;

    browser.csrfToken = null;
    expect((await browser.send("post", "/api/auth/sessions/revoke-others")).status).toBe(403);
    browser.csrfToken = "wrong-token";
    expect((await browser.send("post", "/api/auth/sessions/revoke-others")).status).toBe(403);
    browser.csrfToken = token;
    expect((await browser.send("post", "/api/auth/sessions/revoke-others")).status).toBe(200);
  });

  it("refuses requests from another origin, even with a valid token", async () => {
    const { browser } = await signedIn();
    browser.origin = "https://evil.example";
    const res = await browser.send("post", "/api/auth/sessions/revoke-others");
    expect(res.status).toBe(403);
  });

  it("refuses cross-site requests identified by Fetch Metadata when no Origin is sent", async () => {
    const user = await createTestUser(ctx);
    const res = await new Browser(ctx).send(
      "post",
      "/api/auth/login",
      { email: user.email, password: PASSWORD },
      {
        Origin: "",
        "Sec-Fetch-Site": "cross-site",
      },
    );
    expect(res.status).toBe(403);
  });

  it("refuses a login posted from another site (login CSRF)", async () => {
    const user = await createTestUser(ctx);
    const browser = new Browser(ctx);
    browser.origin = "https://evil.example";
    const res = await browser.send("post", "/api/auth/login", {
      email: user.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("does not require the CSRF token for reads", async () => {
    const { browser } = await signedIn();
    browser.csrfToken = null;
    expect(await sessionStatus(browser)).toBe(200);
  });
});
